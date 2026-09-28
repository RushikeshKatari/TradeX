"""
Options Analysis and Signal Engine.

For bullish → analyze LONG_CALL
For bearish → analyze LONG_PUT
For sideways → evaluate VOLATILITY_STRATEGY only if edge exists, else NO_TRADE

Never recommends buy CE + PE automatically for sideways.
"""

import logging
import math
from typing import Optional, Dict, List
from dataclasses import dataclass, field
from datetime import datetime

from data_providers.base import OptionChainData, OptionChainRow
from regime_detection import RegimeResult

logger = logging.getLogger(__name__)


@dataclass
class OptionsSignal:
    signal: str  # LONG_CALL, LONG_PUT, VOLATILITY_STRATEGY, NO_TRADE
    confidence: float
    reasons: List[str] = field(default_factory=list)

    # Option details for the recommended trade
    strike: Optional[float] = None
    option_type: Optional[str] = None  # CE or PE
    expiry: Optional[str] = None
    premium: Optional[float] = None
    iv: Optional[float] = None

    # Analysis values
    expected_move: Optional[float] = None
    expected_move_pct: Optional[float] = None
    atm_ce_premium: Optional[float] = None
    atm_pe_premium: Optional[float] = None
    straddle_cost: Optional[float] = None
    time_to_expiry_days: Optional[int] = None
    breakeven_up: Optional[float] = None
    breakeven_down: Optional[float] = None
    risk_reward: Optional[float] = None


def _estimate_time_to_expiry(expiry_str: str) -> Optional[int]:
    """Parse expiry date and compute days to expiry."""
    if not expiry_str:
        return None
    formats = ["%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d %b %Y", "%d/%m/%Y"]
    for fmt in formats:
        try:
            expiry_date = datetime.strptime(expiry_str, fmt)
            days = (expiry_date - datetime.now()).days
            return max(days, 0)
        except ValueError:
            continue
    return None


def _estimate_expected_move(
    spot: float,
    straddle_price: float,
    iv: Optional[float],
    days_to_expiry: Optional[int],
) -> float:
    """Estimate expected move from straddle price or IV."""
    if straddle_price and straddle_price > 0:
        # Straddle price is the market's expected move
        return straddle_price

    if iv and days_to_expiry and days_to_expiry > 0:
        # IV-based: Expected move ≈ Spot × IV × sqrt(DTE/365)
        return spot * (iv / 100) * math.sqrt(days_to_expiry / 365)

    # Fallback: rough estimate
    return spot * 0.015  # 1.5% as default


