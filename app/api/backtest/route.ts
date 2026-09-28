import { NextRequest, NextResponse } from 'next/server';
import { BacktestConfig } from '@/types/backtest';
import { HistoricalOptionDataProvider, parseHistoricalOptionsCsv } from '@/lib/market-data/historical-option-provider';
import { runIntradayBacktest } from '@/lib/analysis/backtesting-engine';

const ALLOWED_SYMBOLS = new Set(['NIFTY50', 'SENSEX', 'BANKNIFTY']);

export async function POST(request: NextRequest) {
  try {
    const isMultipart = request.headers.get('content-type')?.includes('multipart/form-data');
    let body: Record<string, FormDataEntryValue | string>;
    let upload: File | null = null;
    if (isMultipart) {
      const form = await request.formData();
      body = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'));
      const candidate = form.get('file');
      upload = candidate instanceof File && candidate.size ? candidate : null;
    } else {
      body = await request.json();
    }

    const symbol = String(body.symbol || '').toUpperCase();
    const from = String(body.from || '');
    const to = String(body.to || '');
    const entryTime = String(body.entryTime || '');
    const exitTime = String(body.exitTime || '');
    const strikeCount = Number(body.strikeCount);
    const lotSize = Number(body.lotSize);
    const slippagePerUnit = Number(body.slippagePerUnit);
    const costPerTrade = Number(body.costPerTrade);
    const initialPerSideInvestment = Number(body.initialPerSideInvestment || 100000);

    if (!ALLOWED_SYMBOLS.has(symbol)) return NextResponse.json({ error: 'Choose NIFTY, SENSEX, or BANK NIFTY.' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return NextResponse.json({ error: 'Choose a valid date range.' }, { status: 400 });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entryTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(exitTime) || entryTime >= exitTime) {
      return NextResponse.json({ error: 'Enter valid times, with the exit time later than the entry time.' }, { status: 400 });
    }
    if (!Number.isInteger(strikeCount) || strikeCount < 2 || strikeCount > 40) {
      return NextResponse.json({ error: 'Strike count must be an integer from 2 to 40.' }, { status: 400 });
    }
    if (!Number.isFinite(lotSize) || lotSize <= 0 || !Number.isFinite(initialPerSideInvestment) || initialPerSideInvestment <= 0) {
      return NextResponse.json({ error: 'Lot size and investment per CE/PE side must be greater than zero.' }, { status: 400 });
    }
    if (!Number.isFinite(slippagePerUnit) || slippagePerUnit < 0 || !Number.isFinite(costPerTrade) || costPerTrade < 0) {
      return NextResponse.json({ error: 'Slippage and cost per trade cannot be negative.' }, { status: 400 });
    }
    if (upload && upload.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'The uploaded CSV must be 20 MB or smaller.' }, { status: 413 });
    }

    const config: BacktestConfig = {
      symbol, startingCapital: initialPerSideInvestment * 2 * strikeCount,
      lotSize, slippagePerUnit, costPerTrade, strategy: 'VOLATILITY_STRADDLE',
      entryTime, exitTime, strikeCount, initialPerSideInvestment,
    };
    const options = upload
      ? parseHistoricalOptionsCsv(await upload.text(), symbol, from, to)
      : await new HistoricalOptionDataProvider().getHistoricalOptions(symbol, from, to);
    if (!options.length) return NextResponse.json({ error: 'No matching historical option prices were found for this index and date range.' }, { status: 422 });
    return NextResponse.json(runIntradayBacktest(config, options));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Backtest failed to execute', details: msg }, { status: 500 });
  }
}
