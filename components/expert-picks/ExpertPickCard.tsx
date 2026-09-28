'use client';

import React, { useMemo, useState } from 'react';
import { ExpertPickCandidate } from '@/types/expert-picks';
import { formatINR, formatNumber, cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

const EXPERT_PICKS_EXIT_TIME = '15:15';
function isAfterExpertPicksExitTime(): boolean {
  const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [hours, minutes] = now.split(':').map(Number);
  const [exitHours, exitMinutes] = EXPERT_PICKS_EXIT_TIME.split(':').map(Number);
  return hours * 60 + minutes >= exitHours * 60 + exitMinutes;
}

interface Props {
  pick: ExpertPickCandidate;
  onEnter: (pick: ExpertPickCandidate) => void;
  isEntering: boolean;
  availableCash: number;
  onSelect?: (pick: ExpertPickCandidate) => void;
}

export function ExpertPickCard({ pick, onEnter, isEntering, availableCash, onSelect }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [allocatedCapital, setAllocatedCapital] = useState(pick.requiredInvestment);

  const isNoTrade = pick.action === 'NO_TRADE';
  const calculation = useMemo(() => {
    const investmentPerLot = pick.ltp > 0 && pick.lotSize > 0 ? pick.ltp * pick.lotSize : 0;
    const allocation = Math.min(Math.max(0, allocatedCapital), Math.max(0, availableCash));
    const lots = investmentPerLot > 0 ? Math.floor(allocation / investmentPerLot) : 0;
    return {
      lots,
      quantity: lots * pick.lotSize,
      investment: Number((lots * investmentPerLot).toFixed(2)),
    };
  }, [allocatedCapital, availableCash, pick.lotSize, pick.ltp]);

  const insufficientCash = calculation.lots === 0;
  const afterExitTime = isAfterExpertPicksExitTime();
  const disabled = isNoTrade || insufficientCash || isEntering || afterExitTime;

  const handleEnterClick = () => {
    if (!disabled) {
      onSelect?.(pick);
      setAllocatedCapital(Math.min(pick.requiredInvestment, availableCash));
      setShowConfirm(true);
    }
  };

  const confirmEnter = () => {
    setShowConfirm(false);
    onEnter({
      ...pick,
      recommendedLots: calculation.lots,
      requiredInvestment: calculation.investment,
    });
  };

  return (
    <>
      <div className="bg-[#0f172a] border border-border rounded-xl shadow-lg p-4 flex flex-col relative overflow-hidden h-full">
        <div className="absolute top-0 right-0 bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-bl-lg text-xs font-bold border-b border-l border-cyan-500/30 flex items-center gap-1">
          <Zap className="w-3 h-3" />
          #{pick.rank}
        </div>
        
        <div className="mt-2 mb-4">
          <h3 className="text-lg font-bold text-white uppercase tracking-wider">
            {pick.underlying} {pick.strike} {pick.optionType}
          </h3>
          <p className="text-xs text-slate-400 mt-1">Expiry: {pick.expiry}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4 bg-slate-900/50 p-3 rounded-lg flex-grow">
          <div>
            <div className="text-slate-400 text-xs">LTP</div>
            <div className="font-mono font-medium text-slate-200">{formatINR(pick.ltp)}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">Volume</div>
            <div className="font-mono font-medium text-slate-200">{formatNumber(pick.volume)}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">OI</div>
            <div className="font-mono font-medium text-slate-200">{formatNumber(pick.oi)}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">Chg OI</div>
            <div className={cn(
              "font-mono font-medium",
              pick.changeOi > 0 ? "text-emerald-400" : pick.changeOi < 0 ? "text-rose-400" : "text-slate-200"
            )}>
              {pick.changeOi > 0 ? '+' : ''}{formatNumber(pick.changeOi)}
            </div>
          </div>
        </div>

        <div className="mb-4 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Action:</span>
            <span className={cn(
              "font-bold px-2 py-0.5 rounded",
              pick.action === 'BUY' ? "bg-emerald-500/20 text-emerald-400" :
              pick.action === 'SELL' ? "bg-rose-500/20 text-rose-400" :
              "bg-slate-700 text-slate-300"
            )}>{pick.action}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Rec. Lots:</span>
            <span className="font-mono text-slate-300">{pick.recommendedLots} ({pick.lotSize} qty/lot)</span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-300">Investment:</span>
            <span className="font-mono text-white">{formatINR(pick.requiredInvestment)}</span>
          </div>
        </div>
        
        {pick.signalReasons.length > 0 && (
          <div className="text-xs text-slate-400 mb-4 line-clamp-2" title={pick.signalReasons.join(' ')}>
            {pick.signalReasons[0]}
          </div>
        )}

        <button
          onClick={handleEnterClick}
          disabled={disabled}
          className={cn(
            "w-full py-2 rounded-lg font-bold text-sm transition-colors uppercase tracking-wider mt-auto",
            disabled 
              ? "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50" 
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_20px_rgba(79,70,229,0.5)]"
          )}
        >
          {isEntering ? 'Entering...' : afterExitTime ? 'Market Closed' : insufficientCash ? 'Insufficient Cash' : 'Enter Trade'}
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-border rounded-xl shadow-2xl p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">Enter Paper Trade</h2>
            
            <div className="space-y-3 mb-6">
              <p className="text-slate-300">Review the selected option contract before opening a paper position.</p>
              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                <div className="font-bold text-white text-lg">{pick.underlying} {pick.strike} {pick.optionType}</div>
                <div className="text-xs text-slate-400 mt-1">Expiry: {pick.expiry}</div>
                <label className="block mt-3 text-xs text-slate-400">
                  Investment allocation for this {pick.optionType} side
                  <input
                    type="number"
                    min="0"
                    max={availableCash}
                    value={allocatedCapital}
                    onChange={(event) => setAllocatedCapital(Math.min(Math.max(0, Number(event.target.value) || 0), availableCash))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-indigo-500"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                  <div className="text-slate-400">Current LTP: <span className="text-white font-mono">{formatINR(pick.ltp)}</span></div>
                  <div className="text-slate-400">Lot size: <span className="text-white font-mono">{pick.lotSize}</span></div>
                  <div className="text-slate-400">Available cash: <span className="text-white font-mono">{formatINR(availableCash)}</span></div>
                  <div className="text-slate-400">Lots: <span className="text-white font-mono">{calculation.lots}</span></div>
                  <div className="text-slate-400">Qty: <span className="text-white font-mono">{calculation.quantity}</span></div>
                  <div className="text-slate-400">LTP: <span className="text-white font-mono">{formatINR(pick.ltp)}</span></div>
                  <div className="text-slate-400">Investment: <span className="text-white font-mono">{formatINR(calculation.investment)}</span></div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmEnter}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors shadow-lg"
              >
                ENTER PAPER TRADE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
