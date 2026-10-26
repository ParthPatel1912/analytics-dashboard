'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
type Bucket = { bucket: string; value: number };
type Overview = {
  total_events: number;
  page_views: number;
  unique_visitors: number;
  sessions: number;
  orders_created: number;
};
type FeedEvent = {
  event_id: string;
  name: string;
  source: string;
  path: string | null;
  occurred_at: string;
  anonymous_id: string;
  properties: Record<string, unknown>;
};
type DashboardData = {
  overview: Overview;
  pages: { path: string; views: number; unique_visitors: number }[];
  series: { bucket: string; views: number; visitors: number }[];
  events: { name: string; count: number }[];
  trend: Bucket[];
};
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const number = (v: number) => v.toLocaleString();
async function query(path: string, params: URLSearchParams, signal: AbortSignal) {
  const response = await fetch(`/api/stats/${path}?${params}`, { signal, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load analytics');
  return result;
}
export function Dashboard() {
  const params = useSearchParams(),
    router = useRouter();
  const from = params.get('from') || day(-6),
    to = params.get('to') || day();
  const interval = params.get('interval') === 'hour' ? 'hour' : 'day',
    event = params.get('event') || 'order_created';
  const tz = params.get('tz') || 'UTC';
  let displayTz = tz;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format();
  } catch {
    displayTz = 'UTC';
  }
  const [data, setData] = useState<DashboardData | null>(null),
    [feed, setFeed] = useState<FeedEvent[]>([]),
    [error, setError] = useState(''),
    [feedError, setFeedError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0),
    [updated, setUpdated] = useState('');
  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    next.set('from', from);
    next.set('to', to);
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    router.replace(`/dashboard?${next}`, { scroll: false });
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const range = new URLSearchParams({ from, to, tz });
    Promise.all([
      query('overview', range, controller.signal),
      query('top-pages', range, controller.signal),
      query(
        'timeseries',
        new URLSearchParams({ from, to, tz, interval, metric: 'page_views' }),
        controller.signal,
      ),
      query(
        'timeseries',
        new URLSearchParams({ from, to, tz, interval, metric: 'visitors' }),
        controller.signal,
      ),
      query('events', new URLSearchParams({ from, to, tz, event }), controller.signal),
    ])
      .then(([overview, pages, views, visitors, breakdown]) => {
        if (!controller.signal.aborted) {
          setData({
            overview,
            pages: pages.pages,
            series: views.buckets.map((b: Bucket, i: number) => ({
              bucket: b.bucket,
              views: b.value,
              visitors: visitors.buckets[i]?.value || 0,
            })),
            events: breakdown.events,
            trend: breakdown.trend.buckets,
          });
          setUpdated(new Date().toLocaleTimeString());
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [from, to, tz, interval, event, version]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const result = await query(
          'recent',
          new URLSearchParams({ from, to, tz, limit: '12' }),
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setFeed(result.events);
          setFeedError('');
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setFeedError(e instanceof Error ? e.message : 'Live feed unavailable');
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      setVersion((v) => v + 1);
    }, 8000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [from, to, tz]);
  const presets = [
    { label: 'Today', days: 1 },
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
  ];
  const isEmpty = data?.overview.total_events === 0;
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          t<span>&</span>t
        </Link>
        <div className="workspace">
          <div className="workspace-icon">T</div>
          <div>
            <b>Table & Thyme</b>
            <small>Demo workspace</small>
          </div>
          <span>⌄</span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <a className="side-active" href="#overview">
          <span>▦</span> Overview
        </a>
        <a href="#activity">
          <span>⌁</span> Event activity
        </a>
        <a href="#pages">
          <span>▤</span> Top pages
        </a>
        <a href="#live">
          <span>◉</span> Live events
        </a>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <span>✦</span>
            <b>From plate to pixel.</b>
            <p>Take a look around the restaurant to see real events flow in.</p>
            <Link href="/menu">Visit the demo app ↗</Link>
          </div>
          <div className="project-status">
            <i /> Local development
          </div>
        </div>
      </aside>
      <main className="dashboard-main" id="overview">
        <div className="dashboard-topbar">
          <span>
            Workspace <span className="slash">/</span> <b>Overview</b>
          </span>
          <span className="badge">
            <i /> Demo project
          </span>
        </div>
        <div className="dashboard-content">
          <div className="page-heading dashboard-heading">
            <div>
              <p className="eyebrow">YOUR KITCHEN, BY THE NUMBERS</p>
              <h1>A little insight goes a long way.</h1>
              <p>Understand the journey from first visit to first order.</p>
            </div>
            <button
              className="button secondary"
              onClick={() => setVersion((v) => v + 1)}
              disabled={loading}
            >
              ↻ {loading ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
          <div className="filter-bar">
            <div className="segmented">
              {presets.map((p) => (
                <button
                  key={p.days}
                  className={from === day(1 - p.days) && to === day() ? 'selected' : ''}
                  onClick={() => update({ from: day(1 - p.days), to: day() })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="date-inputs">
              <label>
                <span className="sr-only">From date</span>
                <input
                  aria-label="From date"
                  type="date"
                  value={from}
                  onChange={(e) => {
                    if (e.target.value) update({ from: e.target.value });
                  }}
                />
              </label>
              <span>→</span>
              <label>
                <span className="sr-only">To date</span>
                <input
                  aria-label="To date"
                  type="date"
                  value={to}
                  onChange={(e) => {
                    if (e.target.value) update({ to: e.target.value });
                  }}
                />
              </label>
              <label>
                <span className="sr-only">Timezone</span>
                <select
                  aria-label="Timezone"
                  value={tz}
                  onChange={(e) => update({ tz: e.target.value })}
                >
                  {['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setVersion((v) => v + 1)}>Retry</button>
            </div>
          )}
          {!data && loading ? (
            <div className="loading-grid" aria-live="polite">
              Loading your kitchen’s story…
            </div>
          ) : (
            data && (
              <>
                <section className="kpi-grid" aria-label="Key metrics">
                  {[
                    {
                      title: 'Page views',
                      value: data.overview.page_views,
                      icon: '▤',
                      note: 'Every page, every visit',
                    },
                    {
                      title: 'Unique visitors',
                      value: data.overview.unique_visitors,
                      icon: '♧',
                      note: 'People behind the activity',
                    },
                    {
                      title: 'Sessions',
                      value: data.overview.sessions,
                      icon: '⌁',
                      note: 'Journeys through your kitchen',
                    },
                    {
                      title: 'Orders created',
                      value: data.overview.orders_created,
                      icon: '◈',
                      note: 'Tracked on the server',
                    },
                  ].map((k, i) => (
                    <article className={`kpi ${i === 3 ? 'kpi-accent' : ''}`} key={k.title}>
                      <div>
                        <span>{k.title}</span>
                        <span className="kpi-icon">{k.icon}</span>
                      </div>
                      <strong>{number(k.value)}</strong>
                      <small>{k.note}</small>
                    </article>
                  ))}
                </section>
                {isEmpty && (
                  <div className="empty-banner">
                    <b>A fresh start. Your story begins here.</b>
                    <span>
                      Visit the restaurant or run <code>npm run seed:demo</code> to populate this
                      range.
                    </span>
                    <Link href="/menu">Browse the menu →</Link>
                  </div>
                )}
                <section className="panel traffic-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Visits over time</h2>
                      <p>A closer look at who’s stopping by.</p>
                    </div>
                    <div className="segmented small">
                      {['day', 'hour'].map((i) => (
                        <button
                          className={i === interval ? 'selected' : ''}
                          key={i}
                          onClick={() => update({ interval: i })}
                        >
                          {i === 'day' ? 'Daily' : 'Hourly'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="dot olive" /> Page views
                    </span>
                    <span>
                      <i className="dot gold" /> Unique visitors
                    </span>
                    <small>{tz}</small>
                  </div>
                  <div className="main-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={data.series}
                        margin={{ left: -20, right: 12, top: 10, bottom: 5 }}
                      >
                        <CartesianGrid stroke="#e8e9e1" strokeDasharray="3 5" vertical={false} />
                        <XAxis
                          dataKey="bucket"
                          tickFormatter={(v) =>
                            interval === 'hour' ? v.slice(5).replace('T', ' ') : v.slice(5)
                          }
                          tickLine={false}
                          axisLine={false}
                          minTickGap={35}
                          tick={{ fill: '#8a8c80', fontSize: 11 }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: '#8a8c80', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{ borderRadius: 10, borderColor: '#e0e3d6', fontSize: 12 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="views"
                          name="Page views"
                          stroke="#586b35"
                          strokeWidth={2.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="visitors"
                          name="Unique visitors"
                          stroke="#c5a361"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <div className="dashboard-two-col">
                  <section className="panel" id="pages">
                    <div className="panel-heading">
                      <div>
                        <h2>Where people gather</h2>
                        <p>Your most visited pages.</p>
                      </div>
                      <span className="subtle-tag">TOP {data.pages.length}</span>
                    </div>
                    <div className="table-head page-row">
                      <span>PAGE PATH</span>
                      <span>VIEWS</span>
                      <span>VISITORS</span>
                    </div>
                    {data.pages.length ? (
                      data.pages.map((p, i) => (
                        <div className="page-row top-page" key={p.path}>
                          <div>
                            <span className="page-rank">{String(i + 1).padStart(2, '0')}</span>
                            <code>{p.path}</code>
                            <div
                              className="page-bar"
                              style={{
                                width: `${Math.max(4, (p.views / data.pages[0].views) * 70)}%`,
                              }}
                            />
                          </div>
                          <b>{number(p.views)}</b>
                          <span>{number(p.unique_visitors)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="empty small-empty">Page visits will appear here.</p>
                    )}
                  </section>
                  <section className="panel" id="activity">
                    <div className="panel-heading">
                      <div>
                        <h2>Little actions, big picture</h2>
                        <p>What’s happening along the way.</p>
                      </div>
                      <span className="subtle-tag">
                        {number(data.overview.total_events)} EVENTS
                      </span>
                    </div>
                    <div className="table-head event-row">
                      <span>EVENT NAME</span>
                      <span>COUNT</span>
                    </div>
                    {data.events.length ? (
                      data.events.map((e) => (
                        <button
                          className={`event-row event-choice ${event === e.name ? 'chosen' : ''}`}
                          key={e.name}
                          onClick={() => update({ event: e.name })}
                        >
                          <span>
                            <i
                              className={`dot ${e.name === 'order_created' ? 'olive' : 'neutral'}`}
                            />
                            <code>{e.name}</code>
                          </span>
                          <b>{number(e.count)}</b>
                        </button>
                      ))
                    ) : (
                      <p className="empty small-empty">Events will appear here.</p>
                    )}
                  </section>
                </div>
                <section className="panel trend-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Event spotlight</h2>
                      <p>Daily activity for a selected event.</p>
                    </div>
                    <label>
                      <span className="sr-only">Selected event</span>
                      <select
                        aria-label="Selected event"
                        value={event}
                        onChange={(e) => update({ event: e.target.value })}
                      >
                        {[
                          ...new Set(['order_created', ...data.events.map((e) => e.name), event]),
                        ].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.trend} margin={{ left: -20, right: 12 }}>
                        <CartesianGrid stroke="#e8e9e1" vertical={false} strokeDasharray="3 5" />
                        <XAxis
                          dataKey="bucket"
                          tickFormatter={(v) => v.slice(5)}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={40}
                          tick={{ fontSize: 11, fill: '#8a8c80' }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: '#8a8c80' }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="value"
                          name={event}
                          fill="#8c9a70"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={38}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </>
            )
          )}
          <section className="panel live-panel" id="live">
            <div className="panel-heading">
              <div>
                <h2>
                  <i className="live-dot" /> Fresh from the app
                </h2>
                <p>Recent events in this date range. Updates every 8 seconds.</p>
              </div>
              <span className="badge">LIVE FEED</span>
            </div>
            {feedError && (
              <p className="error" role="alert">
                {feedError}
              </p>
            )}
            <div className="feed-scroll">
              <table>
                <thead>
                  <tr>
                    <th>EVENT</th>
                    <th>SOURCE</th>
                    <th>PAGE / ORDER</th>
                    <th>TIME ({tz})</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.map((e) => (
                    <tr key={e.event_id}>
                      <td>
                        <code>{e.name}</code>
                      </td>
                      <td>
                        <span className={`source-tag ${e.source}`}>{e.source}</span>
                      </td>
                      <td className="muted">
                        {e.path || String(e.properties.order_id || '—').slice(0, 8)}
                      </td>
                      <td className="muted">
                        {new Date(e.occurred_at).toLocaleString('en-GB', {
                          timeZone: displayTz,
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!feed.length && (
                <p className="empty small-empty">Waiting for your next little moment.</p>
              )}
            </div>
          </section>
          <div className="dashboard-footnote">
            <span>All metrics use occurred-at time · {tz} buckets</span>
            <span>{updated ? `Last updated ${updated}` : 'Connecting to analytics…'}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
