'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createAnalytics, type Analytics, type AnalyticsOptions } from './index.js';
const Context = createContext<Analytics | null>(null);
export function AnalyticsProvider({ options, children }: { options: AnalyticsOptions; children: ReactNode }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  useEffect(() => { const instance = createAnalytics(options); setAnalytics(instance); return () => instance.shutdown(); }, [options]);
  return <Context.Provider value={analytics}>{children}</Context.Provider>;
}
export function useAnalytics() { return useContext(Context); }
