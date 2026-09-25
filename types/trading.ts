export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface OrderInput {
  symbol: string;
  exchange?: string;
  instrumentType?: 'EQUITY' | 'INDEX' | 'OPTION';
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
}

export interface PortfolioSummary {
  cashBalance: number;
  reservedBalance: number;
  investedValue: number;
  currentValue: number;
  totalAccountValue: number;
  totalUnrealizedPnL: number;
  totalRealizedPnL: number;
  todaysPnL: number;
}

export interface PositionView {
  id: string;
  symbol: string;
  exchange: string;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  currentValue: number;
  investedValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
}

export interface HoldingView {
  id: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
}
