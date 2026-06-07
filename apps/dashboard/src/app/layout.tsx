import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { DashboardShell } from '../components/dashboard-shell';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MEV Research Bot',
  description: 'Solana arbitrage execution dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-black text-white antialiased overflow-x-hidden`}>
        <Providers>
          <DashboardShell>{children}</DashboardShell>
        </Providers>
      </body>
    </html>
  );
}