def analyze_options(
    regime: RegimeResult,
    chain: Optional[OptionChainData],
    spot_price: Optional[float] = None,
) -> OptionsSignal:
    """Generate options trading signal based on regime and option chain data.

    Rules:
    - BULLISH → analyze LONG_CALL
    - BEARISH → analyze LONG_PUT
    - SIDEWAYS → check if volatility strategy has edge, else NO_TRADE
    """
    if not chain or not chain.strikes or not chain.atm_strike:
        return OptionsSignal(
            signal="NO_TRADE",
            confidence=0,
            reasons=["Option chain data unavailable"],
        )

    spot = spot_price or chain.underlying_value
    if not spot:
        return OptionsSignal(
            signal="NO_TRADE",
            confidence=0,
            reasons=["Spot price unavailable"],
        )

    atm_strike = chain.atm_strike
    straddle_cost = chain.straddle_price or 0

    # Find ATM CE and PE
    atm_ce = None
    atm_pe = None
    for s in chain.strikes:
        if s.strike_price == atm_strike:
            atm_ce = s.ce
            atm_pe = s.pe
            break

    atm_ce_premium = atm_ce.ltp if atm_ce and atm_ce.ltp else 0
    atm_pe_premium = atm_pe.ltp if atm_pe and atm_pe.ltp else 0
    atm_iv = None
    if atm_ce and atm_ce.iv:
        atm_iv = atm_ce.iv
    elif atm_pe and atm_pe.iv:
        atm_iv = atm_pe.iv

    # Time to expiry from the first expiry date
    dte = None
    if chain.expiry_dates:
        dte = _estimate_time_to_expiry(chain.expiry_dates[0])

    expected_move = _estimate_expected_move(spot, straddle_cost, atm_iv, dte)
    expected_move_pct = (expected_move / spot * 100) if spot else 0

    base_signal = OptionsSignal(
        signal="NO_TRADE",
        confidence=0,
        expected_move=round(expected_move, 2),
        expected_move_pct=round(expected_move_pct, 2),
        atm_ce_premium=round(atm_ce_premium, 2),
        atm_pe_premium=round(atm_pe_premium, 2),
        straddle_cost=round(straddle_cost, 2),
        time_to_expiry_days=dte,
    )

    # === INSUFFICIENT_DATA → Return NO_TRADE ===
    if regime.regime == "INSUFFICIENT_DATA":
        base_signal.signal = "NO_TRADE"
        base_signal.confidence = 0
        base_signal.reasons = ["Regime is INSUFFICIENT_DATA: Technical indicators not yet populated with historical candles"]
        return base_signal

    # === BULLISH REGIME → Analyze LONG_CALL ===
    if regime.regime == "BULLISH":
        return _analyze_long_call(base_signal, regime, chain, spot, atm_strike,
                                  atm_ce, atm_iv, expected_move, dte)

    # === BEARISH REGIME → Analyze LONG_PUT ===
    elif regime.regime == "BEARISH":
        return _analyze_long_put(base_signal, regime, chain, spot, atm_strike,
                                 atm_pe, atm_iv, expected_move, dte)

    # === SIDEWAYS REGIME → Check volatility edge ===
    else:
        return _analyze_sideways(base_signal, regime, chain, spot, atm_strike,
                                 straddle_cost, atm_iv, expected_move, dte)


def _analyze_long_call(signal, regime, chain, spot, atm_strike, atm_ce,
                       atm_iv, expected_move, dte):
    """Analyze potential LONG_CALL for bullish regime."""
    reasons = []

    if not atm_ce or not atm_ce.ltp:
        signal.reasons = ["ATM CE data unavailable"]
        return signal

    premium = atm_ce.ltp
    breakeven = atm_strike + premium

    # Check if expected move justifies the premium
    expected_target = spot + expected_move
    potential_profit = expected_target - breakeven

    reasons.append(f"Regime: BULLISH (confidence {regime.confidence}%)")
    reasons.append(f"ATM Strike: {atm_strike}, CE Premium: ₹{premium:.2f}")
    reasons.append(f"Breakeven: ₹{breakeven:.2f}")
    reasons.append(f"Expected move: ₹{expected_move:.2f} ({signal.expected_move_pct:.1f}%)")

    if potential_profit > 0:
        risk_reward = potential_profit / premium if premium > 0 else 0
        reasons.append(f"Risk/Reward: {risk_reward:.2f}")
        signal.risk_reward = round(risk_reward, 2)

        if risk_reward >= 0.5 and regime.confidence >= 30:
            signal.signal = "LONG_CALL"
            signal.confidence = min(regime.confidence * 0.8, 85)
            signal.strike = atm_strike
            signal.option_type = "CE"
            signal.expiry = chain.expiry_dates[0] if chain.expiry_dates else None
            signal.premium = premium
            signal.iv = atm_ce.iv
            signal.breakeven_up = breakeven
            reasons.append("✓ Edge exists: Expected move covers premium cost")
        else:
            signal.signal = "NO_TRADE"
            signal.confidence = 20
            reasons.append("✗ Insufficient edge: R/R too low or low confidence")
    else:
        signal.signal = "NO_TRADE"
        signal.confidence = 10
        reasons.append("✗ Expected move doesn't cover premium cost")

    signal.reasons = reasons
    return signal


