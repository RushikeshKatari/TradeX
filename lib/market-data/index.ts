import { MarketDataProvider } from './types';
import { LiveMarketDataProvider } from './live-provider';
import { DevelopmentMarketDataProvider } from './dev-provider';

let cachedProvider: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (cachedProvider) return cachedProvider;

  const mode = process.env.MARKET_DATA_MODE || 'development';
  if (mode === 'live') {
    cachedProvider = new LiveMarketDataProvider();
  } else {
    cachedProvider = new DevelopmentMarketDataProvider();
  }

  return cachedProvider;
}
