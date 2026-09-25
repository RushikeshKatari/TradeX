import { MarketDataProvider } from './types';
import { Quote, Candle, CandleInterval, MarketStatus, SearchInstrumentResult } from '@/types/market';
import { OptionChainData, OptionStrikeRow } from '@/types/options';
import { getIndianMarketStatus } from './calendar';
import { SYMBOL_MAP } from './symbol-map';

// Deterministic baseline prices for development & offline test suite
const DEV_BASE_PRICES: Record<string, number> = {
  'NIFTY50': 24850.50,
  'NIFTY': 24850.50,
  'SENSEX': 81220.25,
  'BANKNIFTY': 52340.75,
  'NIFTYIT': 41850.00,
  'RELIANCE': 2945.80,
  'TCS': 4190.20,
  'INFY': 1885.60,
  'HDFCBANK': 1665.40,
  'ICICIBANK': 1240.15,
  'SBIN': 795.30,
  'BHARTIARTL': 1630.90,
  'ITC': 490.50,
  'KOTAKBANK': 1775.25,
  'LT': 3650.00,
};

export class DevelopmentMarketDataProvider implements MarketDataProvider {
  name = 'Development Sandbox Provider (Local Testing Only)';

  async getMarketStatus(): Promise<MarketStatus> {
    return getIndianMarketStatus();
  }

  async getQuote(symbol: string): Promise<Quote> {
    const upper = symbol.toUpperCase().trim();
    const base = DEV_BASE_PRICES[upper] || 1500.00;
    const meta = SYMBOL_MAP[upper] || { name: upper, exchange: 'NSE' as const, type: 'EQUITY' as const };
    const change = Number((base * 0.008).toFixed(2));
    const changePercent = 0.80;

    return {
      symbol: upper,
      name: meta.name,
      exchange: meta.exchange,
      lastPrice: base,
      change,
      changePercent,
      open: Number((base - 10).toFixed(2)),
      high: Number((base + 15).toFixed(2)),
      low: Number((base - 18).toFixed(2)),
      close: base,
      previousClose: Number((base - change).toFixed(2)),
      volume: 1250000,
      timestamp: new Date().toISOString(),
      isDelayed: false,
      marketStatus: getIndianMarketStatus().status,
      dataSource: 'Development Data Adapter',
    };
  }

  async getHistoricalCandles(symbol: string, interval: CandleInterval, range: string = '1mo'): Promise<Candle[]> {
    const upper = symbol.toUpperCase().trim();
    const base = DEV_BASE_PRICES[upper] || 1500.00;
    const count = 60; // 60 candles
    const candles: Candle[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const stepSec = interval === '1D' ? 86400 : interval === '1h' ? 3600 : 300;

    let currentPrice = base * 0.95;
    for (let i = count; i >= 0; i--) {
      const time = nowSec - (i * stepSec);
      const delta = (Math.sin(i / 3) * 10) + ((i % 5) - 2);
      const open = Number((currentPrice).toFixed(2));
      const close = Number((currentPrice + delta).toFixed(2));
      const high = Number((Math.max(open, close) + Math.abs(delta) * 0.5 + 2).toFixed(2));
      const low = Number((Math.min(open, close) - Math.abs(delta) * 0.5 - 2).toFixed(2));
      const volume = Math.round(50000 + Math.abs(delta) * 8000);

      candles.push({ time, open, high, low, close, volume });
      currentPrice = close;
    }

    return candles;
  }

  async getOptionChain(symbol: string, expiry?: string): Promise<OptionChainData> {
    const upper = symbol.toUpperCase().trim();
    const spot = DEV_BASE_PRICES[upper] || 24850.50;
    const step = 50;
    const atm = Math.round(spot / step) * step;

    const expiryDates = ['26-Sep-2026', '03-Oct-2026', '10-Oct-2026', '31-Oct-2026'];
    const selectedExpiry = expiry || expiryDates[0];

    const strikes: OptionStrikeRow[] = [];
    let maxCeVol = 0;
    let maxCeStrike = 0;
    let maxPeVol = 0;
    let maxPeStrike = 0;
    let totalCeVol = 0;
    let totalPeVol = 0;
    let totalCeOi = 0;
    let totalPeOi = 0;

    for (let i = -7; i <= 7; i++) {
      const strikePrice = atm + (i * step);
      const dist = (strikePrice - spot) / spot;
      const ceVol = Math.round(60000 * Math.exp(-Math.abs(dist) * 12));
      const peVol = Math.round(55000 * Math.exp(-Math.abs(dist) * 12));
      const ceOi = ceVol * 4;
      const peOi = peVol * 4;

      if (ceVol > maxCeVol) { maxCeVol = ceVol; maxCeStrike = strikePrice; }
      if (peVol > maxPeVol) { maxPeVol = peVol; maxPeStrike = strikePrice; }

      totalCeVol += ceVol;
      totalPeVol += peVol;
      totalCeOi += ceOi;
      totalPeOi += peOi;

      const ceLtp = Math.max(1, Math.round(Math.max(0, spot - strikePrice) + 120 * Math.exp(-Math.abs(dist) * 10)));
      const peLtp = Math.max(1, Math.round(Math.max(0, strikePrice - spot) + 120 * Math.exp(-Math.abs(dist) * 10)));

      strikes.push({
        strikePrice,
        ce: {
          ltp: ceLtp,
          change: 2.5,
          volume: ceVol,
          oi: ceOi,
          changeOi: 1200,
          iv: 13.8,
          bid: ceLtp - 0.2,
          ask: ceLtp + 0.2,
        },
        pe: {
          ltp: peLtp,
          change: -1.8,
          volume: peVol,
          oi: peOi,
          changeOi: 950,
          iv: 14.2,
          bid: peLtp - 0.2,
          ask: peLtp + 0.2,
        },
      });
    }

    return {
      underlyingSymbol: upper,
      underlyingPrice: spot,
      timestamp: new Date().toISOString(),
      expiryDates,
      selectedExpiry,
      strikes,
      highestVolumeStrikeCE: { strike: maxCeStrike, volume: maxCeVol },
      highestVolumeStrikePE: { strike: maxPeStrike, volume: maxPeVol },
      pcr: {
        volumePcr: Number((totalPeVol / (totalCeVol || 1)).toFixed(2)),
        oiPcr: Number((totalPeOi / (totalCeOi || 1)).toFixed(2)),
      },
      dataSource: 'Development Data Adapter',
      isDelayed: false,
    };
  }

  async searchInstruments(query: string): Promise<SearchInstrumentResult[]> {
    const q = query.toUpperCase().trim();
    const list: SearchInstrumentResult[] = [];
    for (const [sym, info] of Object.entries(SYMBOL_MAP)) {
      if (sym.includes(q) || info.name.toUpperCase().includes(q)) {
        list.push({
          symbol: sym,
          name: info.name,
          exchange: info.exchange,
          instrumentType: info.type,
          lastPrice: DEV_BASE_PRICES[sym] || 1500,
          change: 12.5,
          changePercent: 0.85,
        });
      }
    }
    return list;
  }
}
