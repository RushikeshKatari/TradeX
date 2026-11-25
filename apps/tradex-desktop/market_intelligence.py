"""Explainable, conditional market scenarios built only from stored market data."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

MODES = {"complete", "support", "resistance", "bullish", "bearish"}


def _connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=10000")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS ta_commentary_events (
            uid TEXT PRIMARY KEY, event_key TEXT NOT NULL, instrument TEXT NOT NULL,
            timeframe TEXT NOT NULL, event_type TEXT NOT NULL, event_state TEXT NOT NULL,
            occurred_at TEXT NOT NULL, candle_time INTEGER NOT NULL, price REAL NOT NULL,
            title TEXT NOT NULL, commentary TEXT NOT NULL, evidence_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ta_commentary_recent ON ta_commentary_events(instrument,occurred_at DESC);
        CREATE TABLE IF NOT EXISTS ta_predictions (
            uid TEXT PRIMARY KEY, instrument TEXT NOT NULL, timeframe TEXT NOT NULL,
            created_at TEXT NOT NULL, direction TEXT NOT NULL, trigger_level REAL,
            confirmation_level REAL, invalidation REAL, targets_json TEXT NOT NULL,
            evidence_json TEXT NOT NULL, confirmed_at INTEGER, outcome TEXT NOT NULL DEFAULT 'WAITING',
            outcome_time INTEGER, outcome_price REAL
        );
        CREATE INDEX IF NOT EXISTS idx_ta_predictions_active ON ta_predictions(instrument,timeframe,outcome);
    """)
    return db


def _price(value: Any, digits: int = 2) -> str:
    return f"${float(value):,.{digits}f}"


def _uid(*items: Any) -> str:
    return hashlib.sha1("|".join(map(str, items)).encode()).hexdigest()[:24]


def _nearest_level(levels: list[dict[str, Any]], kind: str, current: float, side: str) -> dict[str, Any] | None:
    eligible = []
    for level in levels:
        if level.get("kind") != kind:
            continue
        price = float(level.get("price") or 0)
        if (side == "below" and price < current) or (side == "above" and price > current):
            eligible.append(level)
    return min(eligible, key=lambda x: abs(float(x["price"]) - current)) if eligible else None


def _nearest_structure(structures: list[dict[str, Any]], current: float, side: str, allowed: tuple[str, ...]) -> dict[str, Any] | None:
    candidates = []
    for item in structures:
        if item.get("type") not in allowed or item.get("status") in ("INVALIDATED", "BROKEN", "FULLY FILLED"):
            continue
        low, high = float(item.get("lower") or 0), float(item.get("upper") or 0)
        boundary = high if side == "below" else low
        if (side == "below" and 0 < high < current) or (side == "above" and low > current):
            candidates.append((abs(current - boundary), item, boundary))
    if not candidates:
        return None
    _, item, boundary = min(candidates, key=lambda x: x[0])
    return {**item, "target_price": boundary}


