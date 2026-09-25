import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function toDecimal(val: number | string | Decimal | null | undefined): Decimal {
  if (val === null || val === undefined) return new Decimal(0);
  return new Decimal(val);
}

export function roundMoney(val: Decimal | number | string): number {
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function calcAveragePrice(oldQty: number, oldAvg: Decimal | number, addQty: number, addPrice: Decimal | number): Decimal {
  const oQ = new Decimal(oldQty);
  const oA = new Decimal(oldAvg);
  const nQ = new Decimal(addQty);
  const nP = new Decimal(addPrice);

  const totalCost = oQ.times(oA).plus(nQ.times(nP));
  const totalQty = oQ.plus(nQ);

  if (totalQty.isZero()) return new Decimal(0);
  return totalCost.dividedBy(totalQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
