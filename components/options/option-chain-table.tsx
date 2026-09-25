'use client';

import React from 'react';
import { OptionChainData } from '@/types/options';
import { OptionAnalysisSummary } from '@/lib/options/analyzer';
import { formatNumber, formatINR } from '@/lib/utils';
import { Info, Flame } from 'lucide-react';

interface OptionChainTableProps {
  data: {
    chain: OptionChainData;
    analysis: OptionAnalysisSummary;
  } | null;
  onExpiryChange: (expiry: string) => void;
  isLoading?: boolean;
}

export function OptionChainTable({ data, onExpiryChange, isLoading }: OptionChainTableProps) {
  if (!data) return null;

  const { chain, analysis } = data;
  const spot = chain.underlyingPrice;

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Index Derivative Matrix
          </span>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {chain.underlyingSymbol}
            <span className="text-emerald-400 font-mono text-base font-normal">
              ₹{spot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </h2>
          <span className="text-[11px] text-slate-500 font-mono">
            Provider: {chain.dataSource} • {chain.isDelayed ? 'Delayed Feed' : 'Real-Time'}
          </span>
        </div>

        {/* Expiry Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 font-medium">Expiry Date:</label>
          <select
            value={chain.selectedExpiry}
            onChange={(e) => onExpiryChange(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            {chain.expiryDates.map((exp) => (
              <option key={exp} value={exp}>
                {exp}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Volume Leader Callouts (Rule: NEVER labeled 'best strike') */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase mb-1">
            <Flame className="w-4 h-4" />
            <span>Highest Observed CE Volume Strike</span>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {analysis.volumeLeaderCE ? `₹${analysis.volumeLeaderCE.strike.toLocaleString('en-IN')}` : 'N/A'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {analysis.volumeLeaderCE ? `${formatNumber(analysis.volumeLeaderCE.volume)} contracts observed.` : 'Data unavailable'} Volume leader only, not a trade recommendation.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase mb-1">
            <Flame className="w-4 h-4" />
            <span>Highest Observed PE Volume Strike</span>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {analysis.volumeLeaderPE ? `₹${analysis.volumeLeaderPE.strike.toLocaleString('en-IN')}` : 'N/A'}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {analysis.volumeLeaderPE ? `${formatNumber(analysis.volumeLeaderPE.volume)} contracts observed.` : 'Data unavailable'} Volume leader only, not a trade recommendation.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-border rounded-xl p-4 shadow-lg">
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1">
            Put / Call Relationship (PCR)
          </div>
          <div className="flex items-baseline gap-3">
            <div>
              <span className="text-[10px] text-slate-500 block">OI PCR</span>
              <span className="text-xl font-bold text-indigo-400 font-mono">{analysis.oiPcr}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">Vol PCR</span>
              <span className="text-xl font-bold text-slate-300 font-mono">{analysis.volumePcr}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Market setup: <strong className="text-slate-200">{analysis.sentiment}</strong>. PCR reflects open interest ratio.
          </p>
        </div>
      </div>

      {/* Main Side-by-Side Options Matrix Table */}
      <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-border text-[11px] text-slate-400 uppercase">
                <th colSpan={5} className="py-2.5 px-4 text-center text-emerald-400 bg-emerald-950/20 border-r border-border">
                  CALLS (CE)
                </th>
                <th className="py-2.5 px-4 text-center bg-slate-900 text-slate-200">
                  STRIKE
                </th>
                <th colSpan={5} className="py-2.5 px-4 text-center text-rose-400 bg-rose-950/20 border-l border-border">
                  PUTS (PE)
                </th>
              </tr>
              <tr className="bg-slate-900/80 border-b border-border text-[10px] text-slate-400">
                <th className="py-2 px-3 text-right">OI</th>
                <th className="py-2 px-3 text-right">Chg OI</th>
                <th className="py-2 px-3 text-right">Volume</th>
                <th className="py-2 px-3 text-right">IV</th>
                <th className="py-2 px-3 text-right border-r border-border">LTP</th>
                <th className="py-2 px-4 text-center bg-slate-950 text-indigo-300">PRICE</th>
                <th className="py-2 px-3 text-left border-l border-border">LTP</th>
                <th className="py-2 px-3 text-left">IV</th>
                <th className="py-2 px-3 text-left">Volume</th>
                <th className="py-2 px-3 text-left">Chg OI</th>
                <th className="py-2 px-3 text-left">OI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {chain.strikes.map((row) => {
                const isAtm = Math.abs(row.strikePrice - spot) <= 30;
                const isCeVolLeader = analysis.volumeLeaderCE?.strike === row.strikePrice;
                const isPeVolLeader = analysis.volumeLeaderPE?.strike === row.strikePrice;

                return (
                  <tr
                    key={row.strikePrice}
                    className={`hover:bg-slate-800/50 transition-colors ${
                      isAtm ? 'bg-indigo-950/30' : ''
                    }`}
                  >
                    {/* CE Columns */}
                    <td className="py-2 px-3 text-right text-slate-400">
                      {row.ce ? formatNumber(row.ce.oi) : 'N/A'}
                    </td>
                    <td className={`py-2 px-3 text-right ${(row.ce?.changeOi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.ce ? formatNumber(row.ce.changeOi) : 'N/A'}
                    </td>
                    <td className={`py-2 px-3 text-right font-medium ${isCeVolLeader ? 'text-amber-300 font-bold bg-amber-950/20' : 'text-slate-300'}`}>
                      {row.ce ? formatNumber(row.ce.volume) : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">
                      {row.ce?.iv ? `${row.ce.iv}%` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-400 border-r border-border">
                      {row.ce ? `₹${row.ce.ltp.toFixed(2)}` : 'N/A'}
                    </td>

                    {/* Center Strike Column */}
                    <td className={`py-2 px-4 text-center font-bold font-mono ${isAtm ? 'bg-indigo-600 text-white shadow' : 'bg-slate-950 text-slate-200'}`}>
                      {row.strikePrice.toLocaleString('en-IN')}
                    </td>

                    {/* PE Columns */}
                    <td className="py-2 px-3 text-left font-bold text-rose-400 border-l border-border">
                      {row.pe ? `₹${row.pe.ltp.toFixed(2)}` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-left text-slate-400">
                      {row.pe?.iv ? `${row.pe.iv}%` : 'N/A'}
                    </td>
                    <td className={`py-2 px-3 text-left font-medium ${isPeVolLeader ? 'text-amber-300 font-bold bg-amber-950/20' : 'text-slate-300'}`}>
                      {row.pe ? formatNumber(row.pe.volume) : 'N/A'}
                    </td>
                    <td className={`py-2 px-3 text-left ${(row.pe?.changeOi ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.pe ? formatNumber(row.pe.changeOi) : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-left text-slate-400">
                      {row.pe ? formatNumber(row.pe.oi) : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Disclaimer footer */}
        <div className="p-3 bg-slate-950 border-t border-border flex items-center gap-2 text-[11px] text-amber-300/80">
          <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{analysis.disclaimer}</span>
        </div>
      </div>
    </div>
  );
}
