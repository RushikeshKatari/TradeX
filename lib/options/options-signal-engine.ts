import { OptionChainData, OptionStrikeRow } from '@/types/options';
import { RegimeResult } from '@/types/regime';
import { OptionsSignal, OptionsTradeSignalType } from '@/types/options-signal';

export function parseDaysToExpiry(expiryStr?: string): number {
  if (!expiryStr) return 4;
  const parsed = new Date(expiryStr);
  if (isNaN(parsed.getTime())) return 4;
  const diffDays = Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(diffDays, 1);
}

export function estimateExpectedMove(
  spot: number,
  straddlePrice: number,
  iv: number | null,
  daysToExpiry: number
): number {
  if (straddlePrice > 0) {
    return straddlePrice;
  }
  if (iv && daysToExpiry > 0) {
    return spot * (iv / 100) * Math.sqrt(daysToExpiry / 365);
  }
  return spot * 0.015;
}

export function analyzeOptionsSignal(
  regime: RegimeResult,
  chain: OptionChainData | null,
  spotPrice?: number
): OptionsSignal {
  if (!chain || !chain.strikes || chain.strikes.length === 0) {
    return {
      signal: 'NO_TRADE',
      confidence: 0,
      reasons: ['Option chain data is currently unavailable for signal analysis.'],
      timestamp: new Date().toISOString(),
    };
  }

  const spot = spotPrice || chain.underlyingPrice;
  if (!spot) {
    return {
      signal: 'NO_TRADE',
      confidence: 0,
      reasons: ['Underlying spot price unavailable.'],
      timestamp: new Date().toISOString(),
    };
  }

  // Derive ATM strike: find strike closest to spot
  let atmStrike = chain.strikes[0].strikePrice;
  let minDiff = Math.abs(atmStrike - spot);
  for (const s of chain.strikes) {
    const diff = Math.abs(s.strikePrice - spot);
    if (diff < minDiff) {
      minDiff = diff;
      atmStrike = s.strikePrice;
    }
  }

  const atmRow = chain.strikes.find((s) => s.strikePrice === atmStrike) || chain.strikes[Math.floor(chain.strikes.length / 2)];

  const atmCe = atmRow?.ce;
  const atmPe = atmRow?.pe;
  const atmCePremium = atmCe?.ltp || 0;
  const atmPePremium = atmPe?.ltp || 0;
  const straddleCost = atmCePremium + atmPePremium;
  const atmIv = atmCe?.iv || atmPe?.iv || 15.0;

  const dte = parseDaysToExpiry(chain.selectedExpiry);
  const expectedMove = estimateExpectedMove(spot, straddleCost, atmIv, dte);
  const expectedMovePct = Number(((expectedMove / spot) * 100).toFixed(2));

  const base: OptionsSignal = {
    signal: 'NO_TRADE',
    confidence: 0,
    reasons: [],
    strike: atmStrike,
    expiry: chain.selectedExpiry,
    expectedMove: Number(expectedMove.toFixed(2)),
    expectedMovePct,
    atmCePremium: Number(atmCePremium.toFixed(2)),
    atmPePremium: Number(atmPePremium.toFixed(2)),
    straddleCost: Number(straddleCost.toFixed(2)),
    timeToExpiryDays: dte,
    timestamp: new Date().toISOString(),
  };

  if (regime.regime === 'INSUFFICIENT_DATA') {
    base.reasons = ['Regime status is INSUFFICIENT_DATA. Insufficient historical data to validate strategy safety.'];
    return base;
  }

  // 1. BULLISH REGIME → Analyze LONG CALL
  if (regime.regime === 'BULLISH') {
    if (!atmCePremium || atmCePremium <= 0) {
      base.reasons = ['ATM CE quote not active.'];
      return base;
    }
    const breakeven = atmStrike + atmCePremium;
    const target = spot + expectedMove;
    const potentialProfit = target - breakeven;
    const rr = potentialProfit > 0 ? Number((potentialProfit / atmCePremium).toFixed(2)) : 0;

    base.optionType = 'CE';
    base.premium = atmCePremium;
    base.iv = atmIv;
    base.breakevenUp = Number(breakeven.toFixed(2));
    base.riskReward = rr;

    base.reasons.push(`Market Regime: BULLISH (Confidence ${regime.confidence}%)`);
    base.reasons.push(`ATM Strike: ${atmStrike} CE @ ₹${atmCePremium.toFixed(2)}`);
    base.reasons.push(`Upside Breakeven: ₹${breakeven.toFixed(2)}`);
    base.reasons.push(`Expected Move: ₹${expectedMove.toFixed(2)} (+${expectedMovePct}%)`);

    if (rr >= 0.4 && regime.confidence >= 25) {
      base.signal = 'LONG_CALL';
      base.confidence = Math.min(Math.round(regime.confidence * 0.85), 90);
      base.reasons.push(`Favorable asymmetric Risk/Reward (${rr}:1) justifies Long Call entry.`);
    } else {
      base.signal = 'NO_TRADE';
      base.reasons.push(`Option premium too elevated relative to expected move (R:R ${rr}:1 < 0.4:1).`);
    }
    return base;
  }

  // 2. BEARISH REGIME → Analyze LONG PUT
  if (regime.regime === 'BEARISH') {
    if (!atmPePremium || atmPePremium <= 0) {
      base.reasons = ['ATM PE quote not active.'];
      return base;
    }
    const breakeven = atmStrike - atmPePremium;
    const target = spot - expectedMove;
    const potentialProfit = breakeven - target;
    const rr = potentialProfit > 0 ? Number((potentialProfit / atmPePremium).toFixed(2)) : 0;

    base.optionType = 'PE';
    base.premium = atmPePremium;
    base.iv = atmIv;
    base.breakevenDown = Number(breakeven.toFixed(2));
    base.riskReward = rr;

    base.reasons.push(`Market Regime: BEARISH (Confidence ${regime.confidence}%)`);
    base.reasons.push(`ATM Strike: ${atmStrike} PE @ ₹${atmPePremium.toFixed(2)}`);
    base.reasons.push(`Downside Breakeven: ₹${breakeven.toFixed(2)}`);
    base.reasons.push(`Expected Move: ₹${expectedMove.toFixed(2)} (-${expectedMovePct}%)`);

    if (rr >= 0.4 && regime.confidence >= 25) {
      base.signal = 'LONG_PUT';
      base.confidence = Math.min(Math.round(regime.confidence * 0.85), 90);
      base.reasons.push(`Favorable asymmetric Risk/Reward (${rr}:1) justifies Long Put entry.`);
    } else {
      base.signal = 'NO_TRADE';
      base.reasons.push(`Put premium exceeds projected downward move (R:R ${rr}:1 < 0.4:1).`);
    }
    return base;
  }

  // 3. SIDEWAYS REGIME → Check Volatility Strategy Edge
  base.breakevenUp = Number((atmStrike + straddleCost).toFixed(2));
  base.breakevenDown = Number((atmStrike - straddleCost).toFixed(2));
  base.reasons.push(`Market Regime: SIDEWAYS (Confidence ${regime.confidence}%)`);
  base.reasons.push(`Straddle Breakevens: ₹${base.breakevenDown} – ₹${base.breakevenUp}`);

  if (regime.volatility === 'HIGH' && expectedMove > straddleCost * 1.2) {
    base.signal = 'VOLATILITY_STRATEGY';
    base.confidence = 65;
    base.reasons.push('High volatility expansion: Market expected move significantly outstrips combined straddle premium.');
  } else {
    base.signal = 'NO_TRADE';
    base.reasons.push('Range-bound sideways market with normal volatility. Avoid naked option buying due to theta decay.');
  }

  return base;
}
