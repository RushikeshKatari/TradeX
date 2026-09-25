import { describe, it, expect } from 'vitest';
import { getIndianMarketStatus } from '@/lib/market-data/calendar';

describe('Indian Market Calendar & Hours', () => {
  it('correctly marks weekend as closed', () => {
    // Sunday: 2026-09-27
    const sunday = new Date('2026-09-27T06:00:00Z');
    const status = getIndianMarketStatus(sunday);
    expect(status.isOpen).toBe(false);
    expect(status.status).toBe('CLOSED');
    expect(status.message).toContain('weekend');
  });

  it('correctly recognizes Indian national holiday (Republic Day: Jan 26)', () => {
    const republicDay = new Date('2026-01-26T05:00:00Z'); // Monday 10:30 AM IST
    const status = getIndianMarketStatus(republicDay);
    expect(status.isOpen).toBe(false);
    expect(status.status).toBe('HOLIDAY');
    expect(status.message).toContain('holiday');
  });

  it('handles Asia/Kolkata timezone properly', () => {
    const status = getIndianMarketStatus();
    expect(status.timezone).toBe('Asia/Kolkata');
    expect(status.nextOpen).toBe('09:15 AM IST');
    expect(status.nextClose).toBe('03:30 PM IST');
  });
});
