import { describe, it, expect } from 'vitest';
import { roundMoney, calcAveragePrice, toDecimal } from '@/lib/trading/decimal';
import Decimal from 'decimal.js';

describe('Financial Accounting & Decimal Precision', () => {
  it('prevents JavaScript floating-point errors (0.1 + 0.2)', () => {
    const jsFloat = 0.1 + 0.2; // 0.30000000000000004
    expect(jsFloat).not.toBe(0.3);

    const exact = toDecimal(0.1).plus(toDecimal(0.2));
    expect(roundMoney(exact)).toBe(0.3);
  });

  it('calculates correct weighted average entry price for multiple purchases', () => {
    // Buy 100 shares @ ₹250
    // Buy 50 shares @ ₹280
    // Total cost = 100*250 + 50*280 = 25000 + 14000 = 39000
    // Total shares = 150
    // Weighted avg = 39000 / 150 = 260.00
    const avg = calcAveragePrice(100, 250, 50, 280);
    expect(roundMoney(avg)).toBe(260.0);
  });

  it('calculates realized P&L on partial sale accurately', () => {
    // Holding: 150 shares @ average ₹260.00
    // Sell 50 shares @ ₹300.00
    // Realized P&L = (300 - 260) * 50 = 40 * 50 = ₹2,000.00
    const avgEntry = toDecimal(260);
    const sellPrice = toDecimal(300);
    const qty = new Decimal(50);

    const realizedPnL = sellPrice.minus(avgEntry).times(qty);
    expect(roundMoney(realizedPnL)).toBe(2000.0);
  });

  it('calculates unrealized P&L correctly', () => {
    // 100 shares @ avg ₹1000
    // Current market price ₹950
    // Unrealized P&L = (950 - 1000) * 100 = -₹5,000.00
    const avgEntry = toDecimal(1000);
    const curPrice = toDecimal(950);
    const qty = new Decimal(100);

    const unrealized = curPrice.minus(avgEntry).times(qty);
    expect(roundMoney(unrealized)).toBe(-5000.0);
  });
});
