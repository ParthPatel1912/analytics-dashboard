import { randomUUID } from 'node:crypto';
export interface ServerEvent {
  event_id: string; name: string; timestamp: string; anonymous_id: string; session_id: string;
  user_id: string | null; source: 'server'; properties: Record<string, unknown>; context: Record<string, unknown>;
}
export interface EventTransport { send(events: ServerEvent[]): Promise<void> }
export class HttpTransport implements EventTransport {
  constructor(private readonly endpoint: string, private readonly secretKey: string) {}
  async send(events: ServerEvent[]) {
    // Retry the same envelope, keeping its UUID stable across all attempts.
    for (let attempt = 0; attempt < 3; attempt++) {
      let delay = 200 * 2 ** attempt;
      try {
        const response = await fetch(this.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const result = await response.json() as { rejected?: unknown[] };
          if (result.rejected?.length) throw new Error('Analytics rejected server events');
          return;
        }
        if (response.status < 500 && response.status !== 429) throw Object.assign(new Error(`Analytics HTTP ${response.status}`), { permanent: true });
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) delay = Math.max(delay, /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
      } catch (error: any) { if (error.permanent || attempt === 2) throw error; }
      if (attempt === 2) throw new Error('Analytics transport exhausted retries');
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 60000)));
    }
  }
}
export class ServerTracker {
  constructor(private readonly transport: EventTransport, private readonly log: (error: unknown) => void = () => {}) {}
  async track(name: string, properties: Record<string, unknown> = {}, userId: string | null = null, anonymousId?: string, sessionId?: string): Promise<void> {
    try {
      const id = anonymousId || randomUUID();
      await this.transport.send([{ event_id: randomUUID(), name, timestamp: new Date().toISOString(), anonymous_id: id, session_id: sessionId || randomUUID(), user_id: userId, source: 'server', properties, context: {} }]);
    } catch (error) { try { this.log(error); } catch {} }
  }
}
