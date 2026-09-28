import { MarketDataProvider } from './types';
import { LiveMarketDataProvider } from './live-provider';
import { DevelopmentMarketDataProvider } from './dev-provider';

let cachedProvider: MarketDataProvider | null = null;
let cachedMode: string | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  const mode = process.env.MARKET_DATA_MODE || 'live';
  if (cachedProvider && cachedMode === mode) return cachedProvider;

  if (mode === 'live') {
    cachedProvider = new LiveMarketDataProvider();
  } else {
    cachedProvider = new DevelopmentMarketDataProvider();
  }
  cachedMode = mode;

  return cachedProvider;
}
