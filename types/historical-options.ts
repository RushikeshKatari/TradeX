export interface HistoricalOptionObservation {
  timestamp: string;
  underlying: string;
  underlyingPrice: number;
  expiry: string;
  strike: number;
  optionType: 'CE' | 'PE';
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  ltp: number;
  volume?: number;
  oi?: number;
  changeOi?: number;
  iv?: number;
  bid?: number;
  ask?: number;
}
