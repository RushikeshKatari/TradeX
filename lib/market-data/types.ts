import { Quote, Candle, CandleInterval, MarketStatus, SearchInstrumentResult } from '@/types/market';
import { OptionChainData } from '@/types/options';

export interface MarketDataProvider {
  name: string;
  getQuote(symbol: string): Promise<Quote>;
  getHistoricalCandles(symbol: string, interval: CandleInterval, range?: string): Promise<Candle[]>;
  getOptionChain(symbol: string, expiry?: string): Promise<OptionChainData>;
  getMarketStatus(): Promise<MarketStatus>;
  searchInstruments(query: string): Promise<SearchInstrumentResult[]>;
}
