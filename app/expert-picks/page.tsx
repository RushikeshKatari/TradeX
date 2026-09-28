'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { ExpertPickGrid } from '@/components/expert-picks/ExpertPickGrid';
import { OpenPositions } from '@/components/expert-picks/OpenPositions';
import { ExpertPicksResponse, ExpertPickCandidate, ExpertPickPosition } from '@/types/expert-picks';
import { formatINR, cn } from '@/lib/utils';

export default function ExpertPicksPage() {
  const investmentLimitPerSide = 100000;
  const [userRole, setUserRole] = useState<'USER' | 'ADMIN' | null>(null);
  const [data, setData] = useState<ExpertPicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('NIFTY50');
  const [expiry, setExpiry] = useState('');
  
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(d => setUserRole(d.user?.role || 'USER'))
      .catch(console.error);
  }, []);

  const fetchData = useCallback(async (showLoading = true) => {
    const requestId = ++latestRequestRef.current;
    if (showLoading) setLoading(true);
    try {
      const query = new URLSearchParams({ symbol, expiry, _ts: String(Date.now()) });
      const res = await fetch(`/api/expert-picks?${query.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch data');
      const json = await res.json();
      // A slower polling response must not overwrite a newer post-entry state.
      if (requestId === latestRequestRef.current) setData(json);
    } catch (err: any) {
      console.error(err);
      setMessage({ text: err.message || 'Failed to load expert picks', type: 'error' });
    } finally {
      if (showLoading && requestId === latestRequestRef.current) setLoading(false);
    }
  }, [symbol, expiry]);

  useEffect(() => {
    fetchData();
    // Keep marks and auto-exit rules responsive while the page is open.
    const interval = setInterval(() => {
      fetchData(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleEnterTrade = async (pick: ExpertPickCandidate) => {
    const id = `${pick.underlying}_${pick.strike}_${pick.optionType}`;
    setEnteringId(id);
    setMessage(null);
    try {
      const res = await fetch('/api/expert-picks/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          underlying: pick.underlying,
          strike: pick.strike,
          optionType: pick.optionType,
          expiry: pick.expiry,
          side: pick.action,
          quantity: pick.recommendedLots * pick.lotSize,
          price: pick.ltp,
          ceInvestment: pick.ceInvestment,
          peInvestment: pick.peInvestment,
          ceStopLossPercent: pick.ceStopLossPercent,
          peStopLossPercent: pick.peStopLossPercent,
          targetValue: pick.targetValue,
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to enter trade');
      
      setMessage({ text: 'Trade entered successfully', type: 'success' });
      await fetchData(false);
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setEnteringId(null);
    }
  };

  const handleExitTrade = async (pos: ExpertPickPosition) => {
    setExitingId(pos.id);
    setMessage(null);
    try {
      const res = await fetch('/api/expert-picks/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: `${pos.underlying}_${pos.strike}_${pos.optionType}`,
          quantity: pos.quantity,
          price: pos.currentLtp,
          reason: 'MANUAL_EXIT'
        })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to exit trade');
      
      setMessage({ text: 'Trade exited successfully', type: 'success' });
      fetchData(false);
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setExitingId(null);
    }
  };

  const isDataStale = data ? (new Date().getTime() - new Date(data.lastUpdated).getTime() > 60000) : false;

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole || 'USER'} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full overflow-y-auto h-[calc(100vh-64px)]">
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white uppercase tracking-wider">Expert Picks</h1>
              <p className="text-sm text-slate-400 mt-1">Algorithmic trade recommendations based on market regime and momentum.</p>
            </div>
            
            <div className="flex items-center gap-4">
              {data && !loading && (
                <div className="text-right text-xs">
                  <div className="text-slate-400">Last updated</div>
                  <div className={isDataStale ? "text-rose-400" : "text-emerald-400"}>
                    {new Date(data.lastUpdated).toLocaleTimeString()}
                  </div>
                </div>
              )}
              <select 
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-slate-800 text-white text-sm rounded-lg px-4 py-2 border border-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="NIFTY50">NIFTY 50</option>
                <option value="BANKNIFTY">BANK NIFTY</option>
                <option value="SENSEX">SENSEX</option>
              </select>
            </div>
          </div>

          {message && (
            <div className={`p-4 rounded-xl text-sm font-medium border ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
              {message.text}
            </div>
          )}

          {loading && !data ? (
            <div className="animate-pulse space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="bg-slate-800 h-64 rounded-xl border border-slate-700"></div>
                ))}
              </div>
              <div className="bg-slate-800 h-48 rounded-xl border border-slate-700"></div>
            </div>
          ) : data ? (
            <>
              {/* Summary Bar */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-[#0f172a] border border-border rounded-xl p-4 shadow-lg">
                  <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Available Cash</div>
                  <div className="text-xl font-mono text-white mt-1">{formatINR(data.summary.availableCash)}</div>
                </div>
                <div className="bg-[#0f172a] border border-border rounded-xl p-4 shadow-lg">
                  <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Investment</div>
                  <div className="text-xl font-mono text-slate-300 mt-1">{formatINR(data.summary.totalInvestment)}</div>
                </div>
                <div className="bg-[#0f172a] border border-border rounded-xl p-4 shadow-lg">
                  <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Current P&L</div>
                  <div className={`text-xl font-mono mt-1 ${data.summary.currentPnl > 0 ? 'text-emerald-400' : data.summary.currentPnl < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                    {data.summary.currentPnl > 0 ? '+' : ''}{formatINR(data.summary.currentPnl)}
                  </div>
                </div>
                <div className="bg-[#0f172a] border border-border rounded-xl p-4 shadow-lg">
                  <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Realized P&L</div>
                  <div className={`text-xl font-mono mt-1 ${data.summary.realizedPnl > 0 ? 'text-emerald-400' : data.summary.realizedPnl < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                    {data.summary.realizedPnl > 0 ? '+' : ''}{formatINR(data.summary.realizedPnl)}
                  </div>
                </div>
                <div className="bg-[#0f172a] border border-border rounded-xl p-4 shadow-lg">
                  <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Open Positions</div>
                  <div className="text-xl font-mono text-white mt-1">{data.summary.openPositions}</div>
                </div>
              </div>

              {/* Expert Picks */}
              <section className="bg-[#0f172a] border border-border rounded-xl p-5">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">CE / PE Position Sizing by Strike</h2>
                <p className="text-xs text-slate-500 mb-4">Investment limit: ₹1,00,000 per CE side and ₹1,00,000 per PE side.</p>
                <div className="space-y-3">
                  {Array.from(new Set(data.picks.map((pick) => pick.strike))).map((strike) => {
                    const ce = data.picks.find((pick) => pick.strike === strike && pick.optionType === 'CE');
                    const pe = data.picks.find((pick) => pick.strike === strike && pick.optionType === 'PE');
                    return <div key={strike} className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-border bg-slate-900/50 p-3">
                      <div className="flex items-center"><span className="text-slate-500 text-xs uppercase">Strike</span><span className="ml-3 font-mono font-bold text-white">{strike}</span></div>
                      {[{ label: 'CE', pick: ce, color: 'text-cyan-400' }, { label: 'PE', pick: pe, color: 'text-purple-400' }].map((side) => {
                        const cost = side.pick ? side.pick.ltp * side.pick.lotSize : 0;
                        const lots = cost ? Math.floor(Math.min(investmentLimitPerSide, data.summary.availableCash) / cost) : 0;
                        return <div key={side.label} className="rounded border border-border p-3"><div className={`font-bold ${side.color}`}>{side.label}</div>{side.pick ? <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono text-slate-300"><span>LTP<br /><b className="text-white">{formatINR(side.pick.ltp)}</b></span><span>Lot Size<br /><b className="text-white">{side.pick.lotSize}</b></span><span>Lots<br /><b className="text-white">{lots}</b></span><span>Investment<br /><b className="text-white">{formatINR(lots * cost)}</b></span></div> : <span className="text-xs text-slate-500">Not in Top 5</span>}</div>;
                      })}
                    </div>;
                  })}
                </div>
              </section>

              <section className="bg-[#0f172a] border border-border rounded-xl p-5">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Lot Calculation — All Recommended Calls &amp; Puts</h2>
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">Rank</th><th className="px-3 py-3">Strike</th><th className="px-3 py-3">Type</th><th className="px-3 py-3 text-right">LTP</th><th className="px-3 py-3 text-right">Lot Size</th><th className="px-3 py-3 text-right">Affordable Lots</th><th className="px-3 py-3 text-right">Investment</th></tr></thead><tbody className="divide-y divide-border/60">{data.picks.map((pick) => { const cost = pick.ltp * pick.lotSize; const lots = cost ? Math.floor(Math.min(investmentLimitPerSide, data.summary.availableCash) / cost) : 0; return <tr key={`sizing-${pick.rank}-${pick.strike}-${pick.optionType}`} className="text-slate-300"><td className="px-3 py-3 font-mono">#{pick.rank}</td><td className="px-3 py-3 font-mono text-white">{pick.strike}</td><td className={cn('px-3 py-3 font-bold', pick.optionType === 'CE' ? 'text-cyan-400' : 'text-purple-400')}>{pick.optionType}</td><td className="px-3 py-3 text-right font-mono">{formatINR(pick.ltp)}</td><td className="px-3 py-3 text-right font-mono">{pick.lotSize}</td><td className="px-3 py-3 text-right font-mono text-white">{lots}</td><td className="px-3 py-3 text-right font-mono text-white">{formatINR(lots * cost)}</td></tr>; })}</tbody></table></div>
              </section>

              <section>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 border-b border-border pb-2">Top Trade Ideas</h2>
                <ExpertPickGrid 
                  picks={data.picks} 
                  onEnter={handleEnterTrade} 
                  enteringPickId={enteringId}
                  availableCash={data.summary.availableCash}
                />
              </section>

              <section>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 border-b border-border pb-2">Live P&amp;L</h2>
                <OpenPositions positions={data.positions.filter((p) => p.status === 'OPEN')} onExit={handleExitTrade} exitingPosId={exitingId} />
              </section>

              <section className="bg-[#0f172a] border border-border rounded-xl p-5">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Exit Conditions</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="border border-border rounded-lg p-3"><b className="text-amber-400">50% LOSS STOP</b><p className="text-slate-400 mt-1">Exit when side value falls to 50% of investment, during 09:15–15:30 IST</p><span className="text-slate-300">NOT TRIGGERED</span></div>
                  <div className="border border-border rounded-lg p-3"><b className="text-cyan-400">COMBINED PROFIT TARGET</b><p className="text-slate-400 mt-1">Profit exceeds combined CE + PE investment</p><span className="text-slate-300">NOT TRIGGERED</span></div>
                  <div className="border border-border rounded-lg p-3"><b className="text-indigo-400">TIME EXIT</b><p className="text-slate-400 mt-1">Sell all open option positions at 3:45 PM IST</p><span className="text-slate-300">ACTIVE / NOT TRIGGERED</span></div>
                </div>
              </section>

              {/* Open Positions */}
              <section>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 border-b border-border pb-2 mt-8">Open Expert Positions</h2>
                <OpenPositions 
                  positions={data.positions.filter((p) => p.status === 'OPEN')} 
                  onExit={handleExitTrade} 
                  exitingPosId={exitingId}
                />
              </section>

              <section>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 border-b border-border pb-2 mt-8">Closed Positions</h2>
                <OpenPositions
                  positions={data.positions.filter((p) => p.status === 'CLOSED')}
                  onExit={handleExitTrade}
                  exitingPosId={exitingId}
                />
              </section>
            </>
          ) : null}

        </main>
      </div>
    </div>
  );
}
