'use client';

import React, { useState } from 'react';
import { PortfolioSummary, PositionView, HoldingView } from '@/types/trading';
import { formatINR } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, PieChart, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

interface PortfolioViewProps {
  summary: PortfolioSummary;
  positions: PositionView[];
  holdings: HoldingView[];
  onRefresh?: () => void;
}

export function PortfolioView({ summary, positions, holdings, onRefresh }: PortfolioViewProps) {
  const [exitingId, setExitingId] = useState<string | null>(null);
  const isTotalPnlPositive = summary.totalUnrealizedPnL + summary.totalRealizedPnL >= 0;

  return (
    <div className="space-y-6">
      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Net Worth */}
        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Net Worth</span>
            <PieChart className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatINR(summary.totalAccountValue)}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Cash: {formatINR(summary.cashBalance)}
          </span>
        </div>

        {/* Invested Value */}
        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Invested Value</span>
            <Wallet className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatINR(summary.investedValue)}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Current: {formatINR(summary.currentValue)}
          </span>
        </div>

        {/* Unrealized P&L */}
        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Unrealized P&L</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div
            className={`text-2xl font-bold font-mono flex items-center gap-1 ${
              summary.totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {summary.totalUnrealizedPnL >= 0 ? '+' : ''}
            {formatINR(summary.totalUnrealizedPnL)}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Open positions mark-to-market</span>
        </div>

        {/* Realized P&L */}
        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Realized P&L</span>
            {isTotalPnlPositive ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div
            className={`text-2xl font-bold font-mono ${
              summary.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {summary.totalRealizedPnL >= 0 ? '+' : ''}
            {formatINR(summary.totalRealizedPnL)}
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">Closed trades accumulated</span>
        </div>
      </div>

      {/* Active Positions */}
      <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Open Positions ({positions.length})
          </h3>
          <span className="text-xs text-slate-500 font-mono">Live Mark-to-Market</span>
        </div>

        {positions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No open paper trading positions currently held.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
            {positions.map((pos) => {
                  const isPos = pos.unrealizedPnL >= 0;
                  const isOption = pos.instrumentType === 'OPTION';
                  const displayedCurrentValue = isOption
                    ? pos.currentPrice * (pos.lotSize || 0) * (pos.lots || 0)
                    : pos.currentValue;
                  const handleManualExit = async () => {
                    setExitingId(pos.id);
                    try {
                      const response = await fetch('/api/expert-picks/exit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: pos.symbol, quantity: pos.quantity, price: pos.currentPrice, reason: 'MANUAL_EXIT' }),
                      });
                      if (!response.ok) throw new Error('Manual exit failed');
                      onRefresh?.();
                    } finally {
                      setExitingId(null);
                    }
                  };
                  return (
                    <div key={pos.id} className="rounded-lg border border-border bg-slate-900/60 p-4 hover:border-indigo-500/40 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Link href={`/stocks/${pos.symbol}`} className="text-xs font-bold text-slate-400 hover:text-indigo-400">
                            {pos.symbol}
                          </Link>
                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-[11px] uppercase tracking-wider text-slate-500">Strike</span>
                            <span className="text-2xl font-bold font-mono text-white">{pos.strike ?? '—'}</span>
                            {pos.optionType && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pos.optionType === 'CE' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                {pos.optionType}
                              </span>
                            )}
                          </div>
                        </div>
                        {isOption ? (
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-wider text-slate-500">Exit</div>
                            <button onClick={handleManualExit} disabled={exitingId === pos.id} className="mt-1 px-3 py-1.5 text-[11px] font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white rounded border border-rose-500/30 transition-all">
                              {exitingId === pos.id ? 'Exiting...' : 'Exit'}
                            </button>
                          </div>
                        ) : (
                          <Link href={`/stocks/${pos.symbol}`} className="mt-1 px-3 py-1.5 text-[11px] font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white rounded border border-rose-500/30 transition-all">Trade / Square off</Link>
                        )}
                      </div>
                      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border pt-3 text-xs font-mono">
                        <div><div className="text-slate-500">Current Value</div><div className="mt-1 font-semibold text-white">{formatINR(displayedCurrentValue)}</div></div>
                        <div><div className="text-slate-500">P&L</div><div className={`mt-1 font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>{isPos ? '+' : ''}{formatINR(pos.unrealizedPnL)}</div></div>
                        <div><div className="text-slate-500">LTP</div><div className="mt-1 text-slate-200">{formatINR(pos.currentPrice)}</div></div>
                        <div><div className="text-slate-500">Lots / Qty</div><div className="mt-1 text-slate-200">{pos.lots || '—'} / {pos.quantity}</div></div>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-500">Entry {formatINR(pos.averageEntryPrice)} · Invested {formatINR(pos.investedValue)} · {isPos ? '+' : ''}{pos.unrealizedPnLPercent}%</div>
                    </div>
                  );
            })}
          </div>
        )}
      </div>

      {/* Long-Term Holdings Table */}
      <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Holdings & Equity Assets ({holdings.length})
          </h3>
        </div>

        {holdings.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No equity holdings in virtual portfolio.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                  <th className="py-2.5 px-4 text-left">Symbol</th>
                  <th className="py-2.5 px-3 text-right">Shares</th>
                  <th className="py-2.5 px-3 text-right">Avg Cost</th>
                  <th className="py-2.5 px-3 text-right">Current Price</th>
                  <th className="py-2.5 px-3 text-right">Invested Value</th>
                  <th className="py-2.5 px-3 text-right">Current Value</th>
                  <th className="py-2.5 px-4 text-right">Total Gain/Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {holdings.map((h) => {
                  const isGain = h.pnl >= 0;
                  return (
                    <tr key={h.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 text-left font-bold text-slate-200">
                        <Link href={`/stocks/${h.symbol}`} className="hover:text-indigo-400">
                          {h.symbol}
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-right text-slate-300">{h.quantity}</td>
                      <td className="py-3 px-3 text-right text-slate-400">{formatINR(h.averagePrice)}</td>
                      <td className="py-3 px-3 text-right text-slate-200">{formatINR(h.currentPrice)}</td>
                      <td className="py-3 px-3 text-right text-slate-400">{formatINR(h.investedValue)}</td>
                      <td className="py-3 px-3 text-right font-medium text-slate-200">{formatINR(h.currentValue)}</td>
                      <td className={`py-3 px-4 text-right font-bold ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isGain ? '+' : ''}{formatINR(h.pnl)} ({isGain ? '+' : ''}{h.pnlPercent}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
