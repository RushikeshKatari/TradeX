"""
Provider Manager: failover logic between option-chain-live (primary) and jugaad-data (fallback).
Ensures we never mix snapshots from different providers in one calculation.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from data_providers.base import (
    MarketDataProvider,
    OptionChainData,
    IndexQuoteData,
    ProviderHealth,
    ProviderStatus,
)
from data_providers.option_chain_live_provider import OptionChainLiveProvider
from data_providers.jugaad_provider import JugaadDataProvider

logger = logging.getLogger(__name__)

# Data staleness threshold
STALE_SECONDS = 120  # 2 minutes


class ProviderManager:
    """Manages provider failover and data caching.

    Priority:
        1. option-chain-live (primary)
        2. jugaad-data (fallback)
        3. DATA_UNAVAILABLE
    """

    def __init__(self):
        self._providers: List[MarketDataProvider] = [
            OptionChainLiveProvider(),
            JugaadDataProvider(),
        ]
        self._active_provider: Optional[MarketDataProvider] = None
        self._cache: Dict[str, Any] = {}
        self._cache_timestamps: Dict[str, datetime] = {}
        self._cache_ttl = timedelta(seconds=15)

    @property
    def active_provider_name(self) -> str:
        if self._active_provider:
            return self._active_provider.get_name()
        return "NONE"

    def get_all_health(self) -> List[Dict]:
        """Return health status for all providers."""
        results = []
        for p in self._providers:
            h = p.get_health()
            results.append({
                "name": h.name,
                "status": h.status.value,
                "last_success": h.last_success.isoformat() if h.last_success else None,
                "last_error": h.last_error,
                "error_count": h.error_count,
                "consecutive_failures": h.consecutive_failures,
                "is_active": p == self._active_provider,
            })
        return results

    def _is_cache_valid(self, key: str) -> bool:
        if key not in self._cache or key not in self._cache_timestamps:
            return False
        return datetime.now() - self._cache_timestamps[key] < self._cache_ttl

    def _set_cache(self, key: str, data: Any):
        self._cache[key] = data
        self._cache_timestamps[key] = datetime.now()

    def get_index_quote(self, symbol: str) -> Optional[IndexQuoteData]:
        """Fetch index quote with failover."""
        cache_key = f"index_quote_{symbol.upper()}"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        for provider in self._providers:
            try:
                result = provider.get_index_quote(symbol)
                if result and result.last_price:
                    self._active_provider = provider
                    self._set_cache(cache_key, result)
                    logger.info(f"Index quote for {symbol} from {provider.get_name()}")
                    return result
                else:
                    logger.warning(
                        f"{provider.get_name()} returned empty for {symbol}, trying fallback"
                    )
            except Exception as e:
                logger.error(f"{provider.get_name()} failed for {symbol}: {e}")
                continue

        logger.error(f"All providers failed for index quote: {symbol}")
        return None

    def get_option_chain(self, symbol: str) -> Optional[OptionChainData]:
        """Fetch option chain with failover."""
        cache_key = f"option_chain_{symbol.upper()}"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        for provider in self._providers:
            try:
                result = provider.get_option_chain(symbol)
                if result and result.strikes:
                    self._active_provider = provider
                    self._set_cache(cache_key, result)
                    logger.info(
                        f"Option chain for {symbol} from {provider.get_name()} "
                        f"({len(result.strikes)} strikes)"
                    )
                    return result
                else:
                    logger.warning(
                        f"{provider.get_name()} returned empty option chain for {symbol}"
                    )
            except Exception as e:
                logger.error(f"{provider.get_name()} failed for option chain {symbol}: {e}")
                continue

        logger.error(f"All providers failed for option chain: {symbol}")
        return None

    def get_historical_candles(self, symbol: str, days: int = 90) -> Optional[dict]:
        """Fetch historical daily candles with failover and longer cache (1 hour)."""
        cache_key = f"historical_candles_{symbol.upper()}"
        if cache_key in self._cache and cache_key in self._cache_timestamps:
            # 1 hour cache for historical daily candles
            if datetime.now() - self._cache_timestamps[cache_key] < timedelta(hours=1):
                return self._cache[cache_key]

        for provider in self._providers:
            try:
                res = provider.get_historical_candles(symbol, days=days)
                if res and res.get("closes"):
                    self._cache[cache_key] = res
                    self._cache_timestamps[cache_key] = datetime.now()
                    logger.info(f"Historical candles for {symbol} loaded from {provider.get_name()} ({len(res['closes'])} bars)")
                    return res
            except Exception as e:
                logger.error(f"{provider.get_name()} failed for historical candles {symbol}: {e}")
                continue
        return None

    def invalidate_cache(self, symbol: Optional[str] = None):
        """Clear cache for a symbol or all."""
        if symbol:
            keys_to_remove = [k for k in self._cache if symbol.upper() in k]
            for k in keys_to_remove:
                self._cache.pop(k, None)
                self._cache_timestamps.pop(k, None)
        else:
            self._cache.clear()
            self._cache_timestamps.clear()
