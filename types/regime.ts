export type MarketRegimeType = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'INSUFFICIENT_DATA';
export type TrendStrengthType = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
export type VolatilityLevelType = 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

export interface RegimeResult {
  regime: MarketRegimeType;
  confidence: number;
  trendStrength: TrendStrengthType;
  volatility: VolatilityLevelType;
  supportingFactors: string[];
  opposingFactors: string[];
  scores: Record<string, number>;
  pcr?: number;
  atmStrike?: number;
  maxPain?: number;
  timestamp?: string;
}
