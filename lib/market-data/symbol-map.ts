export const SYMBOL_MAP: Record<string, { yahoo: string; name: string; exchange: 'NSE' | 'BSE'; type: 'INDEX' | 'EQUITY' }> = {
  'NIFTY50': { yahoo: '^NSEI', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
  'NIFTY': { yahoo: '^NSEI', name: 'NIFTY 50', exchange: 'NSE', type: 'INDEX' },
  'SENSEX': { yahoo: '^BSESN', name: 'BSE SENSEX', exchange: 'BSE', type: 'INDEX' },
  'BANKNIFTY': { yahoo: '^NSEBANK', name: 'NIFTY BANK', exchange: 'NSE', type: 'INDEX' },
  'NIFTYIT': { yahoo: '^CNXIT', name: 'NIFTY IT', exchange: 'NSE', type: 'INDEX' },
  'RELIANCE': { yahoo: 'RELIANCE.NS', name: 'Reliance Industries Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'TCS': { yahoo: 'TCS.NS', name: 'Tata Consultancy Services Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'INFY': { yahoo: 'INFY.NS', name: 'Infosys Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'HDFCBANK': { yahoo: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'ICICIBANK': { yahoo: 'ICICIBANK.NS', name: 'ICICI Bank Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'SBIN': { yahoo: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE', type: 'EQUITY' },
  'BHARTIARTL': { yahoo: 'BHARTIARTL.NS', name: 'Bharti Airtel Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'ITC': { yahoo: 'ITC.NS', name: 'ITC Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'KOTAKBANK': { yahoo: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'LT': { yahoo: 'LT.NS', name: 'Larsen & Toubro Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'TATAMOTORS': { yahoo: 'TATAMOTORS.NS', name: 'Tata Motors Ltd.', exchange: 'NSE', type: 'EQUITY' },
  'WIPRO': { yahoo: 'WIPRO.NS', name: 'Wipro Ltd.', exchange: 'NSE', type: 'EQUITY' },
};

export function resolveYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  if (SYMBOL_MAP[upper]) return SYMBOL_MAP[upper].yahoo;
  if (upper.endsWith('.NS') || upper.endsWith('.BO') || upper.startsWith('^')) return upper;
  return upper + '.NS';
}
