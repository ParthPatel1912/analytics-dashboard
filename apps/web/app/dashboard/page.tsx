import { Suspense } from 'react';
import { Dashboard } from '../../components/dashboard';
export default function Page() { return <Suspense fallback={<main className="restaurant-page">Loading analytics…</main>}><Dashboard /></Suspense>; }
