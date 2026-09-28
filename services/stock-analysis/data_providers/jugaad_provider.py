"""
Fallback provider: jugaad-data NSELive.
Uses index_option_chain, live_index, and all_indices methods.
"""

import logging
import traceback
from datetime import datetime
from typing import Optional

from data_providers.base import (
    MarketDataProvider,
    OptionChainData,
    OptionChainRow,
    OptionData,
    IndexQuoteData,
    ProviderHealth,
    ProviderStatus,
)

logger = logging.getLogger(__name__)

# Map user-friendly names to NSE API expected index names
INDEX_NAME_MAP = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "NIFTY 50": "NIFTY 50",
    "NIFTY BANK": "NIFTY BANK",
    "FINNIFTY": "NIFTY FIN SERVICE",
}


class JugaadDataProvider(MarketDataProvider):
    """Fallback provider using jugaad-data NSELive."""

    def __init__(self):
        self._health = ProviderHealth(name="jugaad-data", status=ProviderStatus.ACTIVE)
        self._nse = None

    def _get_nse(self):
        """Lazy-init NSELive to avoid import cost if not needed."""
        if self._nse is None:
            from jugaad_data.nse import NSELive
            self._nse = NSELive()
        return self._nse

    def get_name(self) -> str:
        return "jugaad-data"

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
        logger.error(f"jugaad-data error: {error}")

    def get_index_quote(self, symbol: str) -> Optional[IndexQuoteData]:
        """Fetch live index quote using NSELive.live_index."""
        try:
            nse = self._get_nse()
            index_name = INDEX_NAME_MAP.get(symbol.upper(), symbol)

            data = nse.live_index(index_name)

            if not data or "data" not in data:
                self._record_failure(f"Empty response for live_index({index_name})")
                return None

            # First item in data list is usually the index itself
            index_row = data["data"][0] if data["data"] else None
            if not index_row:
                self._record_failure(f"No data rows for {index_name}")
                return None

            quote = IndexQuoteData(
                symbol=symbol.upper(),
                last_price=_safe_float(index_row.get("lastPrice", index_row.get("last"))),
                open_price=_safe_float(index_row.get("open")),
                high_price=_safe_float(index_row.get("dayHigh", index_row.get("high"))),
                low_price=_safe_float(index_row.get("dayLow", index_row.get("low"))),
                prev_close=_safe_float(index_row.get("previousClose")),
                change=_safe_float(index_row.get("change")),
                change_pct=_safe_float(index_row.get("pChange", index_row.get("percentChange"))),
                timestamp=index_row.get("lastUpdateTime", data.get("timestamp", datetime.now().isoformat())),
                provider=self.get_name(),
            )
            self._record_success()
            return quote

        except Exception as e:
            self._record_failure(f"get_index_quote({symbol}): {traceback.format_exc()}")
            return None

    def get_option_chain(self, symbol: str) -> Optional[OptionChainData]:
        """Fetch live option chain using NSELive.index_option_chain."""
        try:
            nse = self._get_nse()
            nse_symbol = symbol.upper()
            if nse_symbol == "BANKNIFTY":
                nse_symbol = "BANKNIFTY"
            elif nse_symbol in ("NIFTY", "NIFTY 50"):
                nse_symbol = "NIFTY"

            raw = nse.index_option_chain(nse_symbol)

            if not raw or not isinstance(raw, dict):
                self._record_failure(f"Empty option chain for {symbol}")
                return None

            records_section = raw.get("filtered", raw.get("records", {}))
            records = records_section.get("data", [])
            if not records:
                self._record_failure(f"No data in option chain for {symbol}")
                return None

            underlying_value = _safe_float(
                raw.get("records", {}).get("underlyingValue")
            )
            expiry_dates = raw.get("records", {}).get("expiryDates", [])

            strikes = []
            total_ce_oi = 0
            total_pe_oi = 0

            for row in records:
                strike_price = _safe_float(row.get("strikePrice"))
                expiry = row.get("expiryDate", "")
                ce_data = None
                pe_data = None

                if "CE" in row and row["CE"]:
                    ce_raw = row["CE"]
                    ce_oi = _safe_int(ce_raw.get("openInterest", 0))
                    total_ce_oi += ce_oi
                    ce_data = OptionData(
                        strike_price=strike_price,
                        expiry_date=expiry,
                        option_type="CE",
                        ltp=_safe_float(ce_raw.get("lastPrice")),
                        open_interest=ce_oi,
                        change_in_oi=_safe_int(ce_raw.get("changeinOpenInterest")),
                        volume=_safe_int(ce_raw.get("totalTradedVolume")),
                        iv=_safe_float(ce_raw.get("impliedVolatility")),
                        bid_price=_safe_float(ce_raw.get("bidprice")),
                        ask_price=_safe_float(ce_raw.get("askPrice")),
                        bid_qty=_safe_int(ce_raw.get("bidQty")),
                        ask_qty=_safe_int(ce_raw.get("askQty")),
                    )

                if "PE" in row and row["PE"]:
                    pe_raw = row["PE"]
                    pe_oi = _safe_int(pe_raw.get("openInterest", 0))
                    total_pe_oi += pe_oi
                    pe_data = OptionData(
                        strike_price=strike_price,
                        expiry_date=expiry,
                        option_type="PE",
                        ltp=_safe_float(pe_raw.get("lastPrice")),
                        open_interest=pe_oi,
                        change_in_oi=_safe_int(pe_raw.get("changeinOpenInterest")),
                        volume=_safe_int(pe_raw.get("totalTradedVolume")),
                        iv=_safe_float(pe_raw.get("impliedVolatility")),
                        bid_price=_safe_float(pe_raw.get("bidprice")),
                        ask_price=_safe_float(pe_raw.get("askPrice")),
                        bid_qty=_safe_int(pe_raw.get("bidQty")),
                        ask_qty=_safe_int(pe_raw.get("askQty")),
                    )

                strikes.append(OptionChainRow(
                    strike_price=strike_price,
                    expiry_date=expiry,
                    ce=ce_data,
                    pe=pe_data,
                ))

            # Compute ATM strike
            atm_strike = None
            if underlying_value and strikes:
                all_strikes = [s.strike_price for s in strikes if s.strike_price]
                if all_strikes:
                    atm_strike = min(all_strikes, key=lambda x: abs(x - underlying_value))

            # Compute straddle price
            straddle_price = None
            if atm_strike:
                for s in strikes:
                    if s.strike_price == atm_strike:
                        ce_ltp = s.ce.ltp if s.ce and s.ce.ltp else 0
                        pe_ltp = s.pe.ltp if s.pe and s.pe.ltp else 0
                        straddle_price = ce_ltp + pe_ltp
                        break

            # PCR
            pcr = round(total_pe_oi / total_ce_oi, 4) if total_ce_oi > 0 else None

            # Max Pain
            max_pain = _calculate_max_pain(strikes)

            timestamp = raw.get("records", {}).get("timestamp",
                datetime.now().isoformat())

            chain = OptionChainData(
                symbol=symbol.upper(),
                underlying_value=underlying_value,
                timestamp=timestamp,
                expiry_dates=expiry_dates[:5] if expiry_dates else [],
                strikes=strikes,
                straddle_price=straddle_price,
                atm_strike=atm_strike,
                pcr=pcr,
                max_pain=max_pain,
                total_ce_oi=total_ce_oi,
                total_pe_oi=total_pe_oi,
                provider=self.get_name(),
            )
            self._record_success()
            return chain

        except Exception as e:
            self._record_failure(f"get_option_chain({symbol}): {traceback.format_exc()}")
            return None

    def is_healthy(self) -> bool:
        return self._health.status == ProviderStatus.ACTIVE

    def get_health(self) -> ProviderHealth:
        return self._health

    def get_historical_candles(self, symbol: str, days: int = 90) -> Optional[dict]:
        """Fetch historical daily OHLC candles via jugaad-data index_df."""
        try:
            import jugaad_data.nse as jnse
            from datetime import date, timedelta

            index_name = INDEX_NAME_MAP.get(symbol.upper(), symbol)
            end_date = date.today()
            start_date = end_date - timedelta(days=days)

            df = jnse.index_df(symbol=index_name, from_date=start_date, to_date=end_date)
            if df is None or df.empty:
                return None

            # Sort ascending by date
            date_col = "HistoricalDate" if "HistoricalDate" in df.columns else df.columns[0]
            df = df.sort_values(date_col)

            return {
                "dates": [str(d) for d in df[date_col].tolist()],
                "closes": [float(x) for x in df["CLOSE"].tolist()],
                "highs": [float(x) for x in df["HIGH"].tolist()],
                "lows": [float(x) for x in df["LOW"].tolist()],
                "opens": [float(x) for x in df["OPEN"].tolist()],
            }
        except Exception as e:
            logger.error(f"Failed to fetch historical candles for {symbol}: {e}")
            return None


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(float(str(val).replace(",", "")))
    except (ValueError, TypeError):
        return None


def _calculate_max_pain(strikes) -> Optional[float]:
    """Calculate max pain strike."""
    if not strikes:
        return None

    strike_prices = sorted(set(s.strike_price for s in strikes if s.strike_price))
    if not strike_prices:
        return None

    min_pain = float("inf")
    max_pain_strike = None

    for target_strike in strike_prices:
        total_pain = 0
        for s in strikes:
            if not s.strike_price:
                continue
            if s.ce and s.ce.open_interest:
                ce_intrinsic = max(0, target_strike - s.strike_price)
                total_pain += ce_intrinsic * s.ce.open_interest
            if s.pe and s.pe.open_interest:
                pe_intrinsic = max(0, s.strike_price - target_strike)
                total_pain += pe_intrinsic * s.pe.open_interest

        if total_pain < min_pain:
            min_pain = total_pain
            max_pain_strike = target_strike

    return max_pain_strike
