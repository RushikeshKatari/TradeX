'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { CandlestickChart } from '@/components/charts/candlestick-chart';
import { TechnicalSetupCard } from '@/components/analysis/technical-setup-card';
import { OrderTicket } from '@/components/trading/order-ticket';
import { Quote, Candle, CandleInterval } from '@/types/market';
import { TechnicalAnalysisResult } from '@/lib/analysis/engine';
import { formatINR } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, Layers, BookmarkPlus, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function StockDetailPage() {
  const params = useParams();
  const symbol = (params?.symbol as string)?.toUpperCase() || 'RELIANCE';

  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [analysis, setAnalysis] = useState<TechnicalAnalysisResult | null>(null);
  const [interval, setInterval] = useState<CandleInterval>('1D');
  const [userBalance, setUserBalance] = useState<number>(1000000);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch Quote
      const quoteRes = await fetch(`/api/market/quote/${symbol}`);
      if (!quoteRes.ok) {
        const err = await quoteRes.json();
        throw new Error(err.error || 'Market data temporarily unavailable.');
      }
      const quoteData = await quoteRes.json();
      setQuote(quoteData);

      // 2. Fetch Candles & Analysis
      const candleRes = await fetch(`/api/market/candles/${symbol}?interval=${interval}`);
      if (candleRes.ok) {
        const candleData = await candleRes.json();
        setCandles(candleData.candles || []);
        setAnalysis(candleData.analysis || null);
      }

      // 3. Fetch User session
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData?.user) {
          setUserBalance(meData.user.balance);
          setUserRole(meData.user.role);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Market data temporarily unavailable.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  const handleAddToWatchlist = async () => {
    try {
      await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      alert(`${symbol} added to watchlist!`);
    } catch {}
  };

  const isBull = (quote?.change ?? 0) >= 0;

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          {/* Market Data Error Notice if live provider is down/unconfigured */}
          {errorMsg && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/40 rounded-xl text-rose-300 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <strong>Live market data unavailable:</strong> {errorMsg}
                <div className="text-xs text-rose-400/80 mt-0.5">
                  Production requires a valid market data provider feed. No fake market prices are generated.
                </div>
              </div>
            </div>
          )}

          {/* Stock Header Card */}
          {quote && (
            <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-white">{quote.symbol}</h1>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                    {quote.exchange}
                  </span>
                  <span className="text-xs text-slate-400">({quote.name})</span>
                </div>

                <div className="flex items-baseline gap-3 mt-1 font-mono">
                  <span className="text-3xl font-bold text-white">
                    ₹{quote.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  <span className={`flex items-center text-sm font-semibold ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isBull ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {isBull ? '+' : ''}{quote.change.toFixed(2)} ({isBull ? '+' : ''}{quote.changePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>

              {/* Day High / Low / Volume */}
              <div className="flex flex-wrap items-center gap-6 text-xs font-mono text-slate-400">
                <div>
                  <span className="text-slate-500 block text-[10px]">DAY RANGE</span>
                  <span className="text-slate-200">
                    ₹{quote.low} - ₹{quote.high}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">PREV. CLOSE</span>
                  <span className="text-slate-200">₹{quote.previousClose}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">VOLUME</span>
                  <span className="text-slate-200">{quote.volume.toLocaleString('en-IN')}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">FEED</span>
                  <span className="text-indigo-400">{quote.isDelayed ? 'Delayed Feed' : 'Live Feed'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddToWatchlist}
                    className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                    title="Add to Watchlist"
                  >
                    <BookmarkPlus className="w-4 h-4" />
                  </button>
                  <Link
                    href={`/options/${quote.symbol}`}
                    className="px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Options</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Main Grid: Chart & Order Slip */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart Area */}
            <div className="lg:col-span-2 space-y-6">
              <CandlestickChart
                candles={candles}
                symbol={symbol}
                interval={interval}
                onIntervalChange={setInterval}
                isLoading={isLoading}
              />

              {/* Technical Analysis Setup Card */}
              <TechnicalSetupCard analysis={analysis} symbol={symbol} />
            </div>

            {/* Paper Trading Ticket */}
            <div className="space-y-6">
              <OrderTicket
                quote={quote}
                userBalance={userBalance}
                onOrderSuccess={loadData}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
