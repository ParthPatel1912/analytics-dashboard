import { apiBase } from '../../../../lib/server';
async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params; const target = path.join('/');
  if (!/^(menu|orders(?:\/[0-9a-f-]{36})?)$/.test(target) || !['GET', 'POST'].includes(request.method)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const key of ['x-analytics-anonymous-id', 'x-analytics-session-id', 'x-analytics-user-id']) { const value = request.headers.get(key); if (value) headers[key] = value; }
    const response = await fetch(`${apiBase}/api/${target}`, { method: request.method, headers, ...(request.method === 'POST' ? { body: await request.text() } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ error: 'Restaurant API is unavailable. Please try again shortly.' }, { status: 502 }); }
}
export { proxy as GET, proxy as POST };
