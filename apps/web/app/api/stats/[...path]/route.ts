import { apiBase, dashboardToken } from '../../../../lib/server';
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = path.join('/');
  if (!['overview', 'timeseries', 'top-pages', 'events', 'recent'].includes(target)) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const url = new URL(request.url);
    const response = await fetch(`${apiBase}/api/v1/${target === 'recent' ? 'events/recent' : 'stats/' + target}${url.search}`, { headers: { Authorization: `Bearer ${dashboardToken}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return Response.json(await response.json(), { status: response.status });
  } catch { return Response.json({ error: 'Analytics API is unavailable. Start the API on port 4000.' }, { status: 502 }); }
}
