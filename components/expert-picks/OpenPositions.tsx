'use client';

import React, { useState } from 'react';
import { ExpertPickPosition } from '@/types/expert-picks';
import { formatINR, cn } from '@/lib/utils';

interface Props {
  positions: ExpertPickPosition[];
  onExit: (position: ExpertPickPosition) => void;
  exitingPosId: string | null;
}

export function OpenPositions({ positions, onExit, exitingPosId }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!positions || positions.length === 0) {
    return (
      <div className="bg-[#0f172a] border border-border rounded-xl p-8 text-center text-slate-400">
        No open expert pick positions.
      </div>
    );
  }

  const handleExitClick = (id: string) => {
    setConfirmId(id);
  };

  const confirmExit = (pos: ExpertPickPosition) => {
    setConfirmId(null);
    onExit(pos);
  };

  return (
    <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-lg">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 border-b border-border">
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Instrument</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Strike</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Lots</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Entry</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">LTP</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Investment</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">P&L</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">Status</th>
              <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {positions.map((pos) => {
              const isProfit = pos.pnl > 0;
              const isLoss = pos.pnl < 0;
              const isExiting = exitingPosId === pos.id;
              
              return (
                <tr key={pos.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-4">
                    <span className="font-bold text-slate-200">{pos.underlying}</span>
                  </td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-bold",
                      pos.optionType === 'CE' ? "bg-cyan-500/20 text-cyan-400" : "bg-purple-500/20 text-purple-400"
                    )}>
                      {pos.optionType}
                    </span>
                  </td>
                  <td className="p-4 text-right font-mono text-slate-300">{pos.strike}</td>
                  <td className="p-4 text-right">
                    <div className="font-mono text-slate-200">{pos.lots}</div>
                    <div className="text-xs text-slate-500">Qty {pos.quantity}</div>
                  </td>
                  <td className="p-4 text-right font-mono text-slate-300">{formatINR(pos.entryPrice)}</td>
                  <td className="p-4 text-right font-mono text-slate-200">{formatINR(pos.currentLtp)}</td>
                  <td className="p-4 text-right font-mono text-slate-300">{formatINR(pos.investment)}</td>
                  <td className="p-4 text-right">
                    <div className={cn(
                      "font-mono font-bold",
                      isProfit ? "text-emerald-400" : isLoss ? "text-rose-400" : "text-slate-400"
                    )}>
                      {pos.pnl > 0 ? '+' : ''}{formatINR(pos.pnl)}
                    </div>
                    <div className={cn(
                      "text-xs font-mono",
                      isProfit ? "text-emerald-500/70" : isLoss ? "text-rose-500/70" : "text-slate-500"
                    )}>
                      {pos.pnlPercent > 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded-full border border-emerald-500/20">
                      {pos.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {pos.status === 'CLOSED' ? (
                      <span className="text-xs text-slate-500">{pos.exitReason || 'Closed'}</span>
                    ) : confirmId === pos.id ? (
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => setConfirmId(null)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => confirmExit(pos)}
                          disabled={isExiting}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded shadow-lg transition-colors"
                        >
                          Confirm Exit
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleExitClick(pos.id)}
                        disabled={isExiting}
                        className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded transition-colors"
                      >
                        {isExiting ? 'Exiting...' : 'Exit'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
