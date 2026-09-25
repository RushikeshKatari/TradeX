import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

export function DisclaimerBanner() {
  return (
    <div className="bg-amber-950/40 border-b border-amber-600/30 px-4 py-2 text-xs text-amber-200 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          <strong className="font-semibold text-amber-300">PAPER TRADING & SIMULATION PLATFORM:</strong> All orders, balances, and fills use simulated virtual capital. No real-money trades are executed. Market analysis is informational and does not guarantee future results.
        </span>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 text-amber-300/80 font-mono text-[11px] shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span>SAFE VIRTUAL ENVIRONMENT</span>
      </div>
    </div>
  );
}
