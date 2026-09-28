'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { BacktestResult, BacktestStrategyType } from '@/types/backtest';
import { formatINR } from '@/lib/utils';
import {
  Play,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
  DollarSign,
  AlertCircle,
  Activity,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

const SYMBOLS = ['NIFTY50', 'BANKNIFTY', 'RELIANCE', 'TCS', 'INFY'];
const STRATEGIES: { id: BacktestStrategyType; name: string; desc: string }[] = [
  {
    id: 'REGIME_MOMENTUM',
    name: 'Multi-Factor Regime Momentum',
    desc: 'Enters Long Call on Bullish regimes and Long Put on Bearish regimes when Risk/Reward > 0.4:1',
  },
  {
    id: 'LONG_CALL_BREAKOUT',
    name: 'Bullish Breakout Calls Only',
    desc: 'Filters exclusively for high-confidence Bullish regime expansions with favorable upside',
  },
  {
    id: 'LONG_PUT_BREAKDOWN',
    name: 'Bearish Breakdown Puts Only',
    desc: 'Targets directional bearish momentum shifts and volatility breakdown regimes',
  },
];

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('NIFTY50');
  const [strategy, setStrategy] = useState<BacktestStrategyType>('REGIME_MOMENTUM');
  const [startingCapital, setStartingCapital] = useState(500000);
  const [lotSize, setLotSize] = useState(25);
  const [slippage, setSlippage] = useState(0.5);
  const [costPerTrade, setCostPerTrade] = useState(20);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunBacktest = React.useCallback(async () => {
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      setError('Starting capital must be greater than zero.');
      return;
    }
    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      setError('Lot size must be greater than zero.');
      return;
    }
    if (!Number.isFinite(slippage) || slippage < 0 || !Number.isFinite(costPerTrade) || costPerTrade < 0) {
      setError('Slippage and cost per trade cannot be negative.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strategy,
          startingCapital,
          lotSize,
          slippagePerUnit: slippage,
          costPerTrade,
          from,
          to,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.details || payload?.error || `Backtest failed (${res.status})`);
      }
      if (!payload || !payload.metrics || !Array.isArray(payload.trades)) {
        throw new Error('Backtest returned an invalid result. Please try again.');
      }
      setResult(payload as BacktestResult);
    } catch (err) {
      console.error('Backtest run error:', err);
      setError(err instanceof Error ? err.message : 'Unable to run backtest.');
    } finally {
      setLoading(false);
    }
  }, [symbol, strategy, startingCapital, lotSize, slippage, costPerTrade, from, to]);

  // Automatically execute on first load
  useEffect(() => {
    handleRunBacktest();
  }, [handleRunBacktest]);

  const isProfitable = (result?.metrics.totalPnl || 0) >= 0;

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
                  <BarChart3 className="w-4 h-4" />
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Options Strategy Backtest Engine</h1>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Simulate historical option trade performance, regime win rates, and mark-to-market drawdown
              </p>
            </div>

            <button
              onClick={handleRunBacktest}
              disabled={loading}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>Computing Multi-Bar Simulation...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Run Backtest</span>
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result?.status === 'INSUFFICIENT_DATA' && result.message && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{result.message}</span>
            </div>
          )}

          {/* Config Controls */}
          <div className="bg-[#0e1320] border border-border rounded-xl p-5 shadow-lg">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Simulation Parameters
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              {/* Symbol */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Underlying Instrument</label>
                <select
                  value={symbol}
                  onChange={(e) => {
                    const s = e.target.value;
                    setSymbol(s);
                    if (s === 'BANKNIFTY') setLotSize(15);
                    else if (s === 'NIFTY50') setLotSize(25);
                    else setLotSize(100);
                  }}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                >
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Strategy */}
              <div className="lg:col-span-2">
                <label className="text-xs text-slate-400 block mb-1.5">Trading Strategy</label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as BacktestStrategyType)}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {STRATEGIES.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Starting Capital */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Initial Capital (₹)</label>
                <input
                  type="number"
                  value={startingCapital}
                  onChange={(e) => setStartingCapital(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Lot Size */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Lot Size (Units)</label>
                <input
                  type="number"
                  value={lotSize}
                  onChange={(e) => setLotSize(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Brokerage & Slippage */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Cost / Trade (₹)</label>
                <input
                  type="number"
                  value={costPerTrade}
                  onChange={(e) => setCostPerTrade(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Results Overview */}
          {result && (
            <>
              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Net P&amp;L</span>
                  <div className={`text-xl font-bold font-mono ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isProfitable ? '+' : ''}
                    {formatINR(result.metrics.totalPnl)}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {result.metrics.returnOnCapital >= 0 ? '+' : ''}
                    {result.metrics.returnOnCapital}% ROC
                  </span>
                </div>

                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Win Rate</span>
                  <div className="text-xl font-bold font-mono text-cyan-300">
                    {result.metrics.winRate}%
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {result.metrics.winningTrades}W / {result.metrics.losingTrades}L
                  </span>
                </div>

                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Total Trades</span>
                  <div className="text-xl font-bold font-mono text-white">
                    {result.metrics.totalTrades}
                  </div>
                  <span className="text-[10px] text-slate-400">Executed positions</span>
                </div>

                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Profit Factor</span>
                  <div className="text-xl font-bold font-mono text-indigo-400">
                    {result.metrics.profitFactor}x
                  </div>
                  <span className="text-[10px] text-slate-400">Gross profit / loss</span>
                </div>

                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Max Drawdown</span>
                  <div className="text-xl font-bold font-mono text-amber-400">
                    -{formatINR(result.metrics.maxDrawdown)}
                  </div>
                  <span className="text-[10px] text-slate-400">-{result.metrics.maxDrawdownPct}% of peak</span>
                </div>

                <div className="bg-[#0e1320] border border-border rounded-xl p-4 shadow">
                  <span className="text-[11px] text-slate-400 block mb-1">Ending Capital</span>
                  <div className="text-xl font-bold font-mono text-white">
                    {formatINR(result.metrics.finalCapital)}
                  </div>
                  <span className="text-[10px] text-slate-400">From {formatINR(startingCapital)}</span>
                </div>
              </div>

              {/* Regime Performance Table */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-[#0e1320] border border-border rounded-xl p-5 shadow">
                  <h3 className="font-semibold text-white text-sm mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    <span>Performance by Market Regime</span>
                  </h3>
                  <div className="space-y-3">
                    {result.regimePerformance.length > 0 ? (
                      result.regimePerformance.map((rp) => (
                        <div key={rp.regime} className="bg-slate-900/80 border border-border/80 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold font-mono text-white">{rp.regime}</span>
                            <span
                              className={`text-xs font-bold font-mono ${
                                rp.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {rp.pnl >= 0 ? '+' : ''}
                              {formatINR(rp.pnl)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>{rp.trades} trades</span>
                            <span>Win Rate: {rp.winRate}%</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500 py-4 text-center">No trades generated for regimes.</div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/60">
                    <div className="text-xs font-semibold text-slate-400 mb-2">Signal Distribution</div>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-slate-900 p-2 rounded border border-border/40 text-slate-300">
                        <span className="text-emerald-400 font-bold block">CALL</span>
                        {result.signalCounts['LONG_CALL'] || 0} bars
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-border/40 text-slate-300">
                        <span className="text-rose-400 font-bold block">PUT</span>
                        {result.signalCounts['LONG_PUT'] || 0} bars
                      </div>
                    </div>
                  </div>
                </div>

                {/* Executed Trade Log */}
                <div className="lg:col-span-2 bg-[#0e1320] border border-border rounded-xl p-5 shadow flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Simulated Trade Log</span>
                    </h3>
                    <span className="text-xs text-slate-400 font-mono">
                      {result.trades.length} positions recorded
                    </span>
                  </div>

                  <div className="overflow-x-auto flex-1 max-h-[380px] overflow-y-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900 text-slate-400 border-b border-border sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Strike</th>
                          <th className="py-2.5 px-3">Entry</th>
                          <th className="py-2.5 px-3">Exit</th>
                          <th className="py-2.5 px-3 text-right">P&amp;L</th>
                          <th className="py-2.5 px-3 text-right">Return</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-slate-300">
                        {result.trades.length > 0 ? (
                          result.trades.map((t) => {
                            const won = t.pnl > 0;
                            return (
                              <tr key={t.id} className="hover:bg-slate-800/40">
                                <td className="py-2 px-3 text-slate-400">
                                  {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      t.optionType === 'CE'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                    }`}
                                  >
                                    {t.optionType}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-semibold text-white">{t.strike}</td>
                                <td className="py-2 px-3">₹{t.entryPrice}</td>
                                <td className="py-2 px-3">₹{t.exitPrice}</td>
                                <td
                                  className={`py-2 px-3 text-right font-bold ${
                                    won ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  {won ? '+' : ''}
                                  {formatINR(t.pnl)}
                                </td>
                                <td
                                  className={`py-2 px-3 text-right font-semibold ${
                                    won ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  {t.returnPct >= 0 ? '+' : ''}
                                  {t.returnPct}%
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500">
                              No trades executed under current parameters. Try adjusting the lot size or instrument.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
