import React from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { getMarketDataProvider } from '@/lib/market-data';
import { getPortfolioSummary } from '@/lib/trading/execution';
import { formatINR } from '@/lib/utils';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownRight, TrendingUp, Layers, Briefcase, Bookmark, ShieldCheck, Activity } from 'lucide-react';

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const provider = getMarketDataProvider();
  const marketStatus = await provider.getMarketStatus();

  // Load key index quotes safely
  const [niftyQuote, sensexQuote, bankQuote] = await Promise.all([
    provider.getQuote('NIFTY50').catch(() => null),
    provider.getQuote('SENSEX').catch(() => null),
    provider.getQuote('BANKNIFTY').catch(() => null),
  ]);

  // Load portfolio summary
  const portfolio = await getPortfolioSummary(user.userId).catch(() => null);

  const popularStocks = [
    { symbol: 'RELIANCE', name: 'Reliance Industries', price: 2945.80, change: '+0.85%' },
    { symbol: 'TCS', name: 'Tata Consultancy Services', price: 4190.20, change: '+1.12%' },
    { symbol: 'INFY', name: 'Infosys Ltd.', price: 1885.60, change: '-0.45%' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd.', price: 1665.40, change: '+0.60%' },
    { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd.', price: 1240.15, change: '+1.35%' },
    { symbol: 'SBIN', name: 'State Bank of India', price: 795.30, change: '-0.20%' },
  ];

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={user.role} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          {/* Welcome Banner */}
          <div className="bg-[#0f172a] border border-border rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider block">
                Educational Paper Trading Environment
              </span>
              <h1 className="text-2xl font-bold text-white mt-1">
                Welcome back, {user.displayName}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Market status: <strong className={marketStatus.isOpen ? 'text-emerald-400' : 'text-slate-300'}>{marketStatus.message}</strong> ({marketStatus.timezone})
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/stocks/RELIANCE"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
              >
                <TrendingUp className="w-4 h-4" />
                <span>Trade Equities</span>
              </Link>
              <Link
                href="/options/NIFTY50"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-all flex items-center gap-1.5"
              >
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Option Chain</span>
              </Link>
            </div>
          </div>

          {/* Primary Indices Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[niftyQuote, sensexQuote, bankQuote].filter(Boolean).map((q) => {
              if (!q) return null;
              const isBull = q.change >= 0;
              return (
                <Link
                  key={q.symbol}
                  href={`/stocks/${q.symbol}`}
                  className="bg-[#0f172a] border border-border hover:border-slate-700 rounded-xl p-5 shadow-lg transition-all group"
                >
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-bold group-hover:text-indigo-400 transition-colors">
                      {q.name}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      {q.exchange}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    ₹{q.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-mono font-semibold mt-1 ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isBull ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    {isBull ? '+' : ''}{q.change.toFixed(2)} ({isBull ? '+' : ''}{q.changePercent.toFixed(2)}%)
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Portfolio & Virtual Capital Card */}
          {portfolio && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 block uppercase">Virtual Capital</span>
                <span className="text-2xl font-bold text-emerald-400 font-mono mt-1 block">
                  {formatINR(portfolio.summary.cashBalance)}
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Reserved: {formatINR(portfolio.summary.reservedBalance)}
                </span>
              </div>
              <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 block uppercase">Invested Value</span>
                <span className="text-2xl font-bold text-white font-mono mt-1 block">
                  {formatINR(portfolio.summary.investedValue)}
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Current: {formatINR(portfolio.summary.currentValue)}
                </span>
              </div>
              <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 block uppercase">Unrealized P&L</span>
                <span className={`text-2xl font-bold font-mono mt-1 block ${portfolio.summary.totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {portfolio.summary.totalUnrealizedPnL >= 0 ? '+' : ''}{formatINR(portfolio.summary.totalUnrealizedPnL)}
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">Mark-to-Market</span>
              </div>
              <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 block uppercase">Realized P&L</span>
                <span className={`text-2xl font-bold font-mono mt-1 block ${portfolio.summary.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {portfolio.summary.totalRealizedPnL >= 0 ? '+' : ''}{formatINR(portfolio.summary.totalRealizedPnL)}
                </span>
                <span className="text-[11px] text-slate-500 mt-1 block">Accumulated profits</span>
              </div>
            </div>
          )}

          {/* Quick Indian Equities Grid */}
          <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                <span>Featured Indian Equities</span>
              </h3>
              <Link href="/watchlist" className="text-xs text-indigo-400 hover:text-indigo-300">
                View Full Watchlist →
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {popularStocks.map((stock) => (
                <Link
                  key={stock.symbol}
                  href={`/stocks/${stock.symbol}`}
                  className="bg-slate-900 border border-slate-800 hover:border-indigo-500/50 p-3 rounded-lg text-center transition-all group"
                >
                  <span className="font-bold text-slate-200 group-hover:text-indigo-400 text-sm block">
                    {stock.symbol}
                  </span>
                  <span className="text-[10px] text-slate-400 block truncate">{stock.name}</span>
                  <span className="text-xs font-mono font-semibold text-slate-100 mt-1 block">
                    ₹{stock.price.toFixed(2)}
                  </span>
                  <span className={`text-[10px] font-mono ${stock.change.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stock.change}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
