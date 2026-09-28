import { OptionChainData, OptionLeg } from '@/types/options';
import { RegimeResult } from '@/types/regime';
import { ExpertPickCandidate } from '@/types/expert-picks';
import { getExpertPickSignal } from './signal-service';

export function getTopPicksByVolume(
  chain: OptionChainData,
  regime: RegimeResult,
  lotSize: number,
  availableCash: number
): ExpertPickCandidate[] {
  interface FlattenedOption {
    underlying: string;
    strike: number;
    optionType: 'CE' | 'PE';
    expiry: string;
    leg: OptionLeg;
  }

  const allContracts: FlattenedOption[] = [];

  for (const strikeRow of chain.strikes) {
    if (strikeRow.ce) {
      allContracts.push({
        underlying: chain.underlyingSymbol,
        strike: strikeRow.strikePrice,
        optionType: 'CE',
        expiry: chain.selectedExpiry,
        leg: strikeRow.ce,
      });
    }
    if (strikeRow.pe) {
      allContracts.push({
        underlying: chain.underlyingSymbol,
        strike: strikeRow.strikePrice,
        optionType: 'PE',
        expiry: chain.selectedExpiry,
        leg: strikeRow.pe,
      });
    }
  }

  // Expert Picks are entered as CE/PE pairs. Rank strikes by the combined
  // volume of both available legs, never by LTP or OI, then include both
  // contracts for each of the five highest-volume strikes.
  const strikeVolumes = new Map<number, number>();
  for (const option of allContracts) {
    strikeVolumes.set(option.strike, (strikeVolumes.get(option.strike) || 0) + (option.leg.volume || 0));
  }
  const topStrikes = Array.from(strikeVolumes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([strike]) => strike);
  const top5 = allContracts.filter((option) => topStrikes.includes(option.strike));
  top5.sort((a, b) => {
    const strikeRank = topStrikes.indexOf(a.strike) - topStrikes.indexOf(b.strike);
    return strikeRank || (a.optionType === 'CE' ? -1 : 1);
  });

  const pcr = chain.pcr?.oiPcr ?? chain.pcr?.volumePcr ?? 1.0;

  return top5.map((opt, index) => {
    const marketContext = {
      regime: regime.regime,
      pcr,
      spotPrice: chain.underlyingPrice,
      strikePrice: opt.strike,
      optionType: opt.optionType,
    };

    const { action, reasons } = getExpertPickSignal(opt.leg, marketContext);

    // Lot Calculation:
    // investment_per_lot = option_ltp × lot_size
    // recommended_lots = floor(available_virtual_cash / investment_per_lot)
    // required_investment = recommended_lots × option_ltp × lot_size
    // Never allow required_investment to exceed available virtual cash
    const ltp = opt.leg.ltp;
    const investmentPerLot = ltp * lotSize;
    let recommendedLots = 0;

    if (investmentPerLot > 0 && availableCash >= investmentPerLot) {
      recommendedLots = Math.floor(availableCash / investmentPerLot);
    }

    const requiredInvestment = Number((recommendedLots * investmentPerLot).toFixed(2));
    // Estimated total exposure in options: contract notional exposure = lots × lotSize × strikePrice
    const totalExposure = Number((recommendedLots * lotSize * opt.strike).toFixed(2));

    return {
      rank: topStrikes.indexOf(opt.strike) + 1,
      underlying: opt.underlying,
      strike: opt.strike,
      optionType: opt.optionType,
      expiry: opt.expiry,
      ltp,
      volume: opt.leg.volume || 0,
      oi: opt.leg.oi || 0,
      changeOi: opt.leg.changeOi || 0,
      iv: opt.leg.iv ?? null,
      action,
      recommendedLots,
      lotSize,
      requiredInvestment,
      totalExposure: totalExposure > 0 ? totalExposure : requiredInvestment,
      signalReasons: reasons,
    };
  });
}
