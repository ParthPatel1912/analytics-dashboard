import type { Metadata } from 'next';
import { Providers } from '../components/providers';
import './globals.css';
export const metadata: Metadata = {
  title: 'Table & Thyme · Kitchen & Analytics',
  description: 'A neighborhood kitchen with an end-to-end analytics demo.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const options = {
    writeKey: process.env.DEMO_PUBLIC_KEY || 'pk_local_restaurant',
    endpoint:
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || 'http://localhost:4000/api/v1/events/batch',
    autoPageViews: true,
  };
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers options={options}>{children}</Providers>
      </body>
    </html>
  );
}
