'use client';

import React from 'react';
import Link from 'next/link';
import { OptionsSignal } from '@/types/options-signal';
import { Target, Zap, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatINR } from '@/lib/utils';

interface OptionsSignalCardProps {
  signal: OptionsSignal | null;
  symbol: string;
  loading?: boolean;
}

export function OptionsSignalCard({ signal, symbol, loading }: OptionsSignalCardProps) {
  if (loading || !signal) {
    return (
      <div className="bg-[#0e1320] border border-border rounded-xl p-5 animate-pulse space-y-4">
        <div className="h-6 bg-slate-800 rounded w-1/3"></div>
        <div className="h-20 bg-slate-800/60 rounded"></div>
      </div>
    );
  }

  const isCall = signal.signal === 'LONG_CALL';
  const isPut = signal.signal === 'LONG_PUT';
  const isVol = signal.signal === 'VOLATILITY_STRATEGY';
  const isNoTrade = signal.signal === 'NO_TRADE';

  const badgeColor = isCall
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : isPut
    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    : isVol
    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
    : 'bg-slate-800 text-slate-400 border-slate-700';

  return (
    <div className="bg-[#0e1320] border border-border rounded-xl p-5 shadow-lg relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-base">Options Strategy Signal</h3>
            <p className="text-xs text-slate-400">Greeks &amp; regime-aligned trade setup</p>
          </div>
        </div>

        <div className={`px-3 py-1.5 rounded-lg border font-bold text-sm flex items-center gap-1.5 ${badgeColor}`}>
          <span>{signal.signal.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Recommended Setup Box */}
      {!isNoTrade ? (
        <div className="bg-slate-900/90 border border-border/80 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <span className="text-[11px] text-slate-400 block mb-1">Recommended Strike</span>
              <div className="flex items-baseline gap-1">
                <span className="text-base font-bold text-white font-mono">{signal.strike || 'ATM'}</span>
                <span className={`text-xs font-bold font-mono ${isCall ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {signal.optionType}
                </span>
              </div>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-1">Estimated Premium</span>
              <span className="text-base font-bold text-white font-mono">
                {signal.premium ? formatINR(signal.premium) : '—'}
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-1">Expected Move</span>
              <span className="text-base font-bold text-cyan-300 font-mono">
                {signal.expectedMove ? `±₹${signal.expectedMove}` : '—'}
                <span className="text-xs text-slate-400 ml-1">({signal.expectedMovePct}%)</span>
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-1">Risk / Reward</span>
              <span className="text-base font-bold text-emerald-400 font-mono">
                {signal.riskReward ? `${signal.riskReward}:1` : '—'}
              </span>
            </div>
          </div>

          {(signal.breakevenUp || signal.breakevenDown) && (
            <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-xs text-slate-300 font-mono">
              <span>
                Breakeven Target: <strong className="text-white">{signal.breakevenUp ? `₹${signal.breakevenUp}` : `₹${signal.breakevenDown}`}</strong>
              </span>
              <span>
                ATM Straddle Cost: <strong className="text-white">₹{signal.straddleCost || '—'}</strong>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-border/60 rounded-lg p-3.5 mb-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="text-xs text-slate-300">
            <span className="font-semibold text-white block">No directional asymmetry detected.</span>
            Option premiums or market conditions do not currently provide a favorable risk/reward for naked buying.
          </div>
        </div>
      )}

      {/* Rationale items */}
      {signal.reasons.length > 0 && (
        <div className="space-y-1 mb-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Engine Analysis Rationale
          </div>
          {signal.reasons.map((r, i) => (
            <p key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <span>{r}</span>
            </p>
          ))}
        </div>
      )}

      {/* Navigation action */}
      <div className="flex justify-end">
        <Link
          href={`/options/${symbol}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <span>Open Full Option Chain Matrix</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
