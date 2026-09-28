"""
Abstract base class for market data providers.
Defines the common interface so providers are replaceable.
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class ProviderStatus(Enum):
    ACTIVE = "ACTIVE"
    FAILED = "FAILED"
    STALE = "STALE"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass
class ProviderHealth:
    name: str
    status: ProviderStatus
    last_success: Optional[datetime] = None
    last_error: Optional[str] = None
    error_count: int = 0
    consecutive_failures: int = 0


@dataclass
class OptionData:
    """Normalized option contract data."""
    strike_price: float
    expiry_date: str
    option_type: str  # "CE" or "PE"
    ltp: Optional[float] = None
    open_interest: Optional[int] = None
    change_in_oi: Optional[int] = None
    volume: Optional[int] = None
    iv: Optional[float] = None
    bid_price: Optional[float] = None
    ask_price: Optional[float] = None
    bid_qty: Optional[int] = None
    ask_qty: Optional[int] = None
    # Greeks - often not available from NSE public data
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None


@dataclass
class OptionChainRow:
    """A single strike in the option chain with both CE and PE."""
    strike_price: float
    expiry_date: str
    ce: Optional[OptionData] = None
    pe: Optional[OptionData] = None


@dataclass
class OptionChainData:
    """Complete option chain snapshot."""
    symbol: str
    underlying_value: Optional[float] = None
    timestamp: Optional[str] = None
    expiry_dates: list = field(default_factory=list)
    strikes: list = field(default_factory=list)  # List[OptionChainRow]
    straddle_price: Optional[float] = None
    atm_strike: Optional[float] = None
    pcr: Optional[float] = None
    max_pain: Optional[float] = None
    total_ce_oi: Optional[int] = None
    total_pe_oi: Optional[int] = None
    provider: str = "UNKNOWN"


@dataclass
class IndexQuoteData:
    """Normalized index quote."""
    symbol: str
    last_price: Optional[float] = None
    open_price: Optional[float] = None
    high_price: Optional[float] = None
    low_price: Optional[float] = None
    prev_close: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    timestamp: Optional[str] = None
    provider: str = "UNKNOWN"


class MarketDataProvider(ABC):
    """Abstract interface for market data providers.

    Any new provider (e.g., Groww API) should implement this interface.
    """

    @abstractmethod
    def get_name(self) -> str:
        """Return provider name."""
        pass

    @abstractmethod
    def get_index_quote(self, symbol: str) -> Optional[IndexQuoteData]:
        """Fetch live index quote (e.g., NIFTY 50, NIFTY BANK)."""
        pass

    @abstractmethod
    def get_option_chain(self, symbol: str) -> Optional[OptionChainData]:
        """Fetch live option chain for an index or stock."""
        pass

    @abstractmethod
    def is_healthy(self) -> bool:
        """Return True if provider is functional."""
        pass

    @abstractmethod
    def get_health(self) -> ProviderHealth:
        """Return detailed health status."""
        pass

    def get_historical_candles(self, symbol: str, days: int = 90) -> Optional[dict]:
        """Fetch historical daily OHLC candles if supported by provider."""
        return None
