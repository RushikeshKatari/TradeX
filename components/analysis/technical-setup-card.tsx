import React from 'react';
import { TechnicalAnalysisResult } from '@/lib/analysis/engine';
import { ShieldCheck, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface TechnicalSetupCardProps {
  analysis: TechnicalAnalysisResult | null;
  symbol: string;
}

export function TechnicalSetupCard({ analysis, symbol }: TechnicalSetupCardProps) {
  if (!analysis) return null;

  const isBullish = analysis.status === 'BULLISH';
  const isBearish = analysis.status === 'BEARISH';

  return (
    <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-xl">
      {/* Title & Status Header */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
        <div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Algorithmic Market Condition
          </span>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 mt-0.5">
            Technical Setup:
            <span
              className={`px-2.5 py-0.5 rounded text-sm font-extrabold ${
                isBullish
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : isBearish
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  : 'bg-slate-700/40 text-slate-300 border border-slate-600'
              }`}
            >
              {analysis.status}
            </span>
          </h3>
        </div>

        <div className="text-right">
          <span className="text-[11px] text-slate-400 block">Signal Agreement</span>
          <span
            className={`font-semibold text-xs px-2 py-0.5 rounded border inline-block mt-0.5 ${
              analysis.signalConfidence === 'Strong'
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {analysis.signalConfidence} Confidence
          </span>
        </div>
      </div>

      {/* Multi-Factor Score Meter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Trend Score</span>
          <span className={`text-lg font-bold font-mono ${analysis.breakdown.trendScore > 0 ? 'text-emerald-400' : analysis.breakdown.trendScore < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {analysis.breakdown.trendScore > 0 ? '+' : ''}{analysis.breakdown.trendScore}
          </span>
        </div>
        <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Momentum Score</span>
          <span className={`text-lg font-bold font-mono ${analysis.breakdown.momentumScore > 0 ? 'text-emerald-400' : analysis.breakdown.momentumScore < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {analysis.breakdown.momentumScore > 0 ? '+' : ''}{analysis.breakdown.momentumScore}
          </span>
        </div>
        <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Volume & VWAP</span>
          <span className={`text-lg font-bold font-mono ${analysis.breakdown.volumeScore > 0 ? 'text-emerald-400' : analysis.breakdown.volumeScore < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {analysis.breakdown.volumeScore > 0 ? '+' : ''}{analysis.breakdown.volumeScore}
          </span>
        </div>
        <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Total Composite</span>
          <span className={`text-lg font-bold font-mono ${analysis.totalScore > 0 ? 'text-emerald-400' : analysis.totalScore < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {analysis.totalScore > 0 ? '+' : ''}{analysis.totalScore}
          </span>
        </div>
      </div>

      {/* Transparent Reasons Breakdown */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Underlying Indicator Evidence:
        </h4>
        <div className="space-y-1.5">
          {analysis.reasons.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-slate-300 bg-slate-900/40 px-3 py-2 rounded border border-slate-800/80">
              <span className="text-indigo-400 font-bold">•</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transparent Key Metrics Table */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono mb-4 bg-slate-950 p-3 rounded-lg border border-slate-800">
        <div>
          <span className="text-slate-500 block text-[10px]">RSI (14)</span>
          <span className="text-slate-200">{analysis.metrics.rsi ?? 'N/A'}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">20 EMA</span>
          <span className="text-slate-200">₹{analysis.metrics.ema20 ?? 'N/A'}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">50 EMA</span>
          <span className="text-slate-200">₹{analysis.metrics.ema50 ?? 'N/A'}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">VWAP</span>
          <span className="text-slate-200">₹{analysis.metrics.vwap ?? 'N/A'}</span>
        </div>
      </div>

      {/* Legal & Educational Disclaimer */}
      <div className="flex items-start gap-2 text-[11px] text-amber-300/80 bg-amber-950/20 p-2.5 rounded-lg border border-amber-800/30">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <span>{analysis.disclaimer}</span>
      </div>
    </div>
  );
}
