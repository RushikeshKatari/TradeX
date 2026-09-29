'use client';

import React, { useMemo, useState } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { BacktestResult } from '@/types/backtest';
import { formatINR } from '@/lib/utils';
import { AlertCircle, BarChart3, Download, FileSpreadsheet, Play, Upload } from 'lucide-react';

const INDEXES = [
  { value: 'NIFTY50', label: 'NIFTY' },
  { value: 'BANKNIFTY', label: 'Bank Nifty' },
  { value: 'SENSEX', label: 'Sensex' },
];

function LineChart({ title, points, color = '#34d399' }: { title: string; points: { label: string; value: number }[]; color?: string }) {
  const width = 720;
  const height = 190;
  const left = 54;
  const right = 14;
  const top = 16;
  const bottom = 32;
  const values = points.map((point) => point.value);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const spread = maxValue - minValue || 1;
  const x = (index: number) => left + (points.length < 2 ? 0 : index * (width - left - right) / (points.length - 1));
  const y = (value: number) => top + (maxValue - value) * (height - top - bottom) / spread;
  const zeroY = y(0);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
  const labelIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <section className="rounded-xl border border-border bg-[#0e1320] p-4">
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      {points.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label={title}>
          <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#475569" />
          <line x1={left} y1={zeroY} x2={width - right} y2={zeroY} stroke="#64748b" strokeDasharray="4 4" />
          <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="#475569" />
          <text x={left - 7} y={top + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{formatINR(maxValue)}</text>
          <text x={left - 7} y={height - bottom + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{formatINR(minValue)}</text>
          {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((point, index) => <circle key={`${point.label}-${index}`} cx={x(index)} cy={y(point.value)} r="3" fill={color}><title>{point.label}: {formatINR(point.value)}</title></circle>)}
          {labelIndices.map((index) => <text key={index} x={x(index)} y={height - 9} fill="#94a3b8" fontSize="10" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{points[index]?.label}</text>)}
        </svg>
      ) : <p className="py-10 text-center text-xs text-slate-500">No daily prices available.</p>}
    </section>
  );
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BacktestPage() {
  const [symbol, setSymbol] = useState('NIFTY50');
  const [entryTime, setEntryTime] = useState('09:30');
  const [exitTime, setExitTime] = useState('15:15');
  const [strikeCount, setStrikeCount] = useState(4);
  const [initialPerSideInvestment, setInitialPerSideInvestment] = useState(100000);
  const [lotSize, setLotSize] = useState(25);
  const [slippage, setSlippage] = useState(0.5);
  const [costPerTrade, setCostPerTrade] = useState(20);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dailyPoints = useMemo(() => (result?.dailyResults || []).map((row) => ({ label: row.date.slice(5), value: row.pnl })), [result]);

  const handleRunBacktest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!from || !to || from > to) {
      setError('Choose a valid start and end date.');
      return;
    }
    if (entryTime >= exitTime) {
      setError('Exit time must be later than entry time.');
      return;
    }
    if (strikeCount < 2 || !Number.isInteger(strikeCount)) {
      setError('Enter at least two strikes so positions can be selected above and below spot.');
      return;
    }
    if (!file) {
      setError('Upload a timestamped historical options CSV. The index download contains spot prices only.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set('symbol', symbol);
      form.set('entryTime', entryTime);
      form.set('exitTime', exitTime);
      form.set('strikeCount', String(strikeCount));
      form.set('initialPerSideInvestment', String(initialPerSideInvestment));
      form.set('lotSize', String(lotSize));
      form.set('slippagePerUnit', String(slippage));
      form.set('costPerTrade', String(costPerTrade));
      form.set('from', from);
      form.set('to', to);
      form.set('file', file);
      const response = await fetch('/api/backtest', { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.details || payload?.error || `Backtest failed (${response.status}).`);
      if (!payload?.metrics || !Array.isArray(payload?.trades)) throw new Error('Backtest returned an invalid result.');
      setResult(payload as BacktestResult);
      if (payload.status === 'INSUFFICIENT_DATA') setError(payload.message || 'The CSV does not have quotes for these settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run backtest.');
    } finally {
      setLoading(false);
    }
  };

  const downloadIndexPrices = async () => {
    if (!from || !to || from > to) {
      setError('Choose a valid date range before downloading index prices.');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ symbol, from, to });
      const response = await fetch(`/api/backtest/underlying-data?${query.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Could not download index prices.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${symbol.toLowerCase()}-5m-${from}-to-${to}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download index prices.');
    } finally {
      setDownloading(false);
    }
  };

  const totalPnl = result?.metrics.totalPnl ?? 0;

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col font-sans">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-6">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-400"><BarChart3 className="h-4 w-4" /></div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Intraday Options Backtest</h1>
              </div>
              <p className="mt-1 text-xs text-slate-400">Buy CE and PE around spot, close at your selected time, and compound half of profitable days.</p>
            </div>
          </header>

          {error && <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

          <form onSubmit={handleRunBacktest} className="space-y-5">
            <section className="rounded-xl border border-border bg-[#0e1320] p-5 shadow-lg">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Backtest inputs</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-slate-400">Index
                  <select value={symbol} onChange={(event) => { setSymbol(event.target.value); setLotSize(event.target.value === 'BANKNIFTY' ? 15 : event.target.value === 'SENSEX' ? 100 : 25); }} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none">
                    {INDEXES.map((index) => <option key={index.value} value={index.value}>{index.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Entry time (IST)
                  <input type="time" required value={entryTime} onChange={(event) => setEntryTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Exit time (IST)
                  <input type="time" required value={exitTime} onChange={(event) => setExitTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Number of strikes (total)
                  <input type="number" min={2} max={40} step={1} required value={strikeCount} onChange={(event) => setStrikeCount(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 font-mono text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">From date
                  <input type="date" required value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">To date
                  <input type="date" required value={to} onChange={(event) => setTo(event.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Investment per CE / PE side (₹)
                  <input type="number" min={1} step={1000} value={initialPerSideInvestment} onChange={(event) => setInitialPerSideInvestment(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 font-mono text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Lot size (units)
                  <input type="number" min={1} step={1} value={lotSize} onChange={(event) => setLotSize(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 font-mono text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Slippage per unit (₹)
                  <input type="number" min={0} step="0.05" value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 font-mono text-sm text-white" />
                </label>
                <label className="text-xs text-slate-400">Cost per leg / order (₹)
                  <input type="number" min={0} step={1} value={costPerTrade} onChange={(event) => setCostPerTrade(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 font-mono text-sm text-white" />
                </label>
              </div>
              <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs leading-5 text-indigo-100">
                <strong>Strike selection:</strong> the total count is split around spot (odd counts add one above); the nearest available strikes are chosen on both sides. Each selected strike buys both CE and PE. Each side starts at {formatINR(initialPerSideInvestment)}. After a profitable day, 50% of that day&apos;s net P&amp;L is split across the configured strikes, then split equally between CE and PE for the next day.
              </div>
            </section>

            <section className="rounded-xl border border-border bg-[#0e1320] p-5 shadow-lg">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="text-sm font-semibold text-white">Historical price data</h2><p className="mt-1 text-xs text-slate-400">Upload timestamped option quotes for CE and PE. The backtest matches prices within 5 minutes of each selected time.</p></div>
                <button type="button" onClick={() => downloadText('tradex-options-template.csv', 'timestamp,underlying,expiry,strike,optionType,underlyingPrice,ltp\n')} className="inline-flex items-center gap-2 rounded-lg border border-border bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"><FileSpreadsheet className="h-4 w-4" />CSV template</button>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <label className="block rounded-lg border border-dashed border-slate-600 bg-slate-900/60 p-4 text-xs text-slate-300">
                  <span className="mb-2 flex items-center gap-2 font-semibold text-white"><Upload className="h-4 w-4 text-cyan-400" />Historical CE/PE option CSV</span>
                  <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white" />
                  {file && <span className="mt-2 block text-emerald-300">Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</span>}
                </label>
                <button type="button" onClick={downloadIndexPrices} disabled={downloading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-slate-900 px-4 py-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Download className="h-4 w-4" />{downloading ? 'Downloading…' : 'Download 5-min index prices'}</button>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">The index download contains spot OHLC data. Historical option premiums are separate: this engine will not estimate them from index values. Include the actual option LTP at the selected entry and exit times in the uploaded CSV.</p>
            </section>

            <div className="flex justify-end">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500 disabled:opacity-50">
                {loading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />Running backtest…</> : <><Play className="h-4 w-4 fill-white" />Run Backtest</>}
              </button>
            </div>
          </form>

          {result && (
            <div className="space-y-6">
              {result.status === 'INSUFFICIENT_DATA' && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{result.message}</div>}
              <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {[
                  ['Net P&L', `${totalPnl >= 0 ? '+' : ''}${formatINR(totalPnl)}`, totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'],
                  ['Return on capital', `${result.metrics.returnOnCapital}%`, 'text-cyan-300'],
                  ['CE + PE trades', String(result.metrics.totalTrades), 'text-white'],
                  ['Win rate', `${result.metrics.winRate}%`, 'text-white'],
                  ['Max drawdown', `-${formatINR(result.metrics.maxDrawdown)}`, 'text-amber-400'],
                  ['Ending capital', formatINR(result.metrics.finalCapital), 'text-white'],
                ].map(([label, value, tone]) => <div key={label} className="rounded-xl border border-border bg-[#0e1320] p-4"><span className="mb-1 block text-[11px] text-slate-400">{label}</span><div className={`font-mono text-lg font-bold ${tone}`}>{value}</div></div>)}
              </section>

              {result.dailyResults?.length ? <>
                <section className="grid gap-4 lg:grid-cols-2">
                  <LineChart title="Daily total P&L" points={dailyPoints} color={totalPnl >= 0 ? '#34d399' : '#fb7185'} />
                  <div className="rounded-xl border border-border bg-[#0e1320] p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Reinvestment ledger</h3>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-400">Total reinvested</span><strong className="mt-1 block font-mono text-emerald-300">{formatINR(result.reinvestment?.totalReinvested || 0)}</strong></div>
                      <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-400">Final per side / strike</span><strong className="mt-1 block font-mono text-cyan-300">{formatINR(result.reinvestment?.finalPerSideInvestment || initialPerSideInvestment)}</strong></div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-400">Only positive daily net P&amp;L is reinvested. Half is allocated across all configured strikes and split equally across CE and PE on the following day.</p>
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-[#0e1320] p-5">
                  <h2 className="mb-3 text-sm font-semibold text-white">Daily results</h2>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="w-full min-w-[840px] text-left text-xs font-mono">
                      <thead className="sticky top-0 border-b border-border bg-slate-900 text-slate-400"><tr><th className="p-2.5">Date</th><th className="p-2.5">Strikes entered (above / below spot)</th><th className="p-2.5 text-right">CE P&amp;L</th><th className="p-2.5 text-right">PE P&amp;L</th><th className="p-2.5 text-right">Net P&amp;L</th><th className="p-2.5 text-right">50% reinvested</th><th className="p-2.5 text-right">Next day / side</th></tr></thead>
                      <tbody className="divide-y divide-border/40 text-slate-300">{result.dailyResults.map((day) => <tr key={day.date}><td className="p-2.5">{day.date}</td><td className="p-2.5">{day.strikesEntered.length ? day.strikesEntered.join(', ') : 'No entries'}</td><td className="p-2.5 text-right">{formatINR(day.cePnl)}</td><td className="p-2.5 text-right">{formatINR(day.pePnl)}</td><td className={`p-2.5 text-right font-bold ${day.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatINR(day.pnl)}</td><td className="p-2.5 text-right">{formatINR(day.reinvested)}</td><td className="p-2.5 text-right">{formatINR(day.investmentPerSideNextDay)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-[#0e1320] p-5">
                  <h2 className="mb-1 text-sm font-semibold text-white">Daily P&amp;L by strike</h2>
                  <p className="mb-3 text-xs text-slate-400">Each cell combines that strike&apos;s CE and PE P&amp;L for the date.</p>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="w-full min-w-max text-left text-xs font-mono">
                      <thead className="sticky top-0 border-b border-border bg-slate-900 text-slate-400"><tr><th className="sticky left-0 bg-slate-900 p-2.5">Date</th>{(result.strikeResults || []).map((strike) => <th key={strike.strike} className="whitespace-nowrap p-2.5 text-right">{strike.strike} ({strike.side.toLowerCase()})</th>)}<th className="p-2.5 text-right">Day total</th></tr></thead>
                      <tbody className="divide-y divide-border/40 text-slate-300">{result.dailyResults.map((day) => <tr key={day.date}><td className="sticky left-0 bg-[#0e1320] p-2.5">{day.date}</td>{(result.strikeResults || []).map((strike) => { const daily = strike.dailyPnl.find((point) => point.date === day.date)?.pnl || 0; return <td key={strike.strike} className={`whitespace-nowrap p-2.5 text-right ${daily >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{formatINR(daily)}</td>; })}<td className={`p-2.5 text-right font-bold ${day.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatINR(day.pnl)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-3">
                  <div><h2 className="text-sm font-semibold text-white">P&amp;L by strike</h2><p className="mt-1 text-xs text-slate-400">Each chart shows the combined CE + PE daily P&amp;L for that selected strike.</p></div>
                  <div className="grid gap-4 xl:grid-cols-2">{(result.strikeResults || []).map((strike) => <LineChart key={strike.strike} title={`${strike.strike} · ${strike.side} spot · CE ${formatINR(strike.cePnl)} · PE ${formatINR(strike.pePnl)} · Total ${formatINR(strike.totalPnl)}`} points={strike.dailyPnl.map((point) => ({ label: point.date.slice(5), value: point.pnl }))} color={strike.totalPnl >= 0 ? '#22d3ee' : '#fb7185'} />)}</div>
                </section>

                <section className="rounded-xl border border-border bg-[#0e1320] p-5">
                  <h2 className="mb-3 text-sm font-semibold text-white">Trade details</h2>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="w-full min-w-[720px] text-left text-xs font-mono">
                      <thead className="sticky top-0 border-b border-border bg-slate-900 text-slate-400"><tr><th className="p-2.5">Date</th><th className="p-2.5">Strike</th><th className="p-2.5">Side</th><th className="p-2.5">Entry / exit</th><th className="p-2.5 text-right">P&amp;L</th><th className="p-2.5 text-right">Return</th></tr></thead>
                      <tbody className="divide-y divide-border/40 text-slate-300">{result.trades.map((trade) => <tr key={trade.id}><td className="p-2.5">{trade.date.slice(0, 10)}</td><td className="p-2.5">{trade.strike}</td><td className="p-2.5">{trade.optionType}</td><td className="p-2.5">₹{trade.entryPrice} → ₹{trade.exitPrice}</td><td className={`p-2.5 text-right font-bold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatINR(trade.pnl)}</td><td className="p-2.5 text-right">{trade.returnPct}%</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
              </> : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
