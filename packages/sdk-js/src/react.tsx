'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createAnalytics, type Analytics, type AnalyticsOptions } from './index.js';
const Context = createContext<Analytics | null>(null);
export function AnalyticsProvider({
  options,
  children,
}: {
  options: AnalyticsOptions;
  children: ReactNode;
}) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const holder = useRef<{ options: AnalyticsOptions; instance: Analytics; leases: number } | null>(
    null,
  );
  useEffect(() => {
    if (!holder.current || holder.current.options !== options) {
      holder.current?.instance.shutdown();
      holder.current = { options, instance: createAnalytics(options), leases: 0 };
    }
    const current = holder.current;
    current.leases++;
    setAnalytics(current.instance);
    return () => {
      current.leases--;
      // React Strict Mode immediately replays effects in development. Reuse its
      // tracker so a single mount does not create two initial page_view events.
      queueMicrotask(() => {
        if (!current.leases) {
          current.instance.shutdown();
          if (holder.current === current) holder.current = null;
        }
      });
    };
  }, [options]);
  return <Context.Provider value={analytics}>{children}</Context.Provider>;
}
export function useAnalytics() {
  return useContext(Context);
}
