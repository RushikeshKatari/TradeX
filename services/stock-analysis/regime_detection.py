"""
Market Regime Detection using weighted scoring across multiple indicators.

Classifies regime as BULLISH / BEARISH / SIDEWAYS with:
- confidence (0-100)
- trend strength
- volatility assessment
- supporting factors
"""

import logging
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field

from indicators import IndicatorResult

logger = logging.getLogger(__name__)


@dataclass
class RegimeResult:
    regime: str  # BULLISH, BEARISH, SIDEWAYS
    confidence: float  # 0-100
    trend_strength: str  # STRONG, MODERATE, WEAK
    volatility: str  # HIGH, MODERATE, LOW
    supporting_factors: List[str] = field(default_factory=list)
    opposing_factors: List[str] = field(default_factory=list)
    scores: Dict[str, float] = field(default_factory=dict)


# Indicator weights for scoring
WEIGHTS = {
    "ema_crossover": 20,
    "rsi": 15,
    "adx": 10,
    "momentum": 10,
    "bollinger": 10,
    "bollinger_width": 5,
    "vwap": 10,
    "pcr": 15,
    "volume_oi": 5,
}


def detect_regime(
    indicators: IndicatorResult,
    current_price: Optional[float] = None,
) -> RegimeResult:
    """Detect market regime from indicator results using weighted scoring.

    Score range: -100 (strongly bearish) to +100 (strongly bullish).
    Near 0 = sideways.
    """
    bullish_score = 0
    bearish_score = 0
    total_weight = 0
    supporting = []
    opposing = []
    scores = {}

    # --- EMA Crossover (weight: 20) ---
    if indicators.ema_crossover:
        total_weight += WEIGHTS["ema_crossover"]
        if indicators.ema_crossover == "BULLISH":
            bullish_score += WEIGHTS["ema_crossover"]
            supporting.append(f"EMA 20 ({indicators.ema_20}) > EMA 50 ({indicators.ema_50}) → Bullish crossover")
            scores["EMA Crossover"] = WEIGHTS["ema_crossover"]
        elif indicators.ema_crossover == "BEARISH":
            bearish_score += WEIGHTS["ema_crossover"]
            supporting.append(f"EMA 20 ({indicators.ema_20}) < EMA 50 ({indicators.ema_50}) → Bearish crossover")
            scores["EMA Crossover"] = -WEIGHTS["ema_crossover"]
        else:
            scores["EMA Crossover"] = 0

    # --- RSI (weight: 15) ---
    if indicators.rsi_14 is not None:
        total_weight += WEIGHTS["rsi"]
        rsi = indicators.rsi_14
        if rsi > 60:
            strength = min((rsi - 60) / 20, 1.0)
            bullish_score += WEIGHTS["rsi"] * strength
            supporting.append(f"RSI={rsi:.1f} → Bullish momentum")
            scores["RSI"] = round(WEIGHTS["rsi"] * strength, 1)
        elif rsi < 40:
            strength = min((40 - rsi) / 20, 1.0)
            bearish_score += WEIGHTS["rsi"] * strength
            supporting.append(f"RSI={rsi:.1f} → Bearish momentum")
            scores["RSI"] = round(-WEIGHTS["rsi"] * strength, 1)
        else:
            opposing.append(f"RSI={rsi:.1f} → Neutral (40-60 range)")
            scores["RSI"] = 0

    # --- ADX (weight: 10) — measures trend strength, not direction ---
    if indicators.adx_14 is not None:
        total_weight += WEIGHTS["adx"]
        adx = indicators.adx_14
        if adx > 25:
            # Strong trend — amplify the dominant direction
            supporting.append(f"ADX={adx:.1f} → Strong trend detected")
            scores["ADX"] = round(WEIGHTS["adx"] * min(adx / 50, 1.0), 1)
            # ADX amplifies whichever side is winning
            if bullish_score > bearish_score:
                bullish_score += WEIGHTS["adx"] * 0.5
            elif bearish_score > bullish_score:
                bearish_score += WEIGHTS["adx"] * 0.5
        else:
            opposing.append(f"ADX={adx:.1f} → Weak trend (sideways likely)")
            scores["ADX"] = 0

    # --- Momentum (weight: 10) ---
    if indicators.momentum_10 is not None:
        total_weight += WEIGHTS["momentum"]
        mom = indicators.momentum_10
        if mom > 0:
            bullish_score += WEIGHTS["momentum"]
            supporting.append(f"Momentum={mom:+.1f} → Positive")
            scores["Momentum"] = WEIGHTS["momentum"]
        elif mom < 0:
            bearish_score += WEIGHTS["momentum"]
            supporting.append(f"Momentum={mom:+.1f} → Negative")
            scores["Momentum"] = -WEIGHTS["momentum"]
        else:
            scores["Momentum"] = 0

    # --- Bollinger Position (weight: 10) ---
    if indicators.price_vs_bollinger:
        total_weight += WEIGHTS["bollinger"]
        pos = indicators.price_vs_bollinger
        if pos == "ABOVE_UPPER":
            bullish_score += WEIGHTS["bollinger"]
            supporting.append(f"Price above upper Bollinger → Strong bullish")
            scores["Bollinger Position"] = WEIGHTS["bollinger"]
        elif pos == "BELOW_LOWER":
            bearish_score += WEIGHTS["bollinger"]
            supporting.append(f"Price below lower Bollinger → Strong bearish")
            scores["Bollinger Position"] = -WEIGHTS["bollinger"]
        else:
            opposing.append(f"Price within Bollinger Bands → Range-bound")
            scores["Bollinger Position"] = 0

    # --- Bollinger Width (weight: 5) ---
    if indicators.bollinger_width is not None:
        total_weight += WEIGHTS["bollinger_width"]
        bw = indicators.bollinger_width
        if bw > 4:
            supporting.append(f"BB Width={bw:.2f}% → High volatility expansion")
            scores["BB Width"] = WEIGHTS["bollinger_width"]
        elif bw < 2:
            opposing.append(f"BB Width={bw:.2f}% → Low volatility squeeze")
            scores["BB Width"] = -2  # Slight bearish tilt for squeezes
        else:
            scores["BB Width"] = 0

    # --- VWAP (weight: 10) ---
    if indicators.price_vs_vwap and current_price:
        total_weight += WEIGHTS["vwap"]
        if indicators.price_vs_vwap == "ABOVE":
            bullish_score += WEIGHTS["vwap"]
            supporting.append(f"Price above VWAP ({indicators.vwap}) → Institutional buying")
            scores["VWAP"] = WEIGHTS["vwap"]
        else:
            bearish_score += WEIGHTS["vwap"]
            supporting.append(f"Price below VWAP ({indicators.vwap}) → Institutional selling")
            scores["VWAP"] = -WEIGHTS["vwap"]

    # --- PCR (weight: 15) ---
    if indicators.pcr is not None:
        total_weight += WEIGHTS["pcr"]
        pcr = indicators.pcr
        if pcr > 1.2:
            # High PCR = more puts = contrarian bullish
            bullish_score += WEIGHTS["pcr"]
            supporting.append(f"PCR={pcr:.2f} → High PE OI (contrarian bullish)")
            scores["PCR"] = WEIGHTS["pcr"]
        elif pcr < 0.7:
            bearish_score += WEIGHTS["pcr"]
            supporting.append(f"PCR={pcr:.2f} → Low PE OI (contrarian bearish)")
            scores["PCR"] = -WEIGHTS["pcr"]
        elif pcr > 1.0:
            bullish_score += WEIGHTS["pcr"] * 0.3
            supporting.append(f"PCR={pcr:.2f} → Slightly bullish")
            scores["PCR"] = round(WEIGHTS["pcr"] * 0.3, 1)
        else:
            bearish_score += WEIGHTS["pcr"] * 0.3
            opposing.append(f"PCR={pcr:.2f} → Slightly bearish")
            scores["PCR"] = round(-WEIGHTS["pcr"] * 0.3, 1)

    # --- Check for minimum data sufficiency ---
    # Need at least 2 independent analytical factors (e.g., trend + momentum or technical + derivatives)
    # and at least 30% of total possible weight (total possible = 100)
    min_required_weight = 30.0
    active_factor_count = len([k for k, v in scores.items() if v != 0])
    
    if total_weight < min_required_weight or (len(scores) < 2 and "PCR" in scores):
        return RegimeResult(
            regime="INSUFFICIENT_DATA",
            confidence=0.0,
            trend_strength="NONE",
            volatility="UNKNOWN",
            supporting_factors=["Insufficient technical indicator data to determine market regime reliably"],
            opposing_factors=[f"Only {len(scores)} factor(s) available ({', '.join(scores.keys()) if scores else 'None'}) with {total_weight:.0f}% total indicator weight (minimum {min_required_weight:.0f}% needed)"],
            scores=scores,
        )

    net_score = (bullish_score - bearish_score) / total_weight * 100
    raw_confidence = abs(net_score)

    # --- Determine regime ---
    if net_score > 15:
        regime = "BULLISH"
    elif net_score < -15:
        regime = "BEARISH"
    else:
        regime = "SIDEWAYS"

    # --- Trend strength ---
    if raw_confidence > 60:
        trend_strength = "STRONG"
    elif raw_confidence > 30:
        trend_strength = "MODERATE"
    else:
        trend_strength = "WEAK"

    # --- Volatility from ATR and BB Width ---
    volatility = "MODERATE"
    if indicators.atr_14 is not None and current_price:
        atr_pct = indicators.atr_14 / current_price * 100
        if atr_pct > 2:
            volatility = "HIGH"
        elif atr_pct < 0.8:
            volatility = "LOW"
    elif indicators.bollinger_width is not None:
        if indicators.bollinger_width > 4:
            volatility = "HIGH"
        elif indicators.bollinger_width < 2:
            volatility = "LOW"

    confidence = min(raw_confidence, 95)  # Cap at 95

    return RegimeResult(
        regime=regime,
        confidence=round(confidence, 1),
        trend_strength=trend_strength,
        volatility=volatility,
        supporting_factors=supporting,
        opposing_factors=opposing,
        scores=scores,
    )
