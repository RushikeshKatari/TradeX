import fs from 'node:fs/promises';
import { HistoricalOptionObservation } from '@/types/historical-options';

const aliases: Record<string, string> = {
  date: 'timestamp', timestamp: 'timestamp', symbol: 'underlying', underlying: 'underlying', spot: 'underlyingPrice',
  underlying_price: 'underlyingPrice', option_type: 'optionType', type: 'optionType', oi: 'oi', open_interest: 'oi',
  change_in_oi: 'changeOi', changeoi: 'changeOi', bid_price: 'bid', ask_price: 'ask',
};

function csvRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => aliases[h.trim().toLowerCase()] || h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() || '']));
  });
}

export class HistoricalOptionDataProvider {
  async getHistoricalOptions(symbol: string, from?: string, to?: string): Promise<HistoricalOptionObservation[]> {
    const path = process.env.BACKTEST_OPTIONS_FILE;
    if (!path) throw new Error('Historical option data unavailable for the selected period. BACKTEST_OPTIONS_FILE is not configured.');
    let rows: Record<string, string>[];
    try { rows = csvRows(await fs.readFile(path, 'utf8')); } catch { throw new Error('Historical option data unavailable for the selected period.'); }
    const required = ['timestamp', 'underlying', 'expiry', 'strike', 'optionType', 'underlyingPrice', 'ltp'];
    const missing = required.filter((key) => !rows[0] || !(key in rows[0]));
    if (missing.length) throw new Error(`Historical option data is missing required columns: ${missing.join(', ')}.`);
    const fromTime = from ? Date.parse(from) : -Infinity;
    const toTime = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
    const observations: HistoricalOptionObservation[] = [];
    for (const row of rows) {
      const timestamp = Date.parse(row.timestamp);
      const optionType = row.optionType.toUpperCase().replace('CALL', 'CE').replace('PUT', 'PE');
      const strike = Number(row.strike), spot = Number(row.underlyingPrice), ltp = Number(row.ltp);
      if (!Number.isFinite(timestamp) || timestamp < fromTime || timestamp > toTime || !row.underlying || !row.expiry || !['CE', 'PE'].includes(optionType) || !Number.isFinite(strike) || !Number.isFinite(spot) || !Number.isFinite(ltp)) continue;
      const n = (key: string) => row[key] === '' ? undefined : Number(row[key]);
      observations.push({ timestamp: new Date(timestamp).toISOString(), underlying: row.underlying.toUpperCase(), underlyingPrice: spot, expiry: row.expiry, strike, optionType: optionType as 'CE' | 'PE', ltp, open: n('open'), high: n('high'), low: n('low'), close: n('close'), volume: n('volume'), oi: n('oi'), changeOi: n('changeOi'), iv: n('iv'), bid: n('bid'), ask: n('ask') });
    }
    const result = observations.filter((row) => row.underlying === symbol.toUpperCase()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!result.length) throw new Error('Historical option data unavailable for the selected period.');
    return result;
  }
}
