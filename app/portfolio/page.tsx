'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { PortfolioView } from '@/components/portfolio/portfolio-view';

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');
  const refreshInProgress = useRef(false);

  const loadPortfolio = useCallback(async () => {
    if (refreshInProgress.current) return;
    refreshInProgress.current = true;

    try {
      const res = await fetch('/api/portfolio', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPortfolio(data);
      }

      const me = await fetch('/api/auth/me', { cache: 'no-store' });
      if (me.ok) {
        const u = await me.json();
        if (u?.user) setUserRole(u.user.role);
      }
    } catch {
      // Keep the last successful portfolio visible during transient errors.
    } finally {
      refreshInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    void loadPortfolio();
    const refreshTimer = window.setInterval(() => void loadPortfolio(), 3_000);
    return () => window.clearInterval(refreshTimer);
  }, [loadPortfolio]);

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Paper Trading Portfolio</h1>
            <p className="text-xs text-slate-400 mt-1">
              Real-time mark-to-market positions, equity holdings, and realized financial ledger.
            </p>
          </div>

          {portfolio ? (
            <PortfolioView
              summary={portfolio.summary}
              positions={portfolio.positions}
              holdings={portfolio.holdings}
              onRefresh={loadPortfolio}
            />
          ) : (
            <div className="p-8 text-center text-slate-500 font-mono text-sm">
              Loading simulated portfolio...
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
