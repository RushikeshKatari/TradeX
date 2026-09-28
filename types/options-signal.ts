export type OptionsTradeSignalType = 'LONG_CALL' | 'LONG_PUT' | 'VOLATILITY_STRATEGY' | 'NO_TRADE';

export interface OptionsSignal {
  signal: OptionsTradeSignalType;
  confidence: number;
  reasons: string[];
  strike?: number;
  optionType?: 'CE' | 'PE';
  expiry?: string;
  premium?: number;
  iv?: number;
  expectedMove?: number;
  expectedMovePct?: number;
  atmCePremium?: number;
  atmPePremium?: number;
  straddleCost?: number;
  timeToExpiryDays?: number;
  breakevenUp?: number;
  breakevenDown?: number;
  riskReward?: number;
  timestamp?: string;
}
