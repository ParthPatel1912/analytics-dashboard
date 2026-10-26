'use client';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnalyticsProvider, useAnalytics } from '@pkg/sdk-js/react';
import type { AnalyticsOptions } from '@pkg/sdk-js';
export interface MenuItem {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  emoji: string;
}
export interface CartItem {
  item: MenuItem;
  quantity: number;
}
const CartContext = createContext<{
  cart: CartItem[];
  add: (item: MenuItem) => void;
  remove: (id: number) => void;
  clear: () => void;
  ready: boolean;
}>({ cart: [], add: () => {}, remove: () => {}, clear: () => {}, ready: false });
export const useCart = () => useContext(CartContext);
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function Shell({ children }: { children: ReactNode }) {
  const analytics = useAnalytics(),
    path = usePathname();
  const [cart, setCart] = useState<CartItem[]>([]),
    [ready, setReady] = useState(false),
    [optedOut, setOptedOut] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('restaurant_cart') || '[]');
      if (Array.isArray(stored))
        setCart(
          stored.filter(
            (i): i is CartItem =>
              i &&
              Number.isInteger(i.quantity) &&
              i.quantity >= 1 &&
              i.quantity <= 20 &&
              i.item &&
              Number.isInteger(i.item.id) &&
              i.item.id > 0 &&
              Number.isInteger(i.item.price) &&
              i.item.price >= 0 &&
              ['name', 'description', 'category', 'emoji'].every(
                (key) => typeof i.item[key] === 'string',
              ),
          ),
        );
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem('restaurant_cart', JSON.stringify(cart));
      } catch {}
  }, [cart, ready]);
  useEffect(() => {
    if (analytics) setOptedOut(analytics.getIdentity() === null);
  }, [analytics]);
  const add = (item: MenuItem) => {
    setCart((old) => {
      const found = old.find((i) => i.item.id === item.id);
      return found
        ? old.map((i) =>
            i.item.id === item.id ? { ...i, quantity: Math.min(i.quantity + 1, 20) } : i,
          )
        : [...old, { item, quantity: 1 }];
    });
    analytics?.track('add_to_cart', { menu_item_id: item.id, item_name: item.name });
  };
  const remove = (id: number) => {
    setCart((old) => old.filter((i) => i.item.id !== id));
    analytics?.track('remove_from_cart', { menu_item_id: id });
  };
  return (
    <CartContext.Provider value={{ cart, add, remove, clear: () => setCart([]), ready }}>
      {path !== '/dashboard' && (
        <header className="site-header">
          <Link className="brand" href="/">
            t<span>&</span>t <b>Table & Thyme</b>
          </Link>
          <nav>
            <Link className={path === '/' ? 'active' : ''} href="/">
              Our kitchen
            </Link>
            <Link className={path === '/menu' ? 'active' : ''} href="/menu">
              Menu
            </Link>
            <Link href="/dashboard">Analytics ↗</Link>
            <Link className="cart-link" href="/cart">
              Your bag <span>{cart.reduce((n, i) => n + i.quantity, 0)}</span>
            </Link>
          </nav>
        </header>
      )}
      {children}
      <footer>
        <span>
          Table & Thyme <small>· A working analytics demo</small>
        </span>
        <button
          className="text-button"
          onClick={() => {
            if (optedOut) analytics?.optIn();
            else analytics?.optOut();
            setOptedOut(!optedOut);
          }}
        >
          {optedOut ? 'Enable browser analytics' : 'Opt out of browser analytics'}
        </button>
        <Link href="/dashboard">View the data ↗</Link>
      </footer>
    </CartContext.Provider>
  );
}
export function Providers({
  options,
  children,
}: {
  options: AnalyticsOptions;
  children: ReactNode;
}) {
  return (
    <AnalyticsProvider options={options}>
      <Shell>{children}</Shell>
    </AnalyticsProvider>
  );
}