def _trendline_state(line: dict[str, Any], candles: list[dict[str, Any]], current: float, atr: float) -> dict[str, Any]:
    if not candles:
        return {"state": "inactive", "projected_price": None, "distance": None, "touches": 0}
    direction = str(line.get("direction", ""))
    t0, t1 = int(line.get("start_time") or 0), int(line.get("end_time") or 0)
    p0, p1 = float(line.get("start_price") or 0), float(line.get("end_price") or 0)
    if not t0 or not t1 or t1 == t0:
        return {"state": "inactive", "projected_price": None, "distance": None, "touches": 0}
    tol = max(atr * 0.35, current * 0.0006)
    def projection(candle: dict[str, Any]) -> float:
        ratio = (int(candle["time"]) - t0) / (t1 - t0)
        return p0 + (p1 - p0) * ratio
    recent = candles[-30:]
    touches = [c for c in recent if c["low"] <= projection(c) + tol and c["high"] >= projection(c) - tol]
    recent_touch = touches[-1] if touches else None
    last = candles[-1]
    projected = projection(last)
    distance = abs(current - projected)
    crossed_up = direction == "bearish"
    # A broken-line retest is only named after a prior confirmed close beyond
    # the trendline, separation from it, and a subsequent return to the line.
    break_index = None
    for i, candle in enumerate(recent[:-2]):
        lp = projection(candle)
        broke = candle["close"] > lp + tol if crossed_up else candle["close"] < lp - tol
        separated = any((x["low"] > projection(x) + atr * .5 if crossed_up else x["high"] < projection(x) - atr * .5)
                        for x in recent[i + 1:-1])
        if broke and separated:
            break_index = i
    retest = bool(break_index is not None and recent_touch is not None and recent.index(recent_touch) > break_index)
    if crossed_up:
        rejection = bool(recent_touch and recent_touch["close"] < projection(recent_touch) - tol * 0.15)
        held_beyond = bool(recent_touch and recent_touch["close"] > projection(recent_touch) - tol * 0.15)
        confirmed_break = len(candles) >= 2 and all(c["close"] > projection(c) + tol for c in candles[-2:])
        state = "retest_holding_above" if retest and held_beyond else "retest_rejecting_below" if retest and rejection else "confirmed_break_above" if confirmed_break else "rejection" if rejection else "repeated_test" if len(touches) > 1 and distance <= tol else "first_test" if recent_touch else "approaching" if distance <= atr else "inactive"
    else:
        rejection = bool(recent_touch and recent_touch["close"] > projection(recent_touch) + tol * 0.15)
        held_beyond = bool(recent_touch and recent_touch["close"] < projection(recent_touch) + tol * 0.15)
        confirmed_break = len(candles) >= 2 and all(c["close"] < projection(c) - tol for c in candles[-2:])
        state = "retest_rejecting_below" if retest and held_beyond else "retest_holding_above" if retest and rejection else "confirmed_break_below" if confirmed_break else "rejection" if rejection else "repeated_test" if len(touches) > 1 and distance <= tol else "first_test" if recent_touch else "approaching" if distance <= atr else "inactive"
    return {"state": state, "projected_price": projected, "distance": distance,
            "touches": len(touches), "uid": line.get("uid"), "direction": direction,
            "timeframe": line.get("timeframe"), "strength": line.get("score"),
            "status": line.get("status"), "start_time": t0,
            "last_tested": recent_touch["time"] if recent_touch else None,
            "slope_per_bar": (p1-p0)/max(1,len(candles)-1)}


