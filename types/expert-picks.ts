export type ExpertPickAction = 'BUY' | 'SELL' | 'NO_TRADE';

export interface ExpertPickCandidate {
  rank: number;
  underlying: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  ltp: number;
  volume: number;
  oi: number;
  changeOi: number;
  iv: number | null;
  action: ExpertPickAction;
  recommendedLots: number;
  lotSize: number;
  requiredInvestment: number;
  totalExposure: number;
  signalReasons: string[];
}

export interface ExpertPickPosition {
  id: string;
  underlying: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  side: 'BUY' | 'SELL';
  lots: number;
  lotSize: number;
  quantity: number;
  entryPrice: number;
  currentLtp: number;
  investment: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  status: 'OPEN' | 'CLOSED';
  exitReason?: string;
  enteredAt: string;
  exitedAt?: string;
}

export interface ExpertPicksSummary {
  totalInvestment: number;
  currentPnl: number;
  openPositions: number;
  availableCash: number;
}

export interface ExpertPicksResponse {
  picks: ExpertPickCandidate[];
  positions: ExpertPickPosition[];
  summary: ExpertPicksSummary;
  underlying: string;
  expiry: string;
  lastUpdated: string;
  isStale: boolean;
}
