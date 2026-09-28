export type BacktestStrategyType =
  | 'REGIME_MOMENTUM'
  | 'LONG_CALL_BREAKOUT'
  | 'LONG_PUT_BREAKDOWN'
  | 'VOLATILITY_STRADDLE';

export interface BacktestConfig {
  symbol: string;
  startingCapital: number;
  lotSize: number;
  slippagePerUnit: number;
  costPerTrade: number;
  strategy: BacktestStrategyType;
}

export interface BacktestTrade {
  id: string;
  date: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  strike: number;
  optionType: 'CE' | 'PE';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
  regime: string;
  reason: string;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  finalCapital: number;
  returnOnCapital: number;
  averageTradePnl: number;
}

export interface RegimePerformance {
  regime: string;
  trades: number;
  winRate: number;
  pnl: number;
}

export interface BacktestResult {
  status: 'SUCCESS' | 'INSUFFICIENT_DATA' | 'ERROR';
  message?: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { date: string; equity: number }[];
  regimePerformance: RegimePerformance[];
  signalCounts: Record<string, number>;
}
