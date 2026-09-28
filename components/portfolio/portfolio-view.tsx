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

      {/* Active Positions Table */}
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                  <th className="py-2.5 px-4 text-left">Symbol</th>
                  <th className="py-2.5 px-3 text-right">Quantity</th>
                  <th className="py-2.5 px-3 text-right">Lots</th>
                  <th className="py-2.5 px-3 text-right">Lot Size</th>
                  <th className="py-2.5 px-3 text-right">Avg Entry</th>
                  <th className="py-2.5 px-3 text-right">LTP</th>
                  <th className="py-2.5 px-3 text-right">Invested</th>
                  <th className="py-2.5 px-3 text-right">Current Value</th>
                  <th className="py-2.5 px-3 text-right">P&L (Unrealized)</th>
                  <th className="py-2.5 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
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
                    <tr key={pos.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 text-left font-bold text-slate-200">
                        <Link href={`/stocks/${pos.symbol}`} className="hover:text-indigo-400">
                          {pos.symbol}
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-right text-slate-300">{pos.quantity}</td>
                      <td className="py-3 px-3 text-right text-slate-300">{pos.lots || '—'}</td>
                      <td className="py-3 px-3 text-right text-slate-300">{pos.lotSize || '—'}</td>
                      <td className="py-3 px-3 text-right text-slate-400">{formatINR(pos.averageEntryPrice)}</td>
                      <td className="py-3 px-3 text-right text-slate-200">{formatINR(pos.currentPrice)}</td>
                      <td className="py-3 px-3 text-right text-slate-400">{formatINR(pos.investedValue)}</td>
                      <td className="py-3 px-3 text-right font-medium text-slate-200">{formatINR(displayedCurrentValue)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPos ? '+' : ''}{formatINR(pos.unrealizedPnL)} ({isPos ? '+' : ''}{pos.unrealizedPnLPercent}%)
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isOption ? (
                          <button onClick={handleManualExit} disabled={exitingId === pos.id} className="px-2.5 py-1 text-[11px] font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white rounded border border-rose-500/30 transition-all">
                            {exitingId === pos.id ? 'Exiting...' : 'Manual Exit'}
                          </button>
                        ) : (
                          <Link href={`/stocks/${pos.symbol}`} className="px-2.5 py-1 text-[11px] font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white rounded border border-rose-500/30 transition-all">Trade / Square off</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
