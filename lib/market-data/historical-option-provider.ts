import fs from 'node:fs/promises';
import { HistoricalOptionObservation } from '@/types/historical-options';

const aliases: Record<string, string> = {
  date: 'date', datetime: 'timestamp', timestamp: 'timestamp', time: 'time', symbol: 'underlying', index: 'underlying', underlying: 'underlying', spot: 'underlyingPrice',
  underlying_price: 'underlyingPrice', underlyingprice: 'underlyingPrice', option_type: 'optionType', optiontype: 'optionType', type: 'optionType', expiry_date: 'expiry', oi: 'oi', open_interest: 'oi',
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

function parseTimestamp(value: string): number {
  const input = value.trim();
  if (!input) return NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input);
  const normalized = input.includes('T') ? input : input.replace(' ', 'T');
  return Date.parse(hasZone ? normalized : `${normalized}+05:30`);
}

export function parseHistoricalOptionsCsv(text: string, symbol?: string, from?: string, to?: string): HistoricalOptionObservation[] {
  const rows = csvRows(text);
  const required = ['underlying', 'expiry', 'strike', 'optionType', 'underlyingPrice', 'ltp'];
  const missing = required.filter((key) => !rows[0] || !(key in rows[0]));
  if (!rows[0] || (!('timestamp' in rows[0]) && !('date' in rows[0]))) missing.push('timestamp');
  if (missing.length) throw new Error(`Historical option data is missing required columns: ${[...new Set(missing)].join(', ')}.`);
  const fromTime = from ? Date.parse(`${from}T00:00:00+05:30`) : -Infinity;
  const toTime = to ? Date.parse(`${to}T23:59:59.999+05:30`) : Infinity;
  const normalizedSymbol = symbol?.toUpperCase();
  const observations: HistoricalOptionObservation[] = [];
  for (const row of rows) {
    const dateTime = row.timestamp || [row.date, row.time].filter(Boolean).join(' ');
    const timestamp = parseTimestamp(dateTime);
    const optionType = (row.optionType || '').toUpperCase().replace('CALL', 'CE').replace('PUT', 'PE');
    const rawUnderlying = (row.underlying || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const underlying = rawUnderlying === 'NIFTY' ? 'NIFTY50' : rawUnderlying;
    const strike = Number(row.strike), spot = Number(row.underlyingPrice), ltp = Number(row.ltp);
    if (!Number.isFinite(timestamp) || timestamp < fromTime || timestamp > toTime || !underlying || !row.expiry || !['CE', 'PE'].includes(optionType) || !Number.isFinite(strike) || !Number.isFinite(spot) || !Number.isFinite(ltp)) continue;
    if (normalizedSymbol && underlying !== (normalizedSymbol === 'NIFTY' ? 'NIFTY50' : normalizedSymbol.replace(/[^A-Z0-9]/g, ''))) continue;
    const n = (key: string) => row[key] === '' || row[key] === undefined ? undefined : Number(row[key]);
    observations.push({ timestamp: new Date(timestamp).toISOString(), underlying: normalizedSymbol || underlying, underlyingPrice: spot, expiry: row.expiry, strike, optionType: optionType as 'CE' | 'PE', ltp, open: n('open'), high: n('high'), low: n('low'), close: n('close'), volume: n('volume'), oi: n('oi'), changeOi: n('changeOi'), iv: n('iv'), bid: n('bid'), ask: n('ask') });
  }
  return observations.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export class HistoricalOptionDataProvider {
  async getHistoricalOptions(symbol: string, from?: string, to?: string): Promise<HistoricalOptionObservation[]> {
    const path = process.env.BACKTEST_OPTIONS_FILE;
    if (!path) throw new Error('Historical option data unavailable for the selected period. BACKTEST_OPTIONS_FILE is not configured.');
    let contents: string;
    try { contents = await fs.readFile(path, 'utf8'); } catch { throw new Error('Historical option data unavailable for the selected period.'); }
    const result = parseHistoricalOptionsCsv(contents, symbol, from, to);
    if (!result.length) throw new Error('Historical option data unavailable for the selected period.');
    return result;
  }
}
