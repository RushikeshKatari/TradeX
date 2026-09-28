"""
Technical indicators computed from available price/OI data.
Uses numpy/pandas for calculations. No invented data.
"""

import numpy as np
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field


@dataclass
class IndicatorResult:
    """Result of indicator calculations."""
    # Price-based
    ema_20: Optional[float] = None
    ema_50: Optional[float] = None
    rsi_14: Optional[float] = None
    adx_14: Optional[float] = None
    atr_14: Optional[float] = None
    bollinger_upper: Optional[float] = None
    bollinger_middle: Optional[float] = None
    bollinger_lower: Optional[float] = None
    bollinger_width: Optional[float] = None
    vwap: Optional[float] = None
    momentum_10: Optional[float] = None

    # OI-based
    pcr: Optional[float] = None
    total_ce_oi: Optional[int] = None
    total_pe_oi: Optional[int] = None

    # Derived
    ema_crossover: Optional[str] = None  # "BULLISH", "BEARISH", "NEUTRAL"
    price_vs_vwap: Optional[str] = None
    price_vs_bollinger: Optional[str] = None

    # Availability tracking
    available_indicators: list = field(default_factory=list)
    unavailable_indicators: list = field(default_factory=list)


def compute_ema(prices: List[float], period: int) -> Optional[float]:
    """Compute Exponential Moving Average."""
    if not prices or len(prices) < period:
        return None
    arr = np.array(prices, dtype=float)
    multiplier = 2.0 / (period + 1)
    ema = arr[0]
    for i in range(1, len(arr)):
        ema = (arr[i] - ema) * multiplier + ema
    return round(ema, 2)


def compute_rsi(prices: List[float], period: int = 14) -> Optional[float]:
    """Compute Relative Strength Index."""
    if not prices or len(prices) < period + 1:
        return None
    arr = np.array(prices, dtype=float)
    deltas = np.diff(arr)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)

    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def compute_atr(highs: List[float], lows: List[float], closes: List[float],
                period: int = 14) -> Optional[float]:
    """Compute Average True Range."""
    if not highs or len(highs) < period + 1:
        return None
    n = len(highs)
    tr_list = []
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr_list.append(max(hl, hc, lc))

    if len(tr_list) < period:
        return None

    atr = np.mean(tr_list[:period])
    for i in range(period, len(tr_list)):
        atr = (atr * (period - 1) + tr_list[i]) / period
    return round(atr, 2)


def compute_adx(highs: List[float], lows: List[float], closes: List[float],
                period: int = 14) -> Optional[float]:
    """Compute Average Directional Index."""
    if not highs or len(highs) < period * 2:
        return None

    n = len(highs)
    plus_dm = []
    minus_dm = []
    tr_list = []

    for i in range(1, n):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0)

        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr_list.append(max(hl, hc, lc))

    if len(tr_list) < period:
        return None

    smoothed_tr = sum(tr_list[:period])
    smoothed_plus = sum(plus_dm[:period])
    smoothed_minus = sum(minus_dm[:period])

    dx_list = []
    for i in range(period, len(tr_list)):
        smoothed_tr = smoothed_tr - smoothed_tr / period + tr_list[i]
        smoothed_plus = smoothed_plus - smoothed_plus / period + plus_dm[i]
        smoothed_minus = smoothed_minus - smoothed_minus / period + minus_dm[i]

        if smoothed_tr == 0:
            continue
        plus_di = 100 * smoothed_plus / smoothed_tr
        minus_di = 100 * smoothed_minus / smoothed_tr

        di_sum = plus_di + minus_di
        if di_sum == 0:
            dx_list.append(0)
        else:
            dx_list.append(100 * abs(plus_di - minus_di) / di_sum)

    if not dx_list:
        return None

    adx = np.mean(dx_list[:period]) if len(dx_list) >= period else np.mean(dx_list)
    return round(adx, 2)


def compute_bollinger_bands(prices: List[float], period: int = 20,
                            num_std: float = 2.0):
    """Compute Bollinger Bands. Returns (upper, middle, lower, width)."""
    if not prices or len(prices) < period:
        return None, None, None, None

    recent = prices[-period:]
    middle = np.mean(recent)
    std = np.std(recent, ddof=1)
    upper = middle + num_std * std
    lower = middle - num_std * std
    width = (upper - lower) / middle * 100 if middle != 0 else 0

    return round(upper, 2), round(middle, 2), round(lower, 2), round(width, 4)


