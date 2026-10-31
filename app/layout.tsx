import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '../components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rekod Modal',
  description: 'Report harian dan rekod modal bulanan.',
  applicationName: 'Rekod Modal',
  appleWebApp: { capable: true, title: 'Rekod Modal', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ms">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
