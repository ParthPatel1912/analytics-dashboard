export interface EventEnvelope {
  event_id: string;
  name: string;
  timestamp: string;
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
  source: 'browser';
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
}
export interface AnalyticsOptions {
  writeKey: string;
  endpoint: string;
  flushInterval?: number;
  maxBatchSize?: number;
  autoPageViews?: boolean;
  debug?: boolean;
}
export interface Identity {
  anonymous_id: string;
  session_id: string;
  user_id: string | null;
}
export interface Analytics {
  page(properties?: Record<string, unknown>): void;
  track(name: string, properties?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  reset(): void;
  flush(): Promise<void>;
  shutdown(): void;
  optOut(): void;
  optIn(): void;
  getIdentity(): Identity | null;
}
type Pending = { event: EventEnvelope; tries: number };
const routeListeners = new Set<() => void>();
let restoreHistory: (() => void) | undefined;
function watchRoutes(listener: () => void) {
  routeListeners.add(listener);
  if (!restoreHistory) {
    const push = history.pushState,
      replace = history.replaceState;
    const changed = () => routeListeners.forEach((fn) => fn());
    const wrapPush: History['pushState'] = function (this: History, ...args) {
      push.apply(this, args);
      changed();
    };
    const wrapReplace: History['replaceState'] = function (this: History, ...args) {
      replace.apply(this, args);
      changed();
    };
    history.pushState = wrapPush;
    history.replaceState = wrapReplace;
    window.addEventListener('popstate', changed);
    restoreHistory = () => {
      if (history.pushState === wrapPush) history.pushState = push;
      if (history.replaceState === wrapReplace) history.replaceState = replace;
      window.removeEventListener('popstate', changed);
      restoreHistory = undefined;
    };
  }
  return () => {
    routeListeners.delete(listener);
    if (!routeListeners.size) restoreHistory?.();
  };
}
export function createAnalytics(options: AnalyticsOptions): Analytics {
  const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const prefix = `ta_${encodeURIComponent(options.writeKey)}_`;
  let queue: Pending[] = [],
    identity: Identity | null = null,
    lastActivity = 0;
  let stopped = false,
    busy = false,
    nextAttempt = 0,
    generation = 0,
    lastUrl = '';
  let timer: ReturnType<typeof setInterval> | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  let request: AbortController | undefined,
    requestTimeout: ReturnType<typeof setTimeout> | undefined;
  const memory: Record<string, string> = {};
  let revision = 0;
  const log = (e: unknown) => {
    if (options.debug)
      try {
        console.debug('[analytics]', e);
      } catch {}
  };
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      log(e);
      return fallback;
    }
  };
  const read = (key: string): string | null => {
    if (!browser) return null;
    const local = safe(() => localStorage.getItem(prefix + key), null);
    if (key === 'queue') return local ?? memory[key] ?? null;
    const cookie = safe(() => {
      const value = document.cookie.split('; ').find((c) => c.startsWith(prefix + key + '='));
      return value ? decodeURIComponent(value.slice(prefix.length + key.length + 1)) : null;
    }, null);
    let selected: { value: string | null; revision: number } = { value: null, revision: -1 };
    for (const raw of [local, cookie, memory[key]]) {
      if (raw == null) continue;
      const record = safe(() => JSON.parse(raw), null);
      const candidate =
        record?.__ta === 1 &&
        typeof record.value === 'string' &&
        Number.isSafeInteger(record.revision)
          ? (record as { value: string; revision: number })
          : { value: raw, revision: 0 };
      revision = Math.max(revision, candidate.revision);
      if (
        candidate.revision > selected.revision ||
        (key === 'optout' && candidate.revision === selected.revision && candidate.value === '1')
      )
        selected = candidate;
    }
    return selected.value;
  };
  const write = (key: string, value: string, cookie = false) => {
    if (key !== 'queue') {
      read(key);
      revision = Math.max(revision, Date.now()) + 1;
      value = JSON.stringify({ __ta: 1, value, revision });
    }
    memory[key] = value;
    const saved = safe(() => {
      localStorage.setItem(prefix + key, value);
      return true;
    }, false);
    if (browser && (cookie || !saved) && key !== 'queue')
      safe(() => {
        document.cookie = `${prefix + key}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      }, undefined);
  };
  let optedOut = read('optout') === '1';
  const disabled = () =>
    !browser ||
    stopped ||
    optedOut ||
    navigator.doNotTrack === '1' ||
    (window as any).doNotTrack === '1';
  const uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
          (
            Number(c) ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
          ).toString(16),
        );
  const persist = () => safe(() => write('queue', JSON.stringify(queue)), undefined);
  const saveIdentity = () => {
    write('identity', JSON.stringify({ ...identity, lastActivity }), true);
  };
  const getIdentity = (): Identity | null =>
    safe(() => {
      if (disabled()) return null;
      const now = Date.now();
      if (!identity) {
        const stored = safe(() => JSON.parse(read('identity') || 'null'), null);
        if (
          stored &&
          typeof stored.anonymous_id === 'string' &&
          typeof stored.session_id === 'string'
        ) {
          identity = {
            anonymous_id: stored.anonymous_id,
            session_id: stored.session_id,
            user_id: typeof stored.user_id === 'string' ? stored.user_id : null,
          };
          lastActivity = Number(stored.lastActivity) || 0;
        } else identity = { anonymous_id: uuid(), session_id: uuid(), user_id: null };
      }
      if (now - lastActivity >= 30 * 60000) identity.session_id = uuid();
      lastActivity = now;
      saveIdentity();
      return { ...identity };
    }, null);
  const batchSize = Math.max(1, Math.min(50, options.maxBatchSize || 20));
  const takeBatch = (pending = queue) => {
    const items: Pending[] = [];
    let bytes = 256;
    for (const item of pending.slice(0, batchSize)) {
      const size = new TextEncoder().encode(JSON.stringify(item.event)).length + 1;
      if (items.length && bytes + size > 60000) break;
      items.push(item);
      bytes += size;
    }
    return items;
  };
  const remove = (items: Pending[]) => {
    const ids = new Set(items.map((i) => i.event.event_id));
    queue = queue.filter((i) => !ids.has(i.event.event_id));
    persist();
  };
  async function flush(beacon = false): Promise<void> {
    let ownsRequest = false;
    try {
      if (disabled() || !queue.length) return;
      if (beacon && navigator.sendBeacon) {
        // A true return means queued by the browser, not acknowledged by the server.
        // Keep persisted events until a later acknowledged fetch; UUIDs make replay safe.
        for (let i = 0; i < queue.length;) {
          const items = takeBatch(queue.slice(i));
          i += items.length;
          const payload = JSON.stringify({
            write_key: options.writeKey,
            events: items.map((i) => i.event),
          });
          if (
            !navigator.sendBeacon(
              options.endpoint,
              new Blob([payload], { type: 'application/json' }),
            )
          )
            break;
        }
        return;
      }
      if (busy || Date.now() < nextAttempt) return;
      busy = true;
      ownsRequest = true;
      const items = takeBatch(),
        current = generation;
      let response: Response | undefined;
      const controller = new AbortController();
      request = controller;
      requestTimeout = setTimeout(() => controller.abort(), 10000);
      try {
        response = await fetch(options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Analytics-Key': options.writeKey },
          body: JSON.stringify({ events: items.map((i) => i.event) }),
          keepalive: true,
          signal: controller.signal,
        });
      } catch (e) {
        log(e);
      } finally {
        if (requestTimeout) clearTimeout(requestTimeout);
        if (request === controller) request = undefined;
      }
      if (current !== generation || stopped) return;
      if (response && (response.ok || (response.status < 500 && response.status !== 429))) {
        remove(items);
        nextAttempt = 0;
        busy = false;
        ownsRequest = false;
        if (queue.length) await flush();
      } else {
        for (const item of items) item.tries++;
        remove(items.filter((i) => i.tries >= 5));
        persist();
        const header = response?.headers.get('Retry-After');
        const serverDelay = header
          ? /^\d+(\.\d+)?$/.test(header)
            ? Number(header) * 1000
            : Math.max(0, Date.parse(header) - Date.now())
          : 0;
        const delay = Math.max(
          Number.isFinite(serverDelay) ? serverDelay : 0,
          Math.min(60000, 1000 * 2 ** (items[0].tries - 1)) * (0.75 + Math.random() * 0.5),
        );
        nextAttempt = Date.now() + delay;
        if (retry) clearTimeout(retry);
        retry = setTimeout(() => {
          void flush();
        }, delay);
      }
    } catch (e) {
      log(e);
    } finally {
      if (ownsRequest) busy = false;
    }
  }
  const track = (name: string, properties: Record<string, unknown> = {}) =>
    safe(() => {
      if (disabled()) return;
      const id = getIdentity();
      if (!id) return;
      const clean = JSON.parse(JSON.stringify(properties));
      if (new TextEncoder().encode(JSON.stringify(clean)).length > 8192) return;
      const referrer = safe(() => {
        const u = new URL(document.referrer);
        return u.origin + u.pathname;
      }, '');
      queue.push({
        tries: 0,
        event: {
          ...id,
          event_id: uuid(),
          name,
          timestamp: new Date().toISOString(),
          source: 'browser',
          properties: clean,
          context: {
            url: (location.origin + location.pathname).slice(0, 1000),
            path: location.pathname.slice(0, 500),
            referrer: referrer.slice(0, 1000),
            title: document.title.slice(0, 1000),
            user_agent: navigator.userAgent.slice(0, 500),
            screen: { width: screen.width, height: screen.height },
            locale: navigator.language.slice(0, 100),
          },
        },
      });
      queue = queue.slice(-200);
      persist();
      if (queue.length >= batchSize) void flush();
    }, undefined);
  const page = (properties?: Record<string, unknown>) => track('page_view', properties);
  const onRoute = () =>
    safe(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        page();
      }
    }, undefined);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush(true);
  };
  const onPageHide = () => {
    void flush(true);
  };
  safe(() => {
    if (!browser) return;
    const restored = safe(() => JSON.parse(read('queue') || '[]'), []);
    if (!disabled() && Array.isArray(restored))
      queue = restored
        .filter((i) => i?.event?.event_id && Number.isInteger(i.tries) && i.tries < 5)
        .slice(-200);
    else write('queue', '[]');
    timer = setInterval(
      () => {
        void flush();
      },
      Math.max(100, options.flushInterval ?? 5000),
    );
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    if (options.autoPageViews !== false) {
      unwatch = watchRoutes(onRoute);
      onRoute();
    }
  }, undefined);
  return {
    page,
    track,
    getIdentity,
    flush: () => flush(),
    identify: (userId, traits = {}) =>
      safe(() => {
        if (disabled() || !userId || userId.length > 200) return;
        getIdentity();
        if (identity) {
          identity.user_id = userId;
          saveIdentity();
          track('identify', traits);
        }
      }, undefined),
    reset: () =>
      safe(() => {
        identity = null;
        write('identity', 'null', true);
        lastActivity = 0;
        getIdentity();
      }, undefined),
    optOut: () =>
      safe(() => {
        optedOut = true;
        generation++;
        request?.abort();
        if (requestTimeout) clearTimeout(requestTimeout);
        if (retry) clearTimeout(retry);
        nextAttempt = 0;
        queue = [];
        persist();
        write('optout', '1', true);
      }, undefined),
    optIn: () =>
      safe(() => {
        optedOut = false;
        write('optout', '0', true);
      }, undefined),
    shutdown: () =>
      safe(() => {
        void flush(true);
        stopped = true;
        request?.abort();
        if (requestTimeout) clearTimeout(requestTimeout);
        if (timer) clearInterval(timer);
        if (retry) clearTimeout(retry);
        unwatch?.();
        if (browser) {
          document.removeEventListener('visibilitychange', onHide);
          window.removeEventListener('pagehide', onPageHide);
        }
      }, undefined),
  };
}
