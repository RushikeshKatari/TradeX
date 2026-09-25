'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { formatINR } from '@/lib/utils';
import Link from 'next/link';
import { Plus, Trash2, ArrowUpRight, ArrowDownRight, TrendingUp } from 'lucide-react';

export default function WatchlistPage() {
  const [items, setItems] = useState<any[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');

  const loadWatchlist = async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
      const me = await fetch('/api/auth/me');
      if (me.ok) {
        const u = await me.json();
        if (u?.user) setUserRole(u.user.role);
      }
    } catch {}
  };

  useEffect(() => {
    loadWatchlist();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: newSymbol }),
      });
      if (res.ok) {
        setNewSymbol('');
        loadWatchlist();
      }
    } catch {}
  };

  const handleRemove = async (symbol: string) => {
    try {
      await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      loadWatchlist();
    } catch {}
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Market Watchlist</h1>
              <p className="text-xs text-slate-400 mt-1">
                Pin securities to track live quotes, spreads, and open technical setups.
              </p>
            </div>

            <form onSubmit={handleAdd} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Add symbol (e.g. SBIN)..."
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 uppercase font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>
          </div>

          <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                    <th className="py-2.5 px-4 text-left">Symbol</th>
                    <th className="py-2.5 px-3 text-left">Company</th>
                    <th className="py-2.5 px-3 text-right">LTP (₹)</th>
                    <th className="py-2.5 px-3 text-right">Change</th>
                    <th className="py-2.5 px-3 text-right">Day High</th>
                    <th className="py-2.5 px-3 text-right">Day Low</th>
                    <th className="py-2.5 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {items.map((item) => {
                    const isBull = item.change >= 0;
                    return (
                      <tr key={item.symbol} className="hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-4 text-left font-bold text-slate-200">
                          <Link href={`/stocks/${item.symbol}`} className="hover:text-indigo-400 flex items-center gap-1.5">
                            <span>{item.symbol}</span>
                            <span className="text-[10px] text-slate-500 font-normal">({item.exchange})</span>
                          </Link>
                        </td>
                        <td className="py-3 px-3 text-left text-slate-400">{item.name}</td>
                        <td className="py-3 px-3 text-right font-bold text-slate-100">
                          {formatINR(item.lastPrice)}
                        </td>
                        <td className={`py-3 px-3 text-right font-semibold ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isBull ? '+' : ''}{item.change.toFixed(2)} ({isBull ? '+' : ''}{item.changePercent.toFixed(2)}%)
                        </td>
                        <td className="py-3 px-3 text-right text-slate-300">₹{item.high}</td>
                        <td className="py-3 px-3 text-right text-slate-300">₹{item.low}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Link
                              href={`/stocks/${item.symbol}`}
                              className="px-2 py-1 text-[11px] font-semibold bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white rounded border border-indigo-500/30"
                            >
                              Chart
                            </Link>
                            <button
                              onClick={() => handleRemove(item.symbol)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                              title="Remove from Watchlist"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
