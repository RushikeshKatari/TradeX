import { OptionChainData } from '@/types/options';

export interface OptionAnalysisSummary {
  underlyingSymbol: string;
  underlyingPrice: number;
  selectedExpiry: string;
  volumeLeaderCE: { strike: number; volume: number } | null;
  volumeLeaderPE: { strike: number; volume: number } | null;
  volumePcr: number;
  oiPcr: number;
  volumeConcentration: 'LOW' | 'MEDIUM' | 'HIGH';
  oiConcentration: 'LOW' | 'MEDIUM' | 'HIGH';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  analyticalNotes: string[];
  disclaimer: string;
}

export function analyzeOptionChain(chain: OptionChainData): OptionAnalysisSummary {
  const disclaimer =
    'Option activity and volume metrics represent observed market concentrations. Volume leaders do NOT indicate trade recommendations, and option analytics do not guarantee future price movement.';

  const volumeLeaderCE = chain.highestVolumeStrikeCE;
  const volumeLeaderPE = chain.highestVolumeStrikePE;
  const volumePcr = chain.pcr.volumePcr;
  const oiPcr = chain.pcr.oiPcr;

  const notes: string[] = [];

  if (volumeLeaderCE) {
    notes.push(
      `Highest observed Call (CE) volume concentrated at ₹${volumeLeaderCE.strike.toLocaleString('en-IN')} strike (${volumeLeaderCE.volume.toLocaleString('en-IN')} contracts).`
    );
  }
  if (volumeLeaderPE) {
    notes.push(
      `Highest observed Put (PE) volume concentrated at ₹${volumeLeaderPE.strike.toLocaleString('en-IN')} strike (${volumeLeaderPE.volume.toLocaleString('en-IN')} contracts).`
    );
  }

  // Put-Call Ratio Interpretation
  let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (oiPcr > 1.3) {
    sentiment = 'BULLISH';
    notes.push(`OI PCR of ${oiPcr} reflects heavy put writing / support buildup.`);
  } else if (oiPcr < 0.7) {
    sentiment = 'BEARISH';
    notes.push(`OI PCR of ${oiPcr} reflects heavy call writing / resistance overhead.`);
  } else {
    sentiment = 'NEUTRAL';
    notes.push(`OI PCR of ${oiPcr} reflects balanced positioning across calls and puts.`);
  }

  const volumeConcentration = (volumeLeaderCE?.volume ?? 0) > 100000 ? 'HIGH' : 'MEDIUM';
  const oiConcentration = oiPcr > 1.4 || oiPcr < 0.6 ? 'HIGH' : 'MEDIUM';

  return {
    underlyingSymbol: chain.underlyingSymbol,
    underlyingPrice: chain.underlyingPrice,
    selectedExpiry: chain.selectedExpiry,
    volumeLeaderCE,
    volumeLeaderPE,
    volumePcr,
    oiPcr,
    volumeConcentration,
    oiConcentration,
    sentiment,
    analyticalNotes: notes,
    disclaimer,
  };
}
