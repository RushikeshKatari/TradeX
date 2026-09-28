'use client';

import React from 'react';
import { RegimeResult } from '@/types/regime';
import { Compass, TrendingUp, TrendingDown, Minus, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';

interface RegimeCardProps {
  regime: RegimeResult | null;
  symbol: string;
  loading?: boolean;
}

export function RegimeCard({ regime, symbol, loading }: RegimeCardProps) {
  if (loading || !regime) {
    return (
      <div className="bg-[#0e1320] border border-border rounded-xl p-5 animate-pulse space-y-4">
        <div className="h-6 bg-slate-800 rounded w-1/3"></div>
        <div className="h-20 bg-slate-800/60 rounded"></div>
        <div className="h-12 bg-slate-800/40 rounded"></div>
      </div>
    );
  }

  const isBull = regime.regime === 'BULLISH';
  const isBear = regime.regime === 'BEARISH';
  const isSideways = regime.regime === 'SIDEWAYS';

  const regimeColor = isBull
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : isBear
    ? 'text-rose-400 border-rose-500/30 bg-rose-500/10'
    : isSideways
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : 'text-slate-400 border-slate-700 bg-slate-800/40';

  const Icon = isBull ? TrendingUp : isBear ? TrendingDown : isSideways ? Minus : AlertTriangle;

  return (
    <div className="bg-[#0e1320] border border-border rounded-xl p-5 shadow-lg relative overflow-hidden">
      {/* Background glow */}
      <div
        className={`absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-20 pointer-events-none ${
          isBull ? 'bg-emerald-500' : isBear ? 'bg-rose-500' : 'bg-amber-500'
        }`}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-base flex items-center gap-2">
              Market Regime Radar
              <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                {symbol}
              </span>
            </h3>
            <p className="text-xs text-slate-400">Multi-factor algorithmic market state</p>
          </div>
        </div>

        <div className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 font-bold text-sm ${regimeColor}`}>
          <Icon className="w-4 h-4" />
          <span>{regime.regime}</span>
        </div>
      </div>

      {/* Gauge and key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-slate-900/80 border border-border/80 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">Signal Confidence</span>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-white font-mono">{regime.confidence}%</span>
            <span className="text-[10px] text-slate-400">weighted</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isBull ? 'bg-emerald-500' : isBear ? 'bg-rose-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(regime.confidence, 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-border/80 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">Trend Strength</span>
          <div className="flex items-center gap-1.5 mt-1">
            <Activity className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-white text-sm">{regime.trendStrength}</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-border/80 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">Volatility State</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${
                regime.volatility === 'HIGH'
                  ? 'bg-rose-500 animate-pulse'
                  : regime.volatility === 'LOW'
                  ? 'bg-blue-400'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-semibold text-white text-sm">{regime.volatility}</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-border/80 rounded-lg p-3">
          <span className="text-[11px] text-slate-400 block mb-1">PCR (Put/Call)</span>
          <span className="text-lg font-bold text-white font-mono">
            {typeof regime.pcr === 'number' ? regime.pcr.toFixed(2) : '—'}
          </span>
        </div>
      </div>

      {/* Factor Breakdown */}
      {regime.scores && Object.keys(regime.scores).length > 0 && (
        <div className="mb-4 bg-slate-950/60 border border-border/60 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
            <span>Factor Score Contributions</span>
            <span className="text-[10px] text-slate-500">Green = Bullish, Red = Bearish</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(regime.scores).map(([factor, score]) => (
              <div
                key={factor}
                className={`text-xs px-2.5 py-1 rounded border flex items-center gap-1.5 font-mono ${
                  score > 0
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : score < 0
                    ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <span>{factor}:</span>
                <span className="font-bold">{score > 0 ? `+${score}` : score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Supporting Arguments */}
      {regime.supportingFactors.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Key Supporting Rationale</span>
          </div>
          <div className="space-y-1">
            {regime.supportingFactors.slice(0, 3).map((f, i) => (
              <p key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                <span className="text-indigo-400 font-bold">•</span>
                <span>{f}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
