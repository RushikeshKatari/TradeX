import { ExpertPickAction } from '@/types/expert-picks';
import { MarketRegimeType } from '@/types/regime';
import { OptionLeg } from '@/types/options';

export interface MarketContext {
  regime: MarketRegimeType;
  pcr: number;
  spotPrice: number;
  strikePrice: number;
  optionType: 'CE' | 'PE';
}

/**
 * Isolated Expert Pick Signal Strategy:
 * Evaluates option leg parameters and prevailing market context (regime, PCR, spot price)
 * to produce an actionable paper-trading signal: BUY, SELL, or NO_TRADE.
 */
export function getExpertPickSignal(
  option: OptionLeg,
  marketContext: MarketContext
): { action: ExpertPickAction; reasons: string[] } {
  const reasons: string[] = [];
  const isCE = marketContext.optionType === 'CE';

  // 1. Bullish Market Regime
  if (marketContext.regime === 'BULLISH') {
    if (isCE) {
      reasons.push('Bullish market regime favors upside momentum in Call Options (CE).');
      return { action: 'BUY', reasons };
    } else {
      reasons.push('Bullish market regime: High Put volume reflects institutional Put writing / support buildup.');
      return { action: 'SELL', reasons };
    }
  }

  // 2. Bearish Market Regime
  if (marketContext.regime === 'BEARISH') {
    if (!isCE) {
      reasons.push('Bearish market regime favors downside momentum in Put Options (PE).');
      return { action: 'BUY', reasons };
    } else {
      reasons.push('Bearish market regime: High Call volume reflects institutional Call writing / overhead resistance.');
      return { action: 'SELL', reasons };
    }
  }

  // 3. Sideways Market Regime
  if (marketContext.regime === 'SIDEWAYS') {
    if (marketContext.pcr > 1.25) {
      if (isCE) {
        reasons.push(`Elevated PCR (${marketContext.pcr.toFixed(2)}) indicates bullish contrarian setup for Calls.`);
        return { action: 'BUY', reasons };
      } else {
        reasons.push(`Elevated PCR (${marketContext.pcr.toFixed(2)}) indicates heavy Put writing.`);
        return { action: 'SELL', reasons };
      }
    } else if (marketContext.pcr < 0.75) {
      if (!isCE) {
        reasons.push(`Depressed PCR (${marketContext.pcr.toFixed(2)}) indicates bearish contrarian setup for Puts.`);
        return { action: 'BUY', reasons };
      } else {
        reasons.push(`Depressed PCR (${marketContext.pcr.toFixed(2)}) indicates heavy Call writing.`);
        return { action: 'SELL', reasons };
      }
    }

    reasons.push('Range-bound sideways market with neutral PCR. High risk of premium decay.');
    return { action: 'NO_TRADE', reasons };
  }

  // 4. Default / Insufficient Data
  reasons.push('Insufficient market history or unconfirmed regime.');
  return { action: 'NO_TRADE', reasons };
}
