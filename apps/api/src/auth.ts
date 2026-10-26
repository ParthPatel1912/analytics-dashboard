import { timingSafeEqual } from 'node:crypto';
export function safeEqual(a: string, b: string) {
  const actual = Buffer.from(a),
    expected = Buffer.from(b);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const bearerToken = (header: string | undefined) => header?.match(/^Bearer ([^\s]+)$/i)?.[1];
