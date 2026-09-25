'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { OptionChainTable } from '@/components/options/option-chain-table';
import { AlertTriangle } from 'lucide-react';

export default function OptionChainPage() {
  const params = useParams();
  const symbol = (params?.symbol as string)?.toUpperCase() || 'NIFTY50';

  const [data, setData] = useState<any>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadChain = async (expiry?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const url = `/api/options/${symbol}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Unable to load option chain.');
      }
      const json = await res.json();
      setData(json);
      setSelectedExpiry(json.chain.selectedExpiry);

      // Get user session role
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        const me = await meRes.json();
        if (me?.user) setUserRole(me.user.role);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to load option chain.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const handleExpiryChange = (exp: string) => {
    setSelectedExpiry(exp);
    loadChain(exp);
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          {errorMsg && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/40 rounded-xl text-rose-300 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <strong>Option chain unavailable:</strong> {errorMsg}
                <div className="text-xs text-rose-400/80 mt-0.5">
                  Options analysis requires active licensed provider derivative market data.
                </div>
              </div>
            </div>
          )}

          {data && (
            <OptionChainTable
              data={data}
              onExpiryChange={handleExpiryChange}
              isLoading={isLoading}
            />
          )}
        </main>
      </div>
    </div>
  );
}