def _analyze_long_put(signal, regime, chain, spot, atm_strike, atm_pe,
                      atm_iv, expected_move, dte):
    """Analyze potential LONG_PUT for bearish regime."""
    reasons = []

    if not atm_pe or not atm_pe.ltp:
        signal.reasons = ["ATM PE data unavailable"]
        return signal

    premium = atm_pe.ltp
    breakeven = atm_strike - premium

    expected_target = spot - expected_move
    potential_profit = breakeven - expected_target

    reasons.append(f"Regime: BEARISH (confidence {regime.confidence}%)")
    reasons.append(f"ATM Strike: {atm_strike}, PE Premium: ₹{premium:.2f}")
    reasons.append(f"Breakeven: ₹{breakeven:.2f}")
    reasons.append(f"Expected move: ₹{expected_move:.2f} ({signal.expected_move_pct:.1f}%)")

    if potential_profit > 0:
        risk_reward = potential_profit / premium if premium > 0 else 0
        reasons.append(f"Risk/Reward: {risk_reward:.2f}")
        signal.risk_reward = round(risk_reward, 2)

        if risk_reward >= 0.5 and regime.confidence >= 30:
            signal.signal = "LONG_PUT"
            signal.confidence = min(regime.confidence * 0.8, 85)
            signal.strike = atm_strike
            signal.option_type = "PE"
            signal.expiry = chain.expiry_dates[0] if chain.expiry_dates else None
            signal.premium = premium
            signal.iv = atm_pe.iv
            signal.breakeven_down = breakeven
            reasons.append("✓ Edge exists: Expected move covers premium cost")
        else:
            signal.signal = "NO_TRADE"
            signal.confidence = 20
            reasons.append("✗ Insufficient edge: R/R too low or low confidence")
    else:
        signal.signal = "NO_TRADE"
        signal.confidence = 10
        reasons.append("✗ Expected move doesn't cover premium cost")

    signal.reasons = reasons
    return signal


def _analyze_sideways(signal, regime, chain, spot, atm_strike,
                      straddle_cost, atm_iv, expected_move, dte):
    """Analyze sideways regime. DO NOT auto-buy CE+PE.

    Only recommend VOLATILITY_STRATEGY if there's clear edge:
    - IV is low relative to realized volatility
    - Expected expansion is greater than straddle cost
    """
    reasons = []
    reasons.append(f"Regime: SIDEWAYS (confidence {regime.confidence}%)")
    reasons.append(f"ATM Straddle cost: ₹{straddle_cost:.2f}")
    reasons.append(f"Expected move: ₹{expected_move:.2f} ({signal.expected_move_pct:.1f}%)")

    if atm_iv:
        reasons.append(f"ATM IV: {atm_iv:.1f}%")

    # For sideways, straddle is only justified if expected move > straddle cost
    # AND IV is relatively low (suggesting potential for IV expansion)
    if straddle_cost > 0:
        edge_ratio = expected_move / straddle_cost
        reasons.append(f"Edge ratio (expected_move/straddle): {edge_ratio:.2f}")

        has_iv_edge = atm_iv is not None and atm_iv < 15  # Low IV
        has_move_edge = edge_ratio > 1.3  # Expected move 30% above straddle cost

        if has_iv_edge and has_move_edge:
            signal.signal = "VOLATILITY_STRATEGY"
            signal.confidence = min(30, regime.confidence * 0.5)
            signal.strike = atm_strike
            signal.premium = straddle_cost
            signal.iv = atm_iv
            signal.expiry = chain.expiry_dates[0] if chain.expiry_dates else None
            reasons.append("✓ Potential vol strategy: Low IV + sufficient expected move")
            reasons.append("⚠ Use with caution — sideways regime means uncertain direction")
        else:
            signal.signal = "NO_TRADE"
            signal.confidence = 0
            if not has_iv_edge:
                reasons.append(f"✗ IV ({atm_iv}%) not low enough to justify vol purchase")
            if not has_move_edge:
                reasons.append("✗ Expected move doesn't justify straddle cost")
            reasons.append("No clear edge for any trade in sideways regime")
    else:
        signal.signal = "NO_TRADE"
        signal.confidence = 0
        reasons.append("✗ Cannot compute edge: straddle cost unavailable")

    signal.reasons = reasons
    return signal
