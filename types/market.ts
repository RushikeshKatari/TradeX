export type MarketSessionStatus = 'OPEN' | 'CLOSED' | 'PRE_OPEN' | 'HOLIDAY';

export interface MarketStatus {
  isOpen: boolean;
  status: MarketSessionStatus;
  message: string;
  nextOpen: string;
  nextClose: string;
  timezone: string;
  timestamp: string;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  lastPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  volume: number;
  timestamp: string;
  isDelayed: boolean;
  marketStatus: MarketSessionStatus;
  dataSource: string;
}

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';

export interface SearchInstrumentResult {
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: 'EQUITY' | 'INDEX' | 'OPTION';
  lastPrice?: number;
  change?: number;
  changePercent?: number;
}
