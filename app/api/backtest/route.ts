import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataProvider } from '@/lib/market-data';
import { BacktestConfig } from '@/types/backtest';
import { HistoricalOptionDataProvider } from '@/lib/market-data/historical-option-provider';
import { runBacktestSimulation } from '@/lib/analysis/backtesting-engine';

function unavailableResult(config: BacktestConfig, details: string) {
  return {
    status: 'INSUFFICIENT_DATA' as const,
    message: details,
    config,
    metrics: {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      finalCapital: config.startingCapital,
      returnOnCapital: 0,
      averageTradePnl: 0,
    },
    trades: [],
    equityCurve: [],
    regimePerformance: [],
    signalCounts: { LONG_CALL: 0, LONG_PUT: 0, VOLATILITY_STRATEGY: 0, NO_TRADE: 0 },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const startingCapital = Number(body.startingCapital);
    const lotSize = Number(body.lotSize);
    const slippagePerUnit = Number(body.slippagePerUnit);
    const costPerTrade = Number(body.costPerTrade);

    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      return NextResponse.json({ error: 'Starting capital must be greater than zero.' }, { status: 400 });
    }
    if (!Number.isFinite(lotSize) || lotSize <= 0) {
      return NextResponse.json({ error: 'Lot size must be greater than zero.' }, { status: 400 });
    }
    if (!Number.isFinite(slippagePerUnit) || slippagePerUnit < 0 || !Number.isFinite(costPerTrade) || costPerTrade < 0) {
      return NextResponse.json({ error: 'Slippage and cost per trade cannot be negative.' }, { status: 400 });
    }

    const config: BacktestConfig = {
      symbol: (body.symbol || 'NIFTY50').toUpperCase(),
      startingCapital,
      lotSize,
      slippagePerUnit,
      costPerTrade,
      strategy: body.strategy || 'REGIME_MOMENTUM',
    };

    const provider = getMarketDataProvider();

    // The current TypeScript market-data contract has historical underlying
    // candles and a *current* option chain only. It has no historical option
    // contracts/premiums, so running the old candle-only simulation would
    // fabricate option data and produce invalid backtest results.
    const from = typeof body.from === 'string' ? body.from : undefined;
    const to = typeof body.to === 'string' ? body.to : undefined;
    const options = await new HistoricalOptionDataProvider().getHistoricalOptions(config.symbol, from, to);
    const candles = Array.from(new Map(options.map((row) => [row.timestamp.slice(0, 10), { time: Math.floor(Date.parse(row.timestamp) / 1000), open: row.underlyingPrice, high: row.underlyingPrice, low: row.underlyingPrice, close: row.underlyingPrice, volume: row.volume || 0 }])).values());
    if (candles.length < 25) return NextResponse.json(unavailableResult(config, 'Historical option data unavailable for the selected period. At least 25 dated sessions are required.'));
    return NextResponse.json(runBacktestSimulation(candles, config, options));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Backtest failed to execute', details: msg },
      { status: 500 }
    );
  }
}
