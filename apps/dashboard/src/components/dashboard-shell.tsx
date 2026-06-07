'use client';

import { MoneyRainMatrix } from './money-rain-matrix';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MoneyRainMatrix />
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-b from-black/40 via-black/60 to-black/90" />
      <div className="relative z-10 min-h-screen">{children}</div>
    </>
  );
}
