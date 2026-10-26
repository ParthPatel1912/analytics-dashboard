import type { Knex } from 'knex';
export interface Range { from: string; to: string; tz: string }
export type Interval = 'day' | 'hour';
// Isolate dialect-specific date arithmetic. Named-zone DB tables are not required.
function offsetAt(time: number, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(format.formatToParts(time).map(p => [p.type, p.value]));
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(time / 1000) * 1000) / 60000);
}
export function bucketPlan(db: Knex, range: Range, interval: Interval) {
  const start = Date.parse(range.from), end = Date.parse(range.to) + 1;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: range.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const segments: { start: number; end: number; offset: number }[] = [];
  let segmentStart = start, offset = offsetAt(start, format);
  for (let cursor = start; cursor < end;) {
    const next = Math.min(end, cursor + 6 * 3600000), nextOffset = offsetAt(next - 1, format);
    if (nextOffset !== offset) {
      let low = cursor, high = next - 1;
      while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (offsetAt(mid, format) === offset) low = mid; else high = mid; }
      segments.push({ start: segmentStart, end: high, offset }); segmentStart = high; offset = nextOffset;
    }
    cursor = next;
  }
  segments.push({ start: segmentStart, end, offset });
  const client = db.client.config.client;
  const fmt = interval === 'day' ? '%Y-%m-%d' : '%Y-%m-%dT%H:00';
  const pgFmt = interval === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DD"T"HH24:00';
  const mysqlFmt = interval === 'day' ? '%Y-%m-%d' : '%Y-%m-%dT%H:00';
  const fragments: string[] = [], bindings: any[] = [];
  const keys = new Set<string>();
  for (const s of segments) {
    let expression: string;
    bindings.push(new Date(s.start).toISOString(), new Date(s.end).toISOString());
    if (client === 'pg') { expression = "to_char((CAST(occurred_at AS timestamptz) AT TIME ZONE 'UTC') + (? * interval '1 minute'), ?)"; bindings.push(s.offset, pgFmt); }
    else if (client === 'mysql2') { expression = "DATE_FORMAT(DATE_ADD(STR_TO_DATE(occurred_at, '%Y-%m-%dT%H:%i:%s.%fZ'), INTERVAL ? MINUTE), ?)"; bindings.push(s.offset, mysqlFmt); }
    else { expression = 'strftime(?, occurred_at, ?)'; bindings.push(fmt, `${s.offset >= 0 ? '+' : ''}${s.offset} minutes`); }
    fragments.push(`WHEN occurred_at >= ? AND occurred_at < ? THEN ${expression}`);
    const unit = interval === 'day' ? 86400000 : 3600000;
    for (let local = Math.floor((s.start + s.offset * 60000) / unit) * unit; local < s.end + s.offset * 60000; local += unit) {
      const iso = new Date(local).toISOString(); keys.add(interval === 'day' ? iso.slice(0, 10) : iso.slice(0, 13) + ':00');
    }
  }
  return { expression: db.raw(`CASE ${fragments.join(' ')} END`, bindings), keys: [...keys].sort() };
}
