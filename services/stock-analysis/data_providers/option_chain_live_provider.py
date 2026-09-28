"""Primary provider backed by the option-chain-live package."""

import logging
import traceback
from datetime import datetime
from typing import Optional

from data_providers.base import (
    IndexQuoteData, MarketDataProvider, OptionChainData, OptionChainRow,
    OptionData, ProviderHealth, ProviderStatus,
)

logger = logging.getLogger(__name__)


class OptionChainLiveProvider(MarketDataProvider):
    """Use the keyless NiftyTrader client from option-chain-live."""

    def __init__(self):
        self._health = ProviderHealth(name="option-chain-live", status=ProviderStatus.ACTIVE)
        self._client = None

    def get_name(self) -> str:
        return "option-chain-live"

    def _get_client(self):
        if self._client is None:
            from option_chain_live import NiftyTraderClient
            self._client = NiftyTraderClient()
        return self._client

    def _record_success(self):
        self._health.status = ProviderStatus.ACTIVE
        self._health.last_success = datetime.now()
        self._health.consecutive_failures = 0

    def _record_failure(self, error: str):
        self._health.error_count += 1
        self._health.consecutive_failures += 1
        self._health.last_error = error
        if self._health.consecutive_failures >= 3:
            self._health.status = ProviderStatus.FAILED
        logger.error("option-chain-live error: %s", error)

    def get_option_chain(self, symbol: str) -> Optional[OptionChainData]:
        try:
            chain = self._get_client().get_chain(symbol.upper())
            if not chain or not chain.rows:
                self._record_failure(f"Empty option chain for {symbol}")
                return None

            strikes = []
            total_ce_oi = total_pe_oi = 0
            for row in chain.rows:
                ce = self._option(row.calls, row.expiry)
                pe = self._option(row.puts, row.expiry)
                total_ce_oi += int(ce.open_interest or 0)
                total_pe_oi += int(pe.open_interest or 0)
                strikes.append(OptionChainRow(row.strike, row.expiry, ce, pe))

            spot = float(chain.spot or 0)
            atm = min((r.strike_price for r in strikes), key=lambda x: abs(x - spot)) if strikes else None
            atm_row = next((r for r in strikes if r.strike_price == atm), None)
            straddle = ((atm_row.ce.ltp or 0) + (atm_row.pe.ltp or 0)) if atm_row and atm_row.ce and atm_row.pe else None
            self._record_success()
            return OptionChainData(
                symbol=symbol.upper(), underlying_value=spot,
                timestamp=datetime.now().isoformat(), expiry_dates=[chain.expiry],
                strikes=strikes, straddle_price=straddle, atm_strike=atm,
                pcr=(total_pe_oi / total_ce_oi) if total_ce_oi else None,
                total_ce_oi=total_ce_oi, total_pe_oi=total_pe_oi,
                provider=self.get_name(),
            )
        except Exception:
            self._record_failure(f"get_option_chain({symbol}): {traceback.format_exc()}")
            return None

    @staticmethod
    def _option(side, expiry: str) -> OptionData:
        return OptionData(
            strike_price=float(side.strike), expiry_date=expiry, option_type=side.option_type,
            ltp=side.ltp, open_interest=int(side.oi or 0), change_in_oi=int(side.change_oi or 0),
            volume=int(side.volume or 0), iv=side.iv, bid_price=side.bid_price, ask_price=side.ask_price,
            delta=side.delta, gamma=side.gamma, theta=side.theta, vega=side.vega,
        )

    def get_index_quote(self, symbol: str) -> Optional[IndexQuoteData]:
        try:
            summaries = self._get_client().get_dashboard(symbol.upper())
            summary = next((s for s in summaries if s.symbol.upper() == symbol.upper()), summaries[0] if summaries else None)
            if not summary:
                return None
            self._record_success()
            return IndexQuoteData(symbol=symbol.upper(), last_price=summary.spot,
                                  change=summary.change, change_pct=summary.change_percent,
                                  timestamp=datetime.now().isoformat(), provider=self.get_name())
        except Exception:
            self._record_failure(f"get_index_quote({symbol}): {traceback.format_exc()}")
            return None

    def is_healthy(self) -> bool:
        return self._health.status in (ProviderStatus.ACTIVE, ProviderStatus.STALE)

    def get_health(self) -> ProviderHealth:
        return self._health
