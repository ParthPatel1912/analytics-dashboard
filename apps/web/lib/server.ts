export const apiBase = process.env.API_URL || 'http://127.0.0.1:4000';
export const dashboardToken = process.env.DASHBOARD_TOKEN;
if (!dashboardToken) throw new Error('DASHBOARD_TOKEN is required. Copy .env.example to .env.');
