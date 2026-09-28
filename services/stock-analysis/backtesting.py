"""Historical options backtesting.

The engine deliberately requires a real historical option-chain CSV. It never
creates prices or substitutes live data for missing history.
Expected columns: date,symbol,expiry,strike,option_type,spot,ltp[,iv,oi,volume]
"""

import os
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Dict, List

import pandas as pd

from data_providers.base import OptionChainData, OptionChainRow, OptionData
from indicators import calculate_indicators
from regime_detection import detect_regime
from options_analysis import analyze_options


REQUIRED_COLUMNS = {"date", "symbol", "expiry", "strike", "option_type", "spot", "ltp"}


@dataclass
class BacktestConfig:
    symbol: str
    starting_capital: float = 1000000.0
    lot_size: int = 25
    slippage_per_unit: float = 0.0
    cost_per_trade: float = 0.0


def _unavailable(message: str) -> dict:
    return {"status": "INSUFFICIENT_DATA", "message": message, "trades": [], "metrics": {}, "signal_counts": {"LONG_CALL": 0, "LONG_PUT": 0, "NO_TRADE": 0}, "regime_performance": []}


def run_backtest(config: BacktestConfig) -> dict:
    path = os.getenv("BACKTEST_OPTIONS_FILE", "")
    if not path or not os.path.isfile(path):
        return _unavailable("Historical option data is not configured. Set BACKTEST_OPTIONS_FILE to a genuine historical option-chain CSV; live data is never used for backtesting.")
    try:
        df = pd.read_csv(path)
    except Exception as exc:
        return _unavailable(f"Could not read historical option data: {exc}")
    missing = REQUIRED_COLUMNS - set(df.columns.str.lower())
    if missing:
        return _unavailable(f"Historical option data is missing required columns: {', '.join(sorted(missing))}")
    df.columns = [c.lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for col in ("strike", "spot", "ltp"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["symbol"] = df["symbol"].astype(str).str.upper()
    df["option_type"] = df["option_type"].astype(str).str.upper().replace({"CALL": "CE", "PUT": "PE"})
    df = df[(df.symbol == config.symbol.upper()) & df.date.notna() & df.strike.notna() & df.ltp.notna()]
    if df.empty:
        return _unavailable(f"No genuine historical option rows were found for {config.symbol}.")
    dates = sorted(df.date.dt.date.unique())
    if len(dates) < 35:
        return _unavailable(f"Only {len(dates)} historical sessions are available; at least 35 are required for the unchanged EMA/ADX logic.")

    capital = float(config.starting_capital)
    equity = [capital]
    trades = []
    signal_counts = {"LONG_CALL": 0, "LONG_PUT": 0, "NO_TRADE": 0}
    regimes: Dict[str, dict] = {}
    # At date i, indicators only see data through i. The position exits on a later
    # recorded session, so no future rows influence the entry decision.
    for i, day in enumerate(dates[:-1]):
        day_rows = df[df.date.dt.date == day]
        prior = df[df.date.dt.date <= day].sort_values("date")
        spots = prior.groupby("date")["spot"].first().dropna().tolist()
        if len(spots) < 20:
            continue
        indicators = calculate_indicators(spots)
        regime = detect_regime(indicators, spots[-1])
        chain = _build_chain(day_rows, config.symbol)
        signal = analyze_options(regime, chain, spots[-1])
        if signal.signal in signal_counts:
            signal_counts[signal.signal] += 1
        if signal.signal not in ("LONG_CALL", "LONG_PUT"):
            continue
        next_day = dates[i + 1]
        exit_rows = df[(df.date.dt.date == next_day) & (df.strike == signal.strike) & (df.option_type == signal.option_type)]
        if exit_rows.empty or signal.premium is None:
            continue
        exit_price = float(exit_rows.iloc[0].ltp)
        qty = int(config.lot_size)
        entry_cost = float(signal.premium) * qty
        exit_value = exit_price * qty
        friction = config.cost_per_trade + config.slippage_per_unit * qty * 2
        pnl = exit_value - entry_cost - friction
        capital += pnl
        equity.append(capital)
        regime_name = regime.regime
        bucket = regimes.setdefault(regime_name, {"trades": 0, "wins": 0, "pnl": 0.0})
        bucket["trades"] += 1; bucket["wins"] += int(pnl > 0); bucket["pnl"] += pnl
        trades.append({"date": str(day), "exit_date": str(next_day), "signal": signal.signal, "regime": regime_name, "strike": signal.strike, "entry": round(float(signal.premium), 2), "exit": round(exit_price, 2), "pnl": round(pnl, 2)})
    if not trades:
        return _unavailable("Historical rows exist, but there are not enough complete entry/exit option observations to produce a valid backtest.")
    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    peak = equity[0]; max_dd = 0.0
    for value in equity:
        peak = max(peak, value); max_dd = max(max_dd, peak - value)
    metrics = {"trades": len(trades), "win_rate": round(len(wins) / len(trades) * 100, 2), "pnl": round(sum(pnls), 2), "profit_factor": round(sum(wins) / abs(sum(losses)), 2) if losses else None, "expectancy": round(sum(pnls) / len(pnls), 2), "max_drawdown": round(max_dd, 2), "starting_capital": config.starting_capital, "ending_capital": round(capital, 2)}
    regime_performance = [{"regime": k, "trades": v["trades"], "win_rate": round(v["wins"] / v["trades"] * 100, 2), "pnl": round(v["pnl"], 2)} for k, v in regimes.items()]
    return {"status": "READY", "message": "Backtest uses only the configured historical option-chain file.", "metrics": metrics, "signal_counts": signal_counts, "regime_performance": regime_performance, "trades": trades[-100:]}


def _build_chain(rows: pd.DataFrame, symbol: str) -> OptionChainData:
    strikes = []
    spot = float(rows.spot.dropna().iloc[0])
    expiry = str(rows.expiry.iloc[0])
    for strike, group in rows.groupby("strike"):
        sides = {}
        for _, r in group.iterrows():
            sides[r.option_type] = OptionData(float(strike), expiry, r.option_type, float(r.ltp), int(r.get("oi", 0) or 0), iv=float(r.get("iv", 0) or 0))
        strikes.append(OptionChainRow(float(strike), expiry, sides.get("CE"), sides.get("PE")))
    atm = min((s.strike_price for s in strikes), key=lambda x: abs(x - spot))
    atm_row = next(s for s in strikes if s.strike_price == atm)
    straddle = (atm_row.ce.ltp if atm_row.ce else 0) + (atm_row.pe.ltp if atm_row.pe else 0)
    return OptionChainData(symbol=symbol, underlying_value=spot, expiry_dates=[expiry], strikes=strikes, atm_strike=atm, straddle_price=straddle, provider="historical-csv")