def _target_ladder(direction: str, current: float, trigger: float, atr: float,
                   levels: list[dict[str, Any]], structures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    side = "below" if direction == "bearish" else "above"
    candidates: list[dict[str, Any]] = []
    for level in levels:
        if level.get("status") in ("BROKEN", "FLIPPED"):
            continue
        value = float(level.get("price") or 0)
        if (side == "below" and 0 < value < trigger) or (side == "above" and value > trigger):
            candidates.append({"price": value, "method": f"historical {level.get('kind')} · {level.get('timeframe')}", "evidence": f"strength {level.get('strength', 0)}/100"})
    for item in structures:
        if item.get("status") in ("INVALIDATED", "BROKEN", "FULLY FILLED"):
            continue
        kind = item.get("type")
        if kind not in ("zone", "fvg"):
            continue
        boundary = float(item.get("upper") or 0) if side == "below" else float(item.get("lower") or 0)
        if (side == "below" and 0 < boundary < trigger) or (side == "above" and boundary > trigger):
            label = "demand zone" if item.get("direction") == "demand" else "supply zone" if item.get("direction") == "supply" else f"{item.get('direction')} FVG"
            candidates.append({"price": boundary, "method": f"{label} · {item.get('timeframe')}", "evidence": f"structure strength {item.get('score', 0)}/100"})
    candidates.sort(key=lambda x: abs(trigger - x["price"]))
    targets: list[dict[str, Any]] = []
    for candidate in candidates:
        if any(abs(candidate["price"] - target["price"]) < max(atr * 0.2, current * 0.0005) for target in targets):
            continue
        targets.append(candidate)
        if len(targets) == 3:
            break
    atr_steps = (1.0, 1.5, 2.0)
    for step in atr_steps:
        projected = trigger - step * atr if direction == "bearish" else trigger + step * atr
        if (side == "below" and projected <= 0) or any(abs(projected - target["price"]) < max(atr * 0.2, current * 0.0005) for target in targets):
            continue
        targets.append({"price": projected, "method": f"{step:g}× ATR projection", "evidence": f"ATR {atr:.4g}"})
        if len(targets) == 3:
            break
    return [{"rank": i + 1, **target, "distance": abs(current - target["price"])} for i, target in enumerate(targets[:3])]


def _scenario(direction: str, current: float, atr: float, levels: list[dict[str, Any]],
              structures: list[dict[str, Any]], market_structure: dict[str, Any],
              timeframe_biases: dict[str, str], historical_context: dict[str, Any], trendlines: list[dict[str, Any]],
              candles: list[dict[str, Any]]) -> dict[str, Any]:
    bearish = direction == "bearish"
    side = "below" if bearish else "above"
    kind = "support" if bearish else "resistance"
    level = _nearest_level(levels, kind, current, side)
    swing = market_structure.get("swing_low" if bearish else "swing_high") or {}
    swing_price = float(swing.get("price") or 0)
    if swing_price and ((bearish and swing_price >= current) or (not bearish and swing_price <= current)):
        swing_price = 0
    candidates = []
    if level:
        band = float(level.get("zone_low" if bearish else "zone_high") or level["price"])
        candidates.append((abs(current - band), band, f"historical {kind}", level))
    if swing_price:
        candidates.append((abs(current - swing_price), swing_price, "confirmed swing", swing))
    structural = _nearest_structure(structures, current, side, ("zone", "fvg"))
    if structural:
        candidates.append((abs(current - structural["target_price"]), structural["target_price"], structural.get("type", "structure"), structural))
    if candidates:
        _, trigger, trigger_source, trigger_data = min(candidates, key=lambda x: x[0])
    else:
        trigger = current - atr * 0.25 if bearish else current + atr * 0.25
        trigger_source, trigger_data = "ATR-derived reference (no nearby structural level)", {}
    confirmation = trigger - atr * 0.05 if bearish else trigger + atr * 0.05
    stop_level = _nearest_level(levels, "resistance" if bearish else "support", current,
                                "above" if bearish else "below")
    invalidation = (float(stop_level.get("zone_high") or stop_level["price"]) if bearish and stop_level
                    else current + atr * 0.75 if bearish
                    else float(stop_level.get("zone_low") or stop_level["price"]) if stop_level
                    else current - atr * 0.75)
    # Sparse historical data can leave the nearest opposing level far away.
    # Do not present that as a useful invalidation for this local setup.
    max_invalidation_distance = max(atr * 2.0, current * 0.01)
    if abs(current - invalidation) > max_invalidation_distance:
        invalidation = current + atr * 0.75 if bearish else current - atr * 0.75
    targets = _target_ladder(direction, current, trigger, atr, levels, structures)
    trend_match = [x for x in trendlines if (x.get("direction") == ("bearish" if bearish else "bullish"))
                   and x.get("state") in ("approaching", "first_test", "repeated_test", "rejection", "retest_holding_above", "retest_rejecting_below", "confirmed_break_above", "confirmed_break_below")]
    aligned_tf = sum(1 for bias in timeframe_biases.values() if bias == direction)
    opposing_tf = sum(1 for bias in timeframe_biases.values() if bias == ("bullish" if bearish else "bearish"))
    score = 35
    if market_structure.get("trend") == direction:
        score += 18
    if trend_match:
        score += 12 if any("retest" in x["state"] or x["state"] == "rejection" for x in trend_match) else 7
    if level:
        score += min(12, float(level.get("strength") or 0) * 0.12)
    score += min(15, aligned_tf * 3) - min(15, opposing_tf * 3)
    long_bias = historical_context.get("trend_bias")
    if long_bias in ("bullish", "bearish"):
        score += 10 if long_bias == direction else -10
    if (market_structure.get("break_event") or {}).get("direction") == direction:
        score += 15
    score = max(0, min(100, round(score)))
    grade = "high evidence" if score >= 72 else "moderate evidence" if score >= 52 else "limited evidence"
    last_close = float(candles[-1]["close"]) if candles else current
    triggered = last_close < confirmation if bearish else last_close > confirmation
    return {"direction": direction, "status": "confirmed" if triggered else "conditional",
            "evidence_score": score, "evidence_grade": grade,
            "trigger_level": trigger, "trigger_source": trigger_source,
            "confirmation_level": confirmation, "last_confirmed_close": last_close,
            "confirmed": triggered, "invalidation": invalidation,
            "invalidation_rule": f"confirmed close {'above' if bearish else 'below'} invalidation level",
            "targets": targets, "trendline_context": trend_match[:1],
            "support_or_resistance": level,
            "evidence": [f"Market structure: {market_structure.get('trend', 'neutral')}",
                         f"Aligned timeframes: {aligned_tf}; opposing timeframes: {opposing_tf}",
                         f"Trigger source: {trigger_source}",
                         (f"Long-term daily context: {long_bias} across {historical_context.get('coverage_years', 0)} years; observed range {_price(historical_context['ten_year_low'])}–{_price(historical_context['ten_year_high'])}"
                          if historical_context.get("ten_year_low") and historical_context.get("ten_year_high")
                          else f"Long-term daily context: {long_bias or 'unavailable'} across {historical_context.get('coverage_years', 0)} years")]}


def _build_commentary(data: dict[str, Any], support: dict[str, Any] | None,
                      resistance: dict[str, Any] | None, trendlines: list[dict[str, Any]],
                      bearish: dict[str, Any], bullish: dict[str, Any], mode: str) -> dict[str, Any]:
    symbol, timeframe = data["symbol"], data["timeframe"]
    current, atr = float(data["current_price"]), float(data.get("atr") or 0)
    structure = data.get("market_structure", {})
    relevant = [x for x in trendlines if x.get("state") != "inactive"]
    chosen = relevant[0] if relevant else (trendlines[0] if trendlines else None)
    if mode == "support":
        level = support
        status = "SUPPORT TESTING" if level and current <= level["zone_high"] + atr * .15 else "SUPPORT APPROACHING" if level and current - level["price"] < atr else "SUPPORT IN VIEW"
        title = status
        if not level:
            body = f"No confirmed stored support is close enough to {symbol} at {_price(current)}. The analysis has not manufactured a support value."
        else:
            confirmation = float(level["zone_low"])
            body = (f"{symbol} is around historical support at {_price(level['price'])} ({level['timeframe']}, strength {level['strength']}/100). "
                    f"A confirmed {timeframe} close below {_price(confirmation)} would mark a support break and expose the next downside reference. "
                    f"A close back above {_price(level['zone_high'])} would show the zone is holding for now; it does not guarantee a reversal.")
        event_key = f"support|{level['uid']}" if level else f"support|none|{timeframe}"
        event_state = status.casefold().replace(" ", "_")
        event_type = "support"
    elif mode == "resistance":
        level = resistance
        status = "RESISTANCE TESTING" if level and current >= level["zone_low"] - atr * .15 else "RESISTANCE APPROACHING" if level and level["price"] - current < atr else "RESISTANCE IN VIEW"
        title = status
        if not level:
            body = f"No confirmed stored resistance is close enough to {symbol} at {_price(current)}. The analysis has not manufactured a resistance value."
        else:
            confirmation = float(level["zone_high"])
            body = (f"{symbol} is near historical resistance at {_price(level['price'])} ({level['timeframe']}, strength {level['strength']}/100). "
                    f"A confirmed {timeframe} close above {_price(confirmation)} would be the breakout condition. "
                    f"A rejection followed by a close below the nearby support would leave the resistance intact.")
        event_key = f"resistance|{level['uid']}" if level else f"resistance|none|{timeframe}"
        event_state = status.casefold().replace(" ", "_")
        event_type = "resistance"
    elif mode in ("bullish", "bearish"):
        scenario = bullish if mode == "bullish" else bearish
        direction = "bullish" if mode == "bullish" else "bearish"
        title = f"{direction.upper()} SCENARIO · {scenario['status'].upper()}"
        targets = ", ".join(_price(x["price"]) for x in scenario["targets"][:2]) or "no structural targets available"
        verb = "resistance" if direction == "bullish" else "support"
        body = (f"The {direction} case is conditional on a confirmed {timeframe} close "
                f"{'above' if direction == 'bullish' else 'below'} {_price(scenario['confirmation_level'])} ({scenario['trigger_source']}). "
                f"Potential next references: {targets}. A confirmed close beyond {_price(scenario['invalidation'])} against the setup invalidates this scenario. "
                f"Evidence score {scenario['evidence_score']}/100 ({scenario['evidence_grade']}); this is not a probability.")
        event_key = f"scenario|{direction}|{timeframe}|{round(scenario['confirmation_level'], 4)}"
        event_state = scenario["status"]
        event_type = f"{direction}_scenario"
    elif chosen:
        state = chosen["state"]
        line_direction = chosen["direction"]
        line_price = chosen["projected_price"]
        title_map = {"retest_holding_above": "BROKEN TRENDLINE RETEST HOLDING", "retest_rejecting_below": "BROKEN TRENDLINE RETEST REJECTING",
                     "confirmed_break_above": "TRENDLINE BREAK ABOVE CONFIRMED", "confirmed_break_below": "TRENDLINE BREAK BELOW CONFIRMED",
                     "rejection": "TRENDLINE REJECTION", "repeated_test": "REPEATED TRENDLINE TEST", "first_test": "TRENDLINE TESTING", "approaching": "TRENDLINE APPROACHING", "inactive": "TRENDLINE DETECTED"}
        title = title_map.get(state, "TRENDLINE UPDATE")
        if state == "rejection":
            title = "BEARISH TRENDLINE REJECTION" if line_direction == "bearish" else "BULLISH SUPPORT TRENDLINE HOLD"
        if line_direction == "bearish":
            targets = ", ".join(_price(x["price"]) for x in bearish["targets"][:2]) or "no confirmed target zones available"
            if state in ("retest_holding_above", "confirmed_break_above"):
                title = "BULLISH TRENDLINE BREAK RETEST HOLDING" if state == "retest_holding_above" else "BULLISH TRENDLINE BREAK CONFIRMED"
                body = (f"Price has closed above the descending resistance trendline near {_price(line_price)} on {chosen['timeframe']}" + (" and returned to test the former resistance from above." if state == "retest_holding_above" else ".") +
                        f" The bullish case still needs a confirmed {timeframe} close above {_price(bullish['confirmation_level'])} ({bullish['trigger_source']}); next references are {', '.join(_price(x['price']) for x in bullish['targets'][:2]) or 'not available'}. "
                        f"A confirmed close below {_price(bullish['invalidation'])} invalidates that case.")
            else:
                lead = (f"A descending resistance trendline is present near {_price(line_price)} on {chosen['timeframe']}. " if state == "inactive" else f"{symbol} is {state.replace('_', ' ')} a descending resistance trendline near {_price(line_price)} on {chosen['timeframe']}. ")
                body = (lead +
                        f"A bearish continuation requires a confirmed {timeframe} close below {_price(bearish['confirmation_level'])} ({bearish['trigger_source']}); next structural/ATR references are {targets}. "
                        f"A confirmed close above {_price(bearish['invalidation'])} invalidates the bearish case. A touch alone is not a confirmed reversal.")
        else:
            targets = ", ".join(_price(x["price"]) for x in bullish["targets"][:2]) or "no confirmed target zones available"
            if state in ("retest_rejecting_below", "confirmed_break_below"):
                title = "BEARISH BROKEN SUPPORT RETEST REJECTING" if state == "retest_rejecting_below" else "BEARISH TRENDLINE BREAK CONFIRMED"
                body = (f"Price has closed below the ascending support trendline near {_price(line_price)} on {chosen['timeframe']}" + (" and returned to test the former support from below." if state == "retest_rejecting_below" else ".") +
                        f" The bearish case still needs a confirmed {timeframe} close below {_price(bearish['confirmation_level'])} ({bearish['trigger_source']}); next references are {', '.join(_price(x['price']) for x in bearish['targets'][:2]) or 'not available'}. "
                        f"A confirmed close above {_price(bearish['invalidation'])} invalidates that case.")
            else:
                lead = (f"An ascending support trendline is present near {_price(line_price)} on {chosen['timeframe']}. " if state == "inactive" else f"{symbol} is {state.replace('_', ' ')} an ascending support trendline near {_price(line_price)} on {chosen['timeframe']}. ")
                body = (lead +
                        f"A bullish continuation requires a confirmed {timeframe} close above {_price(bullish['confirmation_level'])} ({bullish['trigger_source']}); next structural/ATR references are {targets}. "
                        f"A confirmed close below {_price(bullish['invalidation'])} invalidates the bullish case. A trendline contact alone is not confirmation.")
        event_key = f"trendline|{chosen['uid']}"
        event_state = "detected" if state == "inactive" else state
        event_type = f"{line_direction}_trendline"
    else:
        bias = structure.get("trend", "neutral")
        title = "NO CLEAR DIRECTION" if bias == "neutral" else f"{bias.upper()} STRUCTURE · WAITING FOR LEVEL BREAK"
        body = (f"{symbol} is at {_price(current)} on {timeframe}. Confirmed swing structure is {bias}. "
                f"A close below {_price(bearish['confirmation_level'])} would support the bearish case; a close above {_price(bullish['confirmation_level'])} would support the bullish case. "
                "No directional move is confirmed yet; wait for the candle close rather than treating an intrabar wick as a breakout.")
        event_key = f"market|{symbol}|{timeframe}"
        event_state = f"{bias}|{round(bearish['confirmation_level'], 3)}|{round(bullish['confirmation_level'], 3)}"
        event_type = "market_structure"
    higher = data.get("timeframe_biases", {}).get("1d") or data.get("timeframe_biases", {}).get("4h")
    local_bias = structure.get("trend", "neutral")
    if mode in ("complete", "bullish", "bearish") and higher in ("bullish", "bearish") and local_bias in ("bullish", "bearish") and higher != local_bias:
        body += f" Higher-timeframe context: {data.get('timeframe_biases', {}).get('1d') or data.get('timeframe_biases', {}).get('4h')} structure conflicts with the {timeframe} structure; this lower-timeframe scenario is not confirmation of a higher-timeframe reversal."
    return {"uid": _uid(event_key, event_state), "event_key": event_key,
            "event_state": event_state, "event_type": event_type,
            "instrument": symbol, "timeframe": timeframe, "timestamp": data["updated_at"],
            "candle_time": int(data["candles"][-1]["time"]) if data.get("candles") else 0,
            "price": current, "title": title, "commentary": body,
            "evidence": {"market_structure": structure.get("trend"), "support": support,
                         "resistance": resistance, "trendline": chosen}}


def _save_and_update_predictions(db: sqlite3.Connection, data: dict[str, Any], scenarios: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candles = [c for c in data.get("candles", []) if c.get("closed")]
    if not candles:
        return []
    latest = candles[-1]
    rows = db.execute("SELECT * FROM ta_predictions WHERE instrument=? AND timeframe=? AND outcome IN ('WAITING','TRIGGERED')",
                      (data["symbol"], data["timeframe"])).fetchall()
    for row in rows:
        trigger, invalid = row["trigger_level"], row["invalidation"]
        targets = json.loads(row["targets_json"] or "[]")
        target = float(targets[0]["price"]) if targets else None
        triggered_at = row["confirmed_at"]
        outcome = row["outcome"]
        created_dt = datetime.fromisoformat(row["created_at"])
        if created_dt.tzinfo is None:
            created_dt = created_dt.replace(tzinfo=timezone.utc)
        created_at_ms = int(created_dt.timestamp() * 1000)
        for candle in candles:
            if candle["time"] <= created_at_ms:
                continue
            if outcome == "WAITING":
                confirm = candle["close"] < row["confirmation_level"] if row["direction"] == "bearish" else candle["close"] > row["confirmation_level"]
                if confirm:
                    outcome, triggered_at = "TRIGGERED", candle["time"]
            if outcome == "TRIGGERED":
                hit_target = target is not None and (candle["low"] <= target if row["direction"] == "bearish" else candle["high"] >= target)
                hit_invalidation = invalid is not None and (candle["high"] >= invalid if row["direction"] == "bearish" else candle["low"] <= invalid)
                if hit_target and hit_invalidation:
                    outcome = "AMBIGUOUS_SAME_CANDLE"
                elif hit_target:
                    outcome = "TARGET_1_REACHED"
                elif hit_invalidation:
                    outcome = "INVALIDATED"
            if outcome not in ("WAITING", "TRIGGERED"):
                db.execute("UPDATE ta_predictions SET confirmed_at=?,outcome=?,outcome_time=?,outcome_price=? WHERE uid=?",
                           (triggered_at, outcome, candle["time"], candle["close"], row["uid"]))
                break
            elif triggered_at and row["confirmed_at"] is None:
                db.execute("UPDATE ta_predictions SET confirmed_at=?,outcome='TRIGGERED' WHERE uid=?", (triggered_at, row["uid"]))
    now = datetime.now(timezone.utc).isoformat()
    for scenario in scenarios:
        target = scenario["targets"][0]["price"] if scenario["targets"] else None
        signature = _uid(data["symbol"], data["timeframe"], scenario["direction"],
                         round(scenario["confirmation_level"], 5), round(scenario["invalidation"], 5), scenario["trigger_source"])
        already_confirmed = bool(scenario["confirmed"])
        confirmation_time = candles[-1]["time"] if already_confirmed else None
        db.execute("""INSERT OR IGNORE INTO ta_predictions
            (uid,instrument,timeframe,created_at,direction,trigger_level,confirmation_level,invalidation,
             targets_json,evidence_json,confirmed_at,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (signature, data["symbol"], data["timeframe"], now, scenario["direction"],
             scenario["trigger_level"], scenario["confirmation_level"], scenario["invalidation"],
             json.dumps(scenario["targets"]), json.dumps(scenario["evidence"]), confirmation_time,
             "TRIGGERED" if already_confirmed else "WAITING"))
    db.commit()
    recent = db.execute("SELECT uid,instrument,timeframe,created_at,direction,trigger_level,confirmation_level,invalidation,targets_json,evidence_json,confirmed_at,outcome,outcome_time,outcome_price FROM ta_predictions WHERE instrument=? ORDER BY created_at DESC LIMIT 12", (data["symbol"],)).fetchall()
    return [{**dict(row), "targets": json.loads(row["targets_json"]), "evidence": json.loads(row["evidence_json"])} for row in recent]


def build_market_intelligence(db_path: str, data: dict[str, Any], mode: str = "complete") -> dict[str, Any]:
    mode = mode if mode in MODES else "complete"
    current = float(data.get("current_price") or 0)
    atr = float(data.get("atr") or 0)
    levels = data.get("levels") or []
    structures = data.get("structures") or []
    candles = [c for c in data.get("candles", []) if c.get("closed")]
    market = data.get("market_structure") or {}
    trendlines = []
    for item in structures:
        if item.get("type") == "trendline":
            trendlines.append({**item, **_trendline_state(item, candles, current, atr)})
    support = _nearest_level(levels, "support", current, "below")
    resistance = _nearest_level(levels, "resistance", current, "above")
    timeframe_biases = data.get("timeframe_biases") or {data.get("timeframe", ""): market.get("trend", "neutral")}
    historical_context = data.get("historical_context") or {}
    bearish = _scenario("bearish", current, atr, levels, structures, market, timeframe_biases, historical_context, trendlines, candles)
    bullish = _scenario("bullish", current, atr, levels, structures, market, timeframe_biases, historical_context, trendlines, candles)
    commentary = _build_commentary(data, support, resistance, trendlines, bearish, bullish, mode)
    if mode == "bullish": visible_scenarios = [bullish]
    elif mode == "bearish": visible_scenarios = [bearish]
    elif mode == "support": visible_scenarios = [bearish]
    elif mode == "resistance": visible_scenarios = [bullish]
    else: visible_scenarios = [bullish, bearish]
    fresh = bool(data.get("warning") == "")
    if not fresh:
        commentary["title"] = "MARKET DATA STALE · CONDITIONAL ANALYSIS"
        commentary["commentary"] = f"{data['warning']} Stored candles are shown for context. No live breakout, retest or target should be treated as current until the feed refreshes."
        commentary["event_type"] = "data_stale"
        commentary["event_key"] = f"data|{data['symbol']}|{data['timeframe']}"
        commentary["event_state"] = "stale"
    db = _connect(db_path)
    try:
        uid = _uid(commentary["event_key"], commentary["event_state"])
        exists = db.execute("SELECT 1 FROM ta_commentary_events WHERE uid=?", (uid,)).fetchone()
        if not exists:
            db.execute("INSERT INTO ta_commentary_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                       (uid, commentary["event_key"], commentary["instrument"], commentary["timeframe"],
                        commentary["event_type"], commentary["event_state"], commentary["timestamp"],
                        commentary["candle_time"], commentary["price"], commentary["title"],
                        commentary["commentary"], json.dumps(commentary["evidence"])))
        predictions = _save_and_update_predictions(db, data, [bullish, bearish])
        recent = db.execute("SELECT uid,instrument,timeframe,event_type,event_state,occurred_at,candle_time,price,title,commentary,evidence_json FROM ta_commentary_events WHERE instrument=? ORDER BY occurred_at DESC LIMIT 20", (data["symbol"],)).fetchall()
        db.commit()
        events = [{**dict(row), "evidence": json.loads(row["evidence_json"])} for row in recent]
    finally:
        db.close()
    active_events = [event for event in events if event["timeframe"] == data["timeframe"]]
    return {"mode": mode, "support": support, "resistance": resistance,
            "trendlines": trendlines, "scenarios": visible_scenarios,
            "all_scenarios": [bullish, bearish], "commentary": commentary,
            "commentary_events": active_events, "predictions": predictions,
            "timeframe_biases": timeframe_biases,
            "historical_context": historical_context,
            "data_fresh": fresh,
            "disclaimer": "Conditional technical analysis from public market data. Evidence scores are not calibrated probabilities or guaranteed outcomes."}
