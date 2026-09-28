import { Candle } from '@/types/market';
import { BacktestConfig, BacktestResult, BacktestTrade, BacktestMetrics, RegimePerformance } from '@/types/backtest';
import { detectMarketRegime } from './regime-engine';
import { analyzeOptionsSignal } from '../options/options-signal-engine';
import { HistoricalOptionObservation } from '@/types/historical-options';

export function runBacktestSimulation(
  candles: Candle[],
  config: BacktestConfig,
  historicalOptions: HistoricalOptionObservation[] = []
): BacktestResult {
  const signalCounts: Record<string, number> = {
    LONG_CALL: 0,
    LONG_PUT: 0,
    VOLATILITY_STRATEGY: 0,
    NO_TRADE: 0,
  };

  if (!candles || candles.length < 25) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: `Historical series contains ${candles?.length || 0} bars. At least 25 bars are required for reliable indicator simulation.`,
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
      equityCurve: [{ date: new Date().toISOString(), equity: config.startingCapital }],
      regimePerformance: [],
      signalCounts,
    };
  }
  if (!historicalOptions.length) {
    return { status: 'INSUFFICIENT_DATA', message: 'Historical option data unavailable for the selected period.', config, metrics: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnl: 0, profitFactor: 0, maxDrawdown: 0, maxDrawdownPct: 0, finalCapital: config.startingCapital, returnOnCapital: 0, averageTradePnl: 0 }, trades: [], equityCurve: [], regimePerformance: [], signalCounts };
  }

  let capital = config.startingCapital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; equity: number }[] = [];
  const regimeStats: Record<string, { trades: number; wins: number; pnl: number }> = {
    BULLISH: { trades: 0, wins: 0, pnl: 0 },
    BEARISH: { trades: 0, wins: 0, pnl: 0 },
    SIDEWAYS: { trades: 0, wins: 0, pnl: 0 },
  };

  const getIsoDate = (bar: Candle) =>
    typeof bar.time === 'number' ? new Date(bar.time * 1000).toISOString() : new Date().toISOString();

  equityCurve.push({ date: getIsoDate(candles[20]), equity: capital });

  // Walk forward from bar 20 through end
  for (let i = 20; i < candles.length - 1; i++) {
    const windowCandles = candles.slice(0, i + 1);
    const currentBar = candles[i];
    const nextBar = candles[i + 1];
    const nextDate = getIsoDate(nextBar);

    const regime = detectMarketRegime(windowCandles);
    const spot = currentBar.close;
    const step = config.symbol.toUpperCase().includes('BANK') ? 100 : 50;
    const atmStrike = Math.round(spot / step) * step;

    const sessionRows = historicalOptions.filter((row) => row.timestamp.slice(0, 10) === getIsoDate(currentBar).slice(0, 10));
    if (!sessionRows.length) continue;
    const mockChain = {
      underlyingSymbol: config.symbol,
      underlyingPrice: spot,
      timestamp: nextDate,
      selectedExpiry: nextDate,
      expiryDates: [nextDate],
      highestVolumeStrikeCE: { strike: atmStrike, volume: 50000 },
      highestVolumeStrikePE: { strike: atmStrike, volume: 45000 },
      pcr: { volumePcr: 1.0, oiPcr: 1.0 },
      dataSource: 'Backtest Engine',
      isDelayed: false,
      strikes: Array.from(new Set(sessionRows.map((row) => row.strike))).map((strike) => {
        const row = sessionRows.filter((item) => item.strike === strike);
        const leg = (type: 'CE' | 'PE') => { const item = row.find((candidate) => candidate.optionType === type); return item ? { ltp: item.ltp, change: 0, volume: item.volume || 0, oi: item.oi || 0, changeOi: item.changeOi || 0, iv: item.iv, bid: item.bid, ask: item.ask } : null; };
        return { strikePrice: strike, ce: leg('CE'), pe: leg('PE') };
      }),
    };

    const signal = analyzeOptionsSignal(regime, mockChain, spot);
    signalCounts[signal.signal] = (signalCounts[signal.signal] || 0) + 1;

    // Check strategy entry condition
    let shouldTrade = false;
    let optType: 'CE' | 'PE' = 'CE';

    if (config.strategy === 'REGIME_MOMENTUM') {
      if (signal.signal === 'LONG_CALL') {
        shouldTrade = true;
        optType = 'CE';
      } else if (signal.signal === 'LONG_PUT') {
        shouldTrade = true;
        optType = 'PE';
      }
    } else if (config.strategy === 'LONG_CALL_BREAKOUT' && signal.signal === 'LONG_CALL') {
      shouldTrade = true;
      optType = 'CE';
    } else if (config.strategy === 'LONG_PUT_BREAKDOWN' && signal.signal === 'LONG_PUT') {
      shouldTrade = true;
      optType = 'PE';
    }

    if (shouldTrade) {
      const entryRow = sessionRows.find((row) => row.strike === signal.strike && row.optionType === optType);
      const nextDateRows = historicalOptions.filter((row) => row.timestamp.slice(0, 10) === getIsoDate(nextBar).slice(0, 10) && row.strike === signal.strike && row.optionType === optType && row.expiry === entryRow?.expiry);
      if (!entryRow || !nextDateRows.length) continue;
      const entryPrice = entryRow.ltp + config.slippagePerUnit;
      const nextSpot = nextBar.close;
      const exitPrice = Math.max(0.5, nextDateRows[0].ltp - config.slippagePerUnit);
      const units = config.lotSize;
      const grossPnl = (exitPrice - entryPrice) * units;
      const netPnl = Number((grossPnl - (config.costPerTrade * 2)).toFixed(2));
      const returnPct = Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));

      capital += netPnl;
      if (capital > peakCapital) peakCapital = capital;
      const currentDrawdown = peakCapital - capital;
      if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

      const trade: BacktestTrade = {
        id: `BT-${trades.length + 1}`,
        date: getIsoDate(currentBar),
        symbol: config.symbol,
        action: 'BUY',
        strike: atmStrike,
        optionType: optType,
        entryPrice: Number(entryPrice.toFixed(2)),
        exitPrice: Number(exitPrice.toFixed(2)),
        pnl: netPnl,
        returnPct,
        regime: regime.regime,
        reason: signal.reasons[0] || `${regime.regime} signal triggered`,
      };

      trades.push(trade);

      if (regimeStats[regime.regime]) {
        regimeStats[regime.regime].trades += 1;
        if (netPnl > 0) regimeStats[regime.regime].wins += 1;
        regimeStats[regime.regime].pnl += netPnl;
      }
    }

    equityCurve.push({ date: nextDate, equity: Number(capital.toFixed(2)) });
  }

  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl <= 0).length;
  const totalPnl = Number((capital - config.startingCapital).toFixed(2));
  const winRate = trades.length > 0 ? Number(((winningTrades / trades.length) * 100).toFixed(1)) : 0;
  
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 0;

  const maxDrawdownPct = peakCapital > 0 ? Number(((maxDrawdown / peakCapital) * 100).toFixed(1)) : 0;
  const returnOnCapital = Number(((totalPnl / config.startingCapital) * 100).toFixed(2));
  const averageTradePnl = trades.length > 0 ? Number((totalPnl / trades.length).toFixed(2)) : 0;

  const metrics: BacktestMetrics = {
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate,
    totalPnl,
    profitFactor,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct,
    finalCapital: Number(capital.toFixed(2)),
    returnOnCapital,
    averageTradePnl,
  };

  const regimePerformance: RegimePerformance[] = Object.entries(regimeStats)
    .filter(([_, stats]) => stats.trades > 0)
    .map(([regime, stats]) => ({
      regime,
      trades: stats.trades,
      winRate: Number(((stats.wins / stats.trades) * 100).toFixed(1)),
      pnl: Number(stats.pnl.toFixed(2)),
    }));

  return {
    status: 'SUCCESS',
    config,
    metrics,
    trades: trades.reverse(), // most recent first
    equityCurve,
    regimePerformance,
    signalCounts,
  };
}
