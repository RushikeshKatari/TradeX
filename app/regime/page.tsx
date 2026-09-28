'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { RegimeCard } from '@/components/analysis/regime-card';
import { OptionsSignalCard } from '@/components/options/options-signal-card';
import { RegimeResult } from '@/types/regime';
import { OptionsSignal } from '@/types/options-signal';
import Link from 'next/link';
import { Compass, RefreshCw, BarChart2, Layers } from 'lucide-react';

const SYMBOLS = [
  { id: 'NIFTY50', label: 'NIFTY 50' },
  { id: 'BANKNIFTY', label: 'BANK NIFTY' },
  { id: 'SENSEX', label: 'SENSEX' },
  { id: 'RELIANCE', label: 'RELIANCE' },
  { id: 'TCS', label: 'TCS' },
  { id: 'INFY', label: 'INFY' },
];

export default function RegimePage() {
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY50');
  const [regime, setRegime] = useState<RegimeResult | null>(null);
  const [signal, setSignal] = useState<OptionsSignal | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async (sym: string) => {
    setLoading(true);
    try {
      const [regimeRes, signalRes] = await Promise.all([
        fetch(`/api/analysis/regime/${sym}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/analysis/options-signal/${sym}`).then((r) => (r.ok ? r.json() : null)),
      ]);
      setRegime(regimeRes);
      setSignal(signalRes?.signal || null);
    } catch (err) {
      console.error('Failed to load regime data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(selectedSymbol);
  }, [selectedSymbol]);

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col font-sans">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Compass className="w-4 h-4" />
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Market Regime &amp; Sentiment Radar</h1>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Multi-factor technical consensus, trend velocity, volatility regime, and options signal alignment
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/backtest"
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-border flex items-center gap-1.5 transition-colors"
              >
                <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Open Backtest Terminal</span>
              </Link>

              <button
                onClick={() => fetchData(selectedSymbol)}
                disabled={loading}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-border transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Symbol Selector Tabs */}
          <div className="flex items-center gap-2 border-b border-border/80 pb-3 overflow-x-auto">
            {SYMBOLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSymbol(s.id)}
                className={`px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all shrink-0 ${
                  selectedSymbol === s.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-border/60'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Radar & Signal Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RegimeCard regime={regime} symbol={selectedSymbol} loading={loading} />
            <OptionsSignalCard signal={signal} symbol={selectedSymbol} loading={loading} />
          </div>

          {/* Explanation Section */}
          <div className="bg-[#0e1320] border border-border rounded-xl p-5 shadow">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Understanding the Multi-Factor Regime Engine
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
              <div className="bg-slate-900/60 p-3.5 rounded-lg border border-border/40">
                <span className="font-bold text-white block mb-1">1. Weighted Indicator Matrix</span>
                Aggregates EMA 20/50 crossovers (20%), RSI momentum (15%), Put-Call Ratio (15%), ADX trend strength (10%), VWAP institutional bias (10%), and Bollinger volatility (15%).
              </div>
              <div className="bg-slate-900/60 p-3.5 rounded-lg border border-border/40">
                <span className="font-bold text-white block mb-1">2. Asymmetric Risk/Reward Filter</span>
                Naked option buys are strictly gated. Signals only fire when the market&apos;s expected move exceeds the option premium with a minimum 0.4:1 reward-to-risk ratio.
              </div>
              <div className="bg-slate-900/60 p-3.5 rounded-lg border border-border/40">
                <span className="font-bold text-white block mb-1">3. Sideways Protection</span>
                During range-bound sideways regimes, naked CE/PE trades are silenced to protect paper capital from theta time-decay, prioritizing volatility strategies only on high-volatility expansions.
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
