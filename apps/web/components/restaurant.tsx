'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAnalytics } from '@pkg/sdk-js/react';
import { useCart, money, type MenuItem } from './providers';
async function load(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
export function Menu() {
  const [items, setItems] = useState<MenuItem[]>([]),
    [error, setError] = useState(''),
    [category, setCategory] = useState('All plates'),
    [added, setAdded] = useState<number | null>(null);
  const { add } = useCart(),
    analytics = useAnalytics();
  useEffect(() => {
    let active = true;
    load('/api/restaurant/menu')
      .then((d) => {
        if (active) setItems(d.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="restaurant-page">
      <p className="eyebrow">FRESH FROM THE KITCHEN</p>
      <div className="page-heading">
        <div>
          <h1>Good things on the menu.</h1>
          <p>Seasonal favorites, made for your table.</p>
        </div>
        <Link href="/cart" className="button secondary">
          View your bag →
        </Link>
      </div>
      <div className="category-tabs">
        {['All plates', 'Starters', 'Mains', 'Desserts', 'Drinks'].map((c) => (
          <button
            key={c}
            className={category === c ? 'selected' : ''}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="error">
          {error} <button onClick={() => location.reload()}>Try again</button>
        </div>
      ) : !items.length ? (
        <p className="empty">Loading today’s menu…</p>
      ) : (
        <div className="menu-grid">
          {items
            .filter((i) => category === 'All plates' || i.category === category)
            .map((i) => (
              <article className="menu-card" key={i.id}>
                <button
                  className="menu-art"
                  aria-label={`View ${i.name}`}
                  onClick={() => {
                    analytics?.track('menu_item_viewed', { menu_item_id: i.id, item_name: i.name });
                    setAdded(-i.id);
                  }}
                >
                  <span>{i.emoji}</span>
                  <small>{added === -i.id ? i.description : i.category}</small>
                </button>
                <div className="menu-info">
                  <div>
                    <h3>{i.name}</h3>
                    <b>{money(i.price)}</b>
                  </div>
                  <p>{i.description}</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      analytics?.track('menu_item_viewed', { menu_item_id: i.id });
                      add(i);
                      setAdded(i.id);
                    }}
                  >
                    {added === i.id ? 'Added to your bag ✓' : 'Add to bag + '}
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
    </main>
  );
}
export function Cart() {
  const { cart, remove, ready } = useCart(),
    analytics = useAnalytics();
  const total = cart.reduce((n, i) => n + i.item.price * i.quantity, 0);
  return (
    <main className="restaurant-page narrow">
      <p className="eyebrow">YOUR TABLE IS WAITING</p>
      <h1>Your bag.</h1>
      <p>A few good choices, ready for the kitchen.</p>
      {!ready ? (
        <p>Loading your bag…</p>
      ) : !cart.length ? (
        <div className="empty">
          <h2>Something delicious belongs here.</h2>
          <Link className="button" href="/menu">
            Explore the menu →
          </Link>
        </div>
      ) : (
        <>
          <div className="cart-items">
            {cart.map((i) => (
              <article key={i.item.id} className="cart-row">
                <span className="cart-emoji">{i.item.emoji}</span>
                <div>
                  <h3>{i.item.name}</h3>
                  <p>
                    Quantity: {i.quantity} · {money(i.item.price)} each
                  </p>
                  <button className="text-button" onClick={() => remove(i.item.id)}>
                    Remove
                  </button>
                </div>
                <strong>{money(i.item.price * i.quantity)}</strong>
              </article>
            ))}
          </div>
          <div className="cart-total">
            <span>Total · USD</span>
            <strong>{money(total)}</strong>
          </div>
          <Link
            className="button full"
            href="/checkout"
            onClick={() =>
              analytics?.track('checkout_started', {
                total,
                item_count: cart.reduce((n, i) => n + i.quantity, 0),
              })
            }
          >
            Continue to checkout →
          </Link>
          <p className="muted">Demo checkout. No payment details needed.</p>
        </>
      )}
    </main>
  );
}
export function Checkout() {
  const { cart, clear, ready } = useCart(),
    analytics = useAnalytics(),
    router = useRouter();
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const bytes = new TextEncoder().encode(email.trim().toLowerCase());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const userId =
        'demo_' +
        Array.from(new Uint8Array(digest))
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
      analytics?.identify(userId);
      void analytics?.flush();
      const id = analytics?.getIdentity();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (id) {
        headers['X-Analytics-Anonymous-Id'] = id.anonymous_id;
        headers['X-Analytics-Session-Id'] = id.session_id;
        if (id.user_id) headers['X-Analytics-User-Id'] = id.user_id;
      }
      const order = await load('/api/restaurant/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: cart.map((i) => ({ menu_item_id: i.item.id, quantity: i.quantity })),
        }),
      });
      clear();
      router.push(`/order/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to place order');
      setBusy(false);
    }
  }
  return (
    <main className="restaurant-page narrow">
      <p className="eyebrow">ONE LAST THING</p>
      <h1>Make yourself at home.</h1>
      <p>This is a demo order. Nothing will be charged.</p>
      {!ready ? (
        <p>Loading…</p>
      ) : !cart.length && !busy ? (
        <div className="empty">
          <p>Your bag is empty.</p>
          <Link href="/menu" className="button">
            Browse the menu
          </Link>
        </div>
      ) : (
        <form className="checkout-form" onSubmit={submit}>
          <label>
            Your name
            <input
              required
              maxLength={100}
              autoComplete="given-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
            />
          </label>
          <label>
            Email for demo identity
            <input
              required
              type="email"
              maxLength={200}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
            />
          </label>
          <p className="muted">
            Your name stays in this form. Only an email hash is used as the demo analytics ID.
          </p>
          <div className="cart-total">
            <span>Order total · USD</span>
            <strong>{money(cart.reduce((n, i) => n + i.quantity * i.item.price, 0))}</strong>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button full" disabled={busy} type="submit">
            {busy ? 'Sending to the kitchen…' : 'Place demo order →'}
          </button>
        </form>
      )}
    </main>
  );
}
export function Confirmation({ id }: { id: string }) {
  const [order, setOrder] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    load(`/api/restaurant/orders/${encodeURIComponent(id)}`)
      .then(setOrder)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="restaurant-page narrow confirmation">
      <div className="success-mark">✓</div>
      <p className="eyebrow">THANK YOU FOR STOPPING BY</p>
      <h1>Good food is on its way.</h1>
      <p>Your demo order has been sent to our kitchen.</p>
      {error ? (
        <p className="error">{error}</p>
      ) : !order ? (
        <p>Loading your order…</p>
      ) : (
        <div className="order-receipt">
          <span className="muted">ORDER {order.id.slice(0, 8).toUpperCase()}</span>
          {order.items.map((i: any, index: number) => (
            <div className="receipt-row" key={index}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <b>{money(i.quantity * i.unit_price)}</b>
            </div>
          ))}
          <div className="cart-total">
            <span>Total · {order.currency}</span>
            <strong>{money(order.total)}</strong>
          </div>
        </div>
      )}
      <p>There’s a story behind this order. See it arrive in your analytics.</p>
      <Link className="button" href="/dashboard">
        Open analytics ↗
      </Link>
      <Link href="/menu" className="text-link">
        Back to the menu
      </Link>
    </main>
  );
}