def compute_momentum(prices: List[float], period: int = 10) -> Optional[float]:
    """Compute momentum (price change over N periods)."""
    if not prices or len(prices) < period + 1:
        return None
    return round(prices[-1] - prices[-period - 1], 2)


def compute_vwap(prices: List[float], volumes: List[float]) -> Optional[float]:
    """Compute VWAP if volume data is available."""
    if not prices or not volumes or len(prices) != len(volumes):
        return None
    total_vol = sum(volumes)
    if total_vol == 0:
        return None
    vwap = sum(p * v for p, v in zip(prices, volumes)) / total_vol
    return round(vwap, 2)


def calculate_indicators(
    prices: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    volumes: Optional[List[float]] = None,
    pcr: Optional[float] = None,
    total_ce_oi: Optional[int] = None,
    total_pe_oi: Optional[int] = None,
) -> IndicatorResult:
    """Calculate all available indicators from provided data.

    Does NOT invent data; marks indicators as unavailable if input is missing.
    """
    result = IndicatorResult()
    closes = prices if prices else []

    # EMA 20 & 50
    if len(closes) >= 20:
        result.ema_20 = compute_ema(closes, 20)
        result.available_indicators.append("EMA_20")
    else:
        result.unavailable_indicators.append("EMA_20")

    if len(closes) >= 50:
        result.ema_50 = compute_ema(closes, 50)
        result.available_indicators.append("EMA_50")
    else:
        result.unavailable_indicators.append("EMA_50")

    # EMA crossover
    if result.ema_20 is not None and result.ema_50 is not None:
        if result.ema_20 > result.ema_50:
            result.ema_crossover = "BULLISH"
        elif result.ema_20 < result.ema_50:
            result.ema_crossover = "BEARISH"
        else:
            result.ema_crossover = "NEUTRAL"

    # RSI
    if len(closes) >= 15:
        result.rsi_14 = compute_rsi(closes, 14)
        result.available_indicators.append("RSI_14")
    else:
        result.unavailable_indicators.append("RSI_14")

    # ATR and ADX need OHLC
    if highs and lows and len(highs) >= 15:
        result.atr_14 = compute_atr(highs, lows, closes, 14)
        if result.atr_14 is not None:
            result.available_indicators.append("ATR_14")

        result.adx_14 = compute_adx(highs, lows, closes, 14)
        if result.adx_14 is not None:
            result.available_indicators.append("ADX_14")
    else:
        result.unavailable_indicators.extend(["ATR_14", "ADX_14"])

    # Bollinger Bands
    if len(closes) >= 20:
        bb = compute_bollinger_bands(closes, 20)
        result.bollinger_upper, result.bollinger_middle, result.bollinger_lower, result.bollinger_width = bb
        if result.bollinger_upper is not None:
            result.available_indicators.append("BOLLINGER_BANDS")

            # Price vs Bollinger
            current_price = closes[-1]
            if current_price >= result.bollinger_upper:
                result.price_vs_bollinger = "ABOVE_UPPER"
            elif current_price <= result.bollinger_lower:
                result.price_vs_bollinger = "BELOW_LOWER"
            else:
                result.price_vs_bollinger = "WITHIN_BANDS"
    else:
        result.unavailable_indicators.append("BOLLINGER_BANDS")

    # VWAP
    if volumes and len(volumes) == len(closes) and len(closes) > 0:
        result.vwap = compute_vwap(closes, volumes)
        if result.vwap is not None:
            result.available_indicators.append("VWAP")
            current_price = closes[-1]
            result.price_vs_vwap = "ABOVE" if current_price > result.vwap else "BELOW"
    else:
        result.unavailable_indicators.append("VWAP")

    # Momentum
    if len(closes) >= 11:
        result.momentum_10 = compute_momentum(closes, 10)
        result.available_indicators.append("MOMENTUM_10")
    else:
        result.unavailable_indicators.append("MOMENTUM_10")

    # OI-based
    if pcr is not None:
        result.pcr = pcr
        result.available_indicators.append("PCR")
    else:
        result.unavailable_indicators.append("PCR")

    result.total_ce_oi = total_ce_oi
    result.total_pe_oi = total_pe_oi

    return result
