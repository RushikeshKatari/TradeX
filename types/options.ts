export interface OptionLeg {
  ltp: number;
  change: number;
  volume: number;
  oi: number;
  changeOi: number;
  iv?: number;
  bid?: number;
  ask?: number;
}

export interface OptionStrikeRow {
  strikePrice: number;
  ce: OptionLeg | null;
  pe: OptionLeg | null;
}

export interface OptionChainData {
  underlyingSymbol: string;
  underlyingPrice: number;
  timestamp: string;
  expiryDates: string[];
  selectedExpiry: string;
  strikes: OptionStrikeRow[];
  highestVolumeStrikeCE: {
    strike: number;
    volume: number;
  } | null;
  highestVolumeStrikePE: {
    strike: number;
    volume: number;
  } | null;
  pcr: {
    volumePcr: number;
    oiPcr: number;
  };
  dataSource: string;
  isDelayed: boolean;
}
