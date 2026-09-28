import { NextRequest, NextResponse } from 'next/server';
import { resolveYahooSymbol } from '@/lib/market-data/symbol-map';

const LABELS: Record<string, string> = { NIFTY50: 'NIFTY50', SENSEX: 'SENSEX', BANKNIFTY: 'BANKNIFTY' };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get('symbol') || '').toUpperCase();
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  if (!LABELS[symbol] || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'Choose an index and valid date range.' }, { status: 400 });
  }

  const start = Date.parse(`${from}T00:00:00+05:30`);
  const end = Date.parse(`${to}T00:00:00+05:30`) + 24 * 60 * 60 * 1000;
  if (end - start > 60 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Yahoo 5-minute index history is limited to a 60-day range. Shorten the selected dates.' }, { status: 422 });
  }
  const ticker = resolveYahooSymbol(symbol);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set('period1', String(Math.floor(start / 1000)));
  url.searchParams.set('period2', String(Math.floor(end / 1000)));
  url.searchParams.set('interval', '5m');
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Market data provider returned HTTP ${response.status}.`);
    const payload = await response.json();
    const chart = payload?.chart?.result?.[0];
    if (!chart) throw new Error(payload?.chart?.error?.description || 'No index prices were returned for the selected dates.');
    const quote = chart.indicators?.quote?.[0] || {};
    const rows = ['timestamp,symbol,open,high,low,close,volume'];
    (chart.timestamp || []).forEach((timestamp: number, i: number) => {
      const values = [quote.open?.[i], quote.high?.[i], quote.low?.[i], quote.close?.[i]];
      if (values.some((value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value))) return;
      const localTimestamp = new Date(timestamp * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata', hour12: false });
      rows.push(`${localTimestamp},${symbol},${values.map((value: number) => Number(value.toFixed(2))).join(',')},${Math.round(quote.volume?.[i] || 0)}`);
    });
    if (rows.length === 1) return NextResponse.json({ error: 'No 5-minute index prices were returned for the selected dates.' }, { status: 422 });
    return new NextResponse(`${rows.join('\n')}\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${symbol.toLowerCase()}-5m-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not download index prices.' }, { status: 502 });
  }
}
