"""Binance candle ingestion and persistent price-action structure analysis."""
from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from statistics import median
from typing import Any

BINANCE_FUTURES = "https://fapi.binance.com"
SUPPORTED_SYMBOLS = {"XAUUSDT", "XAGUSDT", "BTCUSDT", "ETHUSDT"}
TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h", "1d"}
TF_WEIGHT = {"1m": 4, "5m": 7, "15m": 11, "1h": 15, "4h": 18, "1d": 20}
_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.RLock()
_WARMING: set[str] = set()
_WARMED: set[str] = set()
_WARMING_LOCK = threading.RLock()
_LONG_HISTORY_LOCK = threading.RLock()
_LONG_HISTORY_WARMING: set[str] = set()
_LONG_HISTORY_LAST: dict[str, float] = {}
LONG_HISTORY_DAYS = 3653
_DEFAULT_SCORING = {"reactions": 25, "timeframe": 20, "rejection": 15, "volume": 15,
                    "confluence": 10, "recency": 10, "retest": 5}
try:
    SCORING = {**_DEFAULT_SCORING, **{k: float(v) for k, v in json.loads(os.environ.get("TRADEX_TA_SCORING", "{}")).items() if k in _DEFAULT_SCORING}}
except (TypeError, ValueError, json.JSONDecodeError):
    SCORING = dict(_DEFAULT_SCORING)


def _open_db(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=10000")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS market_candles (
            symbol TEXT NOT NULL, timeframe TEXT NOT NULL, open_time INTEGER NOT NULL,
            open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
            volume REAL NOT NULL, close_time INTEGER NOT NULL, is_closed INTEGER NOT NULL,
            PRIMARY KEY(symbol, timeframe, open_time)
        );
        CREATE INDEX IF NOT EXISTS idx_market_candles_time ON market_candles(symbol, timeframe, open_time);
        CREATE TABLE IF NOT EXISTS technical_levels (
            uid TEXT PRIMARY KEY, symbol TEXT NOT NULL, kind TEXT NOT NULL, price REAL NOT NULL,
            zone_low REAL NOT NULL, zone_high REAL NOT NULL, timeframe TEXT NOT NULL,
            formation_time INTEGER NOT NULL, first_detected TEXT NOT NULL, last_tested INTEGER NOT NULL,
            touches INTEGER NOT NULL, successful_rejections INTEGER NOT NULL, failed_reactions INTEGER NOT NULL,
            max_rejection REAL NOT NULL, previous_strength REAL NOT NULL, strength REAL NOT NULL,
            status TEXT NOT NULL, breakout_history TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_technical_levels_symbol ON technical_levels(symbol, strength DESC);
        CREATE TABLE IF NOT EXISTS technical_level_touches (
            level_uid TEXT NOT NULL, touch_time INTEGER NOT NULL, successful INTEGER NOT NULL,
            rejection_move REAL NOT NULL, volume REAL NOT NULL,
            PRIMARY KEY(level_uid, touch_time)
        );
        CREATE TABLE IF NOT EXISTS technical_structures (
            uid TEXT PRIMARY KEY, symbol TEXT NOT NULL, structure_type TEXT NOT NULL,
            direction TEXT NOT NULL, timeframe TEXT NOT NULL, start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL, upper REAL NOT NULL, lower REAL NOT NULL,
            status TEXT NOT NULL, score REAL NOT NULL, mitigation REAL NOT NULL,
            details_json TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_technical_structures_symbol ON technical_structures(symbol, structure_type, timeframe);
    """)
    return db


def _request_json(url: str, timeout: int = 20) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "TradeX-Technical-Analysis/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_live_price(symbol: str) -> dict[str, Any]:
    """Fetch a lightweight current futures quote without rebuilding candle analysis."""
    symbol = symbol.upper()
    if symbol not in SUPPORTED_SYMBOLS:
        raise ValueError("Unsupported instrument.")
    ticker = _request_json(f"{BINANCE_FUTURES}/fapi/v1/ticker/price?symbol={urllib.parse.quote(symbol)}", timeout=8)
    return {"symbol": symbol, "price": float(ticker["price"]),
            "updated_at": datetime.now(timezone.utc).isoformat(), "source": "Binance USDⓈ-M live ticker"}


def _get_market_data(symbol: str, timeframe: str, limit: int = 500) -> tuple[list[dict[str, Any]], float]:
    query = urllib.parse.urlencode({"symbol": symbol, "interval": timeframe, "limit": limit})
    raw = _request_json(f"{BINANCE_FUTURES}/fapi/v1/klines?{query}")
    candles = [{
        "time": int(row[0]), "open": float(row[1]), "high": float(row[2]),
        "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]),
        "close_time": int(row[6]), "closed": int(row[6]) < int(time.time() * 1000) - 100,
    } for row in raw]
    ticker = _request_json(f"{BINANCE_FUTURES}/fapi/v1/ticker/price?symbol={symbol}")
    return candles, float(ticker["price"])


def warm_long_history(db_path: str, symbol: str) -> None:
    """Persist up to ten years of daily futures candles, bounded by listing age."""
    symbol = symbol.upper()
    now_mono = time.monotonic()
    with _LONG_HISTORY_LOCK:
        if symbol in _LONG_HISTORY_WARMING or now_mono - _LONG_HISTORY_LAST.get(symbol, 0) < 6 * 60 * 60:
            return
        _LONG_HISTORY_WARMING.add(symbol)
        _LONG_HISTORY_LAST[symbol] = now_mono
    db = None
    try:
        db = _open_db(db_path)
        now_ms = int(time.time() * 1000)
        oldest = now_ms - LONG_HISTORY_DAYS * 86_400_000
        row = db.execute("SELECT MIN(open_time) FROM market_candles WHERE symbol=? AND timeframe='1d'", (symbol,)).fetchone()
        # Existing daily history begins early enough; only fetch if the local
        # range is short or its newest candle is stale.
        local_oldest = int(row[0]) if row and row[0] is not None else None
        local_latest_row = db.execute("SELECT MAX(open_time) FROM market_candles WHERE symbol=? AND timeframe='1d'", (symbol,)).fetchone()
        local_latest = int(local_latest_row[0]) if local_latest_row and local_latest_row[0] is not None else 0
        if local_oldest is not None and local_oldest <= oldest + 45 * 86_400_000 and local_latest >= now_ms - 3 * 86_400_000:
            return
        cursor = oldest
        batch: list[tuple[Any, ...]] = []
        while cursor < now_ms:
            query = urllib.parse.urlencode({"symbol": symbol, "interval": "1d", "startTime": cursor, "endTime": now_ms, "limit": 1500})
            rows = _request_json(f"{BINANCE_FUTURES}/fapi/v1/klines?{query}", timeout=30)
            if not rows:
                break
            for raw in rows:
                opened, closed = int(raw[0]), int(raw[6])
                batch.append((symbol, "1d", opened, float(raw[1]), float(raw[2]), float(raw[3]), float(raw[4]), float(raw[5]), closed, int(closed < now_ms - 100)))
            last_open = int(rows[-1][0])
            next_cursor = last_open + 86_400_000
            if next_cursor <= cursor or len(rows) < 1500:
                cursor = next_cursor
                break
            cursor = next_cursor
        if batch:
            db.executemany("""INSERT INTO market_candles VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(symbol,timeframe,open_time) DO UPDATE SET open=excluded.open,high=excluded.high,
                low=excluded.low,close=excluded.close,volume=excluded.volume,close_time=excluded.close_time,is_closed=excluded.is_closed""", batch)
            cutoff = now_ms - (LONG_HISTORY_DAYS + 30) * 86_400_000
            db.execute("DELETE FROM market_candles WHERE symbol=? AND timeframe='1d' AND open_time<?", (symbol, cutoff))
            db.commit()
    except Exception:
        # Preserve usable live analysis when the archive endpoint is unavailable.
        pass
    finally:
        if db is not None:
            db.close()
        with _LONG_HISTORY_LOCK:
            _LONG_HISTORY_WARMING.discard(symbol)


def get_long_term_context(db_path: str, symbol: str) -> dict[str, Any]:
    """Summarize the locally stored daily history and report its actual coverage."""
    db = _open_db(db_path)
    try:
        rows = db.execute("SELECT open_time,high,low,close FROM market_candles WHERE symbol=? AND timeframe='1d' AND is_closed=1 ORDER BY open_time", (symbol.upper(),)).fetchall()
    finally:
        db.close()
    if not rows:
        with _LONG_HISTORY_LOCK:
            downloading = symbol.upper() in _LONG_HISTORY_WARMING
        return {"target_years": 10, "coverage_years": 0, "coverage_complete": False,
                "trend_bias": "unavailable", "candle_count": 0, "backfill_in_progress": downloading}
    first_time, last_time = int(rows[0][0]), int(rows[-1][0])
    first_close, last_close = float(rows[0][3]), float(rows[-1][3])
    coverage_years = max(0.0, (last_time - first_time) / (365.25 * 86_400_000))
    closes = [float(row[3]) for row in rows]
    sma_200 = sum(closes[-200:]) / min(200, len(closes)) if len(closes) >= 200 else None
    year_return = ((last_close / closes[-min(252, len(closes))] - 1) * 100) if len(closes) >= 2 else 0.0
    trend_bias = "bullish" if sma_200 and last_close > sma_200 and year_return > 0 else "bearish" if sma_200 and last_close < sma_200 and year_return < 0 else "neutral"
    yearly: dict[str, dict[str, float]] = {}
    for row in rows:
        year = datetime.fromtimestamp(int(row[0]) / 1000, timezone.utc).strftime("%Y")
        item = yearly.setdefault(year, {"high": float(row[1]), "low": float(row[2])})
        item["high"] = max(item["high"], float(row[1]))
        item["low"] = min(item["low"], float(row[2]))
    with _LONG_HISTORY_LOCK:
        downloading = symbol.upper() in _LONG_HISTORY_WARMING
    return {"target_years": 10, "coverage_years": round(coverage_years, 2),
            "coverage_complete": coverage_years >= 9.9,
            "backfill_in_progress": downloading,
            "start_time": first_time, "end_time": last_time,
            "start_date": datetime.fromtimestamp(first_time / 1000, timezone.utc).date().isoformat(),
            "end_date": datetime.fromtimestamp(last_time / 1000, timezone.utc).date().isoformat(),
            "candle_count": len(rows), "ten_year_high": max(float(row[1]) for row in rows),
            "ten_year_low": min(float(row[2]) for row in rows),
            "sma_200": sma_200, "year_return_pct": round(year_return, 2),
            "trend_bias": trend_bias, "yearly_ranges": yearly}


def _atr(candles: list[dict[str, Any]], period: int = 14) -> float:
    if not candles:
        return 0.0
    ranges = []
    for i, candle in enumerate(candles):
        prev = candles[i - 1]["close"] if i else candle["close"]
        ranges.append(max(candle["high"] - candle["low"], abs(candle["high"] - prev), abs(candle["low"] - prev)))
    return sum(ranges[-period:]) / max(1, len(ranges[-period:]))


def _swings(candles: list[dict[str, Any]], side: str, left: int = 2, right: int = 2) -> list[dict[str, Any]]:
    field = "high" if side == "high" else "low"
    found = []
    for i in range(left, len(candles) - right):
        value = candles[i][field]
        window = [c[field] for c in candles[i - left:i + right + 1]]
        if side == "high" and value == max(window) and window.count(value) == 1:
            found.append({"index": i, "time": candles[i]["time"], "price": value, "volume": candles[i]["volume"]})
        elif side == "low" and value == min(window) and window.count(value) == 1:
            found.append({"index": i, "time": candles[i]["time"], "price": value, "volume": candles[i]["volume"]})
    return found


def _uid(*parts: Any) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:24]


def _detect_levels(symbol: str, timeframe: str, candles: list[dict[str, Any]], current: float, atr: float,
                   highs: list[dict[str, Any]], lows: list[dict[str, Any]], db: sqlite3.Connection) -> list[dict[str, Any]]:
    generated = []
    typical_volume = median([c["volume"] for c in candles[-100:]]) if candles else 0
    tolerance = max(atr * 0.32, current * 0.00045)
    for kind, pivots in (("resistance", highs), ("support", lows)):
        groups: list[list[dict[str, Any]]] = []
        for pivot in pivots:
            match = next((g for g in groups if abs(pivot["price"] - sum(x["price"] for x in g) / len(g)) <= tolerance), None)
            if match is None:
                groups.append([pivot])
            else:
                match.append(pivot)
        for group in groups:
            price = sum(p["price"] for p in group) / len(group)
            reactions, failed, max_rejection = 0, 0, 0.0
            for pivot in group:
                later = candles[pivot["index"] + 1:pivot["index"] + 7]
                if not later:
                    continue
                if kind == "support":
                    move = max((c["high"] - price for c in later), default=0)
                    broke = any(c["close"] < price - tolerance for c in later)
                else:
                    move = max((price - c["low"] for c in later), default=0)
                    broke = any(c["close"] > price + tolerance for c in later)
                rejected = move >= max(atr * 0.75, tolerance * 1.5) and not broke
                reactions += int(rejected)
                failed += int(broke)
                max_rejection = max(max_rejection, move)
                db.execute("INSERT OR IGNORE INTO technical_level_touches VALUES (?, ?, ?, ?, ?)",
                           (_uid(symbol, timeframe, kind, round(pivot["price"], 1)), pivot["time"], int(rejected), move, pivot["volume"]))
            # Stable key is anchored to the oldest detected pivot in this cluster.
            anchor = group[0]
            level_id = _uid(symbol, timeframe, kind, round(anchor["price"], 1))
            # Re-key observations if a cluster's mean has shifted since first detection.
            old_ids = [_uid(symbol, timeframe, kind, round(p["price"], 1)) for p in group]
            for old_id in old_ids:
                if old_id != level_id:
                    db.execute("INSERT OR IGNORE INTO technical_level_touches SELECT ?, touch_time, successful, rejection_move, volume FROM technical_level_touches WHERE level_uid=?", (level_id, old_id))
            touch_data = db.execute("SELECT COUNT(*), SUM(successful), SUM(CASE WHEN successful=0 THEN 1 ELSE 0 END), MAX(rejection_move), MAX(touch_time) FROM technical_level_touches WHERE level_uid=?", (level_id,)).fetchone()
            touch_count = max(len(group), int(touch_data[0] or 0))
            successful = max(reactions, int(touch_data[1] or 0))
            failed_count = max(failed, int(touch_data[2] or 0))
            max_move = max(max_rejection, float(touch_data[3] or 0))
            last_tested = max(group[-1]["time"], int(touch_data[4] or 0))
            reaction_score = min(SCORING["reactions"], touch_count * 5)
            rejection_score = min(SCORING["rejection"], (max_move / max(atr, 1e-9)) * 7)
            volume_score = min(SCORING["volume"], 7.5 * (sum(p["volume"] for p in group) / max(typical_volume * len(group), 1e-9)))
            recency_days = max(0, (int(time.time() * 1000) - last_tested) / 86400000)
            recency_score = SCORING["recency"] * math.exp(-recency_days / 45)
            retest_score = min(SCORING["retest"], successful * 2) - min(4, failed_count)
            higher_timeframe_score = SCORING["timeframe"] * TF_WEIGHT[timeframe] / 20
            related = db.execute("SELECT timeframe, price FROM technical_levels WHERE symbol=? AND kind=? AND uid<>?", (symbol, kind, level_id)).fetchall()
            confluence_frames = sorted({row[0] for row in related
                                        if abs(float(row[1]) - price) <= max(tolerance, price * 0.001)})
            confluence_score = min(SCORING["confluence"], len(confluence_frames) * 3.5)
            strength = max(0, min(100, round(reaction_score + higher_timeframe_score + rejection_score + volume_score + recency_score + retest_score + confluence_score)))
            half_zone = max(tolerance * 0.28, current * 0.00012)
            existing = db.execute("SELECT strength, status, breakout_history, first_detected FROM technical_levels WHERE uid=?", (level_id,)).fetchone()
            previous_strength = float(existing[0]) if existing else strength
            history = json.loads(existing[2]) if existing else []
            last_two = candles[-2:]
            broken = len(last_two) == 2 and all((c["close"] < price - tolerance if kind == "support" else c["close"] > price + tolerance) for c in last_two)
            retested_after_break = broken and any((c["low"] <= price + tolerance if kind == "support" else c["high"] >= price - tolerance) for c in candles[-8:])
            if broken:
                status = "FLIPPED" if retested_after_break else "BROKEN"
                if not history or history[-1].get("status") != status:
                    history.append({"time": int(time.time() * 1000), "status": status, "close": last_two[-1]["close"]})
            elif failed_count >= max(2, successful + 1):
                status = "WEAKENING"
            elif last_tested >= int(time.time() * 1000) - 3 * _tf_ms(timeframe) and successful:
                status = "STRENGTHENING"
            else:
                status = "ACTIVE"
            if recency_days > 60 or abs(current - price) / max(current, 1e-9) > 0.18:
                status = "HISTORICAL"
            first_detected = existing[3] if existing else datetime.now(timezone.utc).isoformat()
            db.execute("""INSERT INTO technical_levels VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(uid) DO UPDATE SET price=excluded.price,zone_low=excluded.zone_low,zone_high=excluded.zone_high,
                last_tested=MAX(technical_levels.last_tested,excluded.last_tested),touches=MAX(technical_levels.touches,excluded.touches),
                successful_rejections=MAX(technical_levels.successful_rejections,excluded.successful_rejections),
                failed_reactions=MAX(technical_levels.failed_reactions,excluded.failed_reactions),max_rejection=MAX(technical_levels.max_rejection,excluded.max_rejection),
                previous_strength=technical_levels.strength,strength=excluded.strength,status=excluded.status,
                breakout_history=excluded.breakout_history,updated_at=excluded.updated_at""",
                (level_id, symbol, kind, price, price - half_zone, price + half_zone, timeframe,
                 anchor["time"], first_detected, last_tested, touch_count, successful, failed_count,
                 max_move, previous_strength, strength, status, json.dumps(history), datetime.now(timezone.utc).isoformat()))
            generated.append({"uid": level_id, "symbol": symbol, "kind": kind, "price": price,
                              "zone_low": price - half_zone, "zone_high": price + half_zone,
                              "timeframe": timeframe, "formation_time": anchor["time"], "first_detected": first_detected,
                              "last_tested": last_tested, "touches": touch_count, "successful_rejections": successful,
                              "failed_reactions": failed_count, "max_rejection": max_move,
                              "previous_strength": previous_strength, "strength": strength, "status": status,
                              "distance": abs(current - price), "breakout_history": history,
                              "confluence_timeframes": confluence_frames})
    return generated


def _tf_ms(timeframe: str) -> int:
    if timeframe.endswith("m"):
        return int(timeframe[:-1]) * 60000
    if timeframe.endswith("h"):
        return int(timeframe[:-1]) * 3600000
    return int(timeframe[:-1]) * 86400000


def _detect_fvgs(symbol: str, timeframe: str, candles: list[dict[str, Any]], atr: float,
                 nearby_levels: list[dict[str, Any]], db: sqlite3.Connection) -> list[dict[str, Any]]:
    results = []
    for i in range(2, len(candles)):
        first, middle, third = candles[i - 2], candles[i - 1], candles[i]
        direction, lower, upper = None, 0.0, 0.0
        if third["low"] > first["high"]:
            direction, lower, upper = "bullish", first["high"], third["low"]
        elif third["high"] < first["low"]:
            direction, lower, upper = "bearish", third["high"], first["low"]
        if not direction:
            continue
        future = candles[i + 1:]
        span = max(upper - lower, 1e-9)
        if direction == "bullish":
            penetration = max([0.0] + [(upper - c["low"]) / span for c in future])
            invalidated = any(c["close"] < lower for c in future)
        else:
            penetration = max([0.0] + [(c["high"] - lower) / span for c in future])
            invalidated = any(c["close"] > upper for c in future)
        mitigation = min(100, max(0, round(penetration * 100, 1)))
        status = "INVALIDATED" if invalidated else ("FULLY FILLED" if mitigation >= 100 else "PARTIALLY FILLED" if mitigation > 0 else "FRESH / UNTOUCHED")
        displacement = abs(middle["close"] - middle["open"]) / max(atr, 1e-9)
        confluence = any(l["zone_low"] <= upper and l["zone_high"] >= lower for l in nearby_levels)
        score = min(100, round(35 + min(35, displacement * 16) + min(20, span / max(atr, 1e-9) * 12) + (10 if confluence else 0)))
        uid = _uid(symbol, timeframe, "fvg", first["time"], round(lower, 4), round(upper, 4))
        item = {"uid": uid, "symbol": symbol, "type": "fvg", "direction": direction,
                "timeframe": timeframe, "start_time": first["time"], "end_time": third["time"],
                "lower": lower, "upper": upper, "status": status, "score": score,
                "mitigation": mitigation, "formation_time": third["time"], "confluence": confluence}
        results.append(item)
    results = results[-120:]
    _store_structures(db, results)
    return results


def _detect_trendlines(symbol: str, timeframe: str, candles: list[dict[str, Any]], highs: list[dict[str, Any]],
                       lows: list[dict[str, Any]], atr: float, db: sqlite3.Connection) -> list[dict[str, Any]]:
    out = []
    for direction, pivots, kind in (("bullish", lows, "support"), ("bearish", highs, "resistance")):
        candidates = pivots[-8:]
        if len(candidates) < 2:
            continue
        a, b = candidates[-2], candidates[-1]
        slope = (b["price"] - a["price"]) / max(1, b["index"] - a["index"])
        if (direction == "bullish" and slope <= 0) or (direction == "bearish" and slope >= 0):
            continue
        touches = 2
        for point in candidates[:-2]:
            projected = a["price"] + slope * (point["index"] - a["index"])
            if abs(point["price"] - projected) <= atr * 0.45:
                touches += 1
        score = min(100, 40 + touches * 12 + TF_WEIGHT[timeframe])
        start, end = a["time"], candles[-1]["time"]
        end_price = a["price"] + slope * (len(candles) - 1 - a["index"])
        status = "BROKEN" if (direction == "bullish" and candles[-1]["close"] < end_price - atr * 0.4) or (direction == "bearish" and candles[-1]["close"] > end_price + atr * 0.4) else "ACTIVE"
        item = {"uid": _uid(symbol, timeframe, "trendline", direction, a["time"], b["time"]),
                "symbol": symbol, "type": "trendline", "direction": direction, "timeframe": timeframe,
                "start_time": start, "end_time": end, "lower": min(a["price"], end_price),
                "upper": max(a["price"], end_price), "start_price": a["price"], "end_price": end_price,
                "status": status, "score": score, "touches": touches, "line_kind": kind}
        out.append(item)
        opposite = highs if direction == "bullish" else lows
        channel_offsets = []
        for point in opposite[-10:]:
            base_at_point = a["price"] + slope * (point["index"] - a["index"])
            offset = point["price"] - base_at_point if direction == "bullish" else base_at_point - point["price"]
            if offset > atr * 0.5:
                channel_offsets.append((point, offset))
        if len(channel_offsets) >= 2:
            channel_width = median([x[1] for x in channel_offsets])
            channel_touches = sum(abs(offset - channel_width) <= atr * 0.8 for _, offset in channel_offsets)
            if channel_touches >= 2:
                base_end = a["price"] + slope * (len(candles) - 1 - a["index"])
                if direction == "bullish":
                    lower_start, lower_end = a["price"], base_end
                    upper_start, upper_end = a["price"] + channel_width, base_end + channel_width
                else:
                    upper_start, upper_end = a["price"], base_end
                    lower_start, lower_end = a["price"] - channel_width, base_end - channel_width
                channel_status = "BROKEN" if (direction == "bullish" and candles[-1]["close"] < lower_end - atr * 0.4) or (direction == "bearish" and candles[-1]["close"] > upper_end + atr * 0.4) else "ACTIVE"
                out.append({"uid": _uid(symbol, timeframe, "channel", direction, a["time"], b["time"]),
                            "symbol": symbol, "type": "channel", "direction": direction, "timeframe": timeframe,
                            "start_time": start, "end_time": end, "lower": min(lower_start, lower_end),
                            "upper": max(upper_start, upper_end), "lower_start": lower_start, "lower_end": lower_end,
                            "upper_start": upper_start, "upper_end": upper_end, "status": channel_status,
                            "score": min(100, score + 8), "touches": channel_touches + touches, "width": channel_width})
    _store_structures(db, out)
    return out


def _detect_zones(symbol: str, timeframe: str, candles: list[dict[str, Any]], atr: float, db: sqlite3.Connection) -> list[dict[str, Any]]:
    zones = []
    for i in range(3, len(candles)):
        impulse = candles[i]
        body = abs(impulse["close"] - impulse["open"])
        if body < atr * 1.65:
            continue
        direction = "demand" if impulse["close"] > impulse["open"] else "supply"
        base = candles[max(0, i - 3):i]
        base = [c for c in base if abs(c["close"] - c["open"]) <= atr * 0.75]
        if not base:
            continue
        lower, upper = min(c["low"] for c in base), max(c["high"] for c in base)
        score = min(100, round(40 + min(35, body / max(atr, 1e-9) * 13) + TF_WEIGHT[timeframe]))
        later = candles[i + 1:]
        tested = any(c["low"] <= upper and c["high"] >= lower for c in later)
        invalid = any(c["close"] < lower if direction == "demand" else c["close"] > upper for c in later)
        status = "INVALIDATED" if invalid else "TESTED" if tested else "FRESH"
        zones.append({"uid": _uid(symbol, timeframe, direction, base[0]["time"], round(lower, 3), round(upper, 3)),
                      "symbol": symbol, "type": "zone", "direction": direction, "timeframe": timeframe,
                      "start_time": base[0]["time"], "end_time": candles[-1]["time"], "lower": lower,
                      "upper": upper, "status": status, "score": score, "mitigation": 100 if invalid else 50 if tested else 0})
    zones = zones[-40:]
    _store_structures(db, zones)
    return zones


def _store_structures(db: sqlite3.Connection, structures: list[dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for item in structures:
        db.execute("""INSERT INTO technical_structures VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(uid) DO UPDATE SET end_time=excluded.end_time,status=excluded.status,score=excluded.score,
            mitigation=excluded.mitigation,details_json=excluded.details_json,updated_at=excluded.updated_at""",
            (item["uid"], item["symbol"], item["type"], item["direction"], item["timeframe"],
             item["start_time"], item["end_time"], item["upper"], item["lower"], item["status"],
             item["score"], item.get("mitigation", 0), json.dumps(item), now))


def _market_structure(candles: list[dict[str, Any]], highs: list[dict[str, Any]], lows: list[dict[str, Any]], atr: float) -> dict[str, Any]:
    events = []
    for side, pivots in (("high", highs), ("low", lows)):
        for prev, curr in zip(pivots, pivots[1:]):
            label = ("HH" if curr["price"] > prev["price"] else "LH") if side == "high" else ("HL" if curr["price"] > prev["price"] else "LL")
            events.append({"time": curr["time"], "price": curr["price"], "label": label})
    events.sort(key=lambda x: x["time"])
    last_high, last_low = (highs[-1] if highs else None), (lows[-1] if lows else None)
    last = candles[-1] if candles else {"close": 0, "time": 0}
    latest_high_label = next((event["label"] for event in reversed(events) if event["label"] in ("HH", "LH")), None)
    latest_low_label = next((event["label"] for event in reversed(events) if event["label"] in ("HL", "LL")), None)
    previous_trend = "bullish" if latest_high_label == "HH" and latest_low_label == "HL" else "bearish" if latest_high_label == "LH" and latest_low_label == "LL" else "neutral"
    break_event = None
    if last_high and last["close"] > last_high["price"] + atr * 0.1:
        break_event = {"time": last["time"], "price": last_high["price"], "label": "BOS" if previous_trend == "bullish" else "CHOCH", "direction": "bullish"}
    elif last_low and last["close"] < last_low["price"] - atr * 0.1:
        break_event = {"time": last["time"], "price": last_low["price"], "label": "BOS" if previous_trend == "bearish" else "CHOCH", "direction": "bearish"}
    if break_event:
        events.append(break_event)
        previous_trend = break_event["direction"]
    return {"trend": previous_trend, "events": events[-35:], "swing_high": last_high,
            "swing_low": last_low, "break_event": break_event,
            "latest_high_label": latest_high_label, "latest_low_label": latest_low_label}


def _load_stored_levels(db: sqlite3.Connection, symbol: str, price: float) -> list[dict[str, Any]]:
    rows = db.execute("SELECT * FROM technical_levels WHERE symbol=? ORDER BY strength DESC", (symbol,)).fetchall()
    data = [dict(r) for r in rows]
    for item in data:
        item["breakout_history"] = json.loads(item["breakout_history"] or "[]")
        item["distance"] = abs(price - item["price"])
        age_days = max(0, (int(time.time() * 1000) - item["last_tested"]) / 86400000)
        if age_days > 60 or item["distance"] / max(price, 1e-9) > 0.18:
            item["status"] = "HISTORICAL"
        tolerance = max(price * 0.001, item["zone_high"] - item["zone_low"])
        confluence = sorted({x["timeframe"] for x in data if x["uid"] != item["uid"]
                             and x["kind"] == item["kind"]
                             and abs(x["price"] - item["price"]) <= tolerance})
        item["confluence_timeframes"] = confluence
        item["strength"] = min(100, item["strength"] + min(10, len(confluence) * 3))
    selected = []
    for kind in ("support", "resistance"):
        groups: list[list[dict[str, Any]]] = []
        for item in sorted((x for x in data if x["kind"] == kind), key=lambda x: (-x["strength"], x["distance"])):
            tol = max(price * 0.001, item["zone_high"] - item["zone_low"])
            group = next((g for g in groups if abs(g[0]["price"] - item["price"]) <= tol), None)
            if group is None:
                groups.append([item])
            else:
                group.append(item)
        ranked = []
        for group in groups:
            representative = dict(group[0])
            frames = sorted({x["timeframe"] for x in group})
            representative["confluence_timeframes"] = frames
            representative["touches"] = max(x["touches"] for x in group)
            representative["successful_rejections"] = max(x["successful_rejections"] for x in group)
            representative["strength"] = min(100, max(x["strength"] for x in group) + min(10, max(0, len(frames) - 1) * 3))
            ranked.append(representative)
        selected.extend(sorted(ranked, key=lambda x: (-x["strength"], x["distance"]))[:5])
    return selected


def warm_multi_timeframe(db_path: str, symbol: str) -> None:
    """Fill persistent history/levels for every supported timeframe once per symbol."""
    symbol = symbol.upper()
    with _WARMING_LOCK:
        if symbol in _WARMING or symbol in _WARMED:
            return
        _WARMING.add(symbol)
    try:
        for timeframe in sorted(TIMEFRAMES, key=_tf_ms):
            try:
                analyze_market(db_path, symbol, timeframe, refresh_seconds=300)
            except Exception:
                continue
    finally:
        with _WARMING_LOCK:
            _WARMING.discard(symbol)
            _WARMED.add(symbol)


def get_timeframe_biases(db_path: str, symbol: str) -> dict[str, str]:
    """Summarize confirmed swing direction from candle history already stored per timeframe."""
    db = _open_db(db_path)
    try:
        result = {}
        for timeframe in sorted(TIMEFRAMES, key=_tf_ms):
            rows = db.execute("SELECT open_time,open,high,low,close,volume,close_time,is_closed FROM market_candles WHERE symbol=? AND timeframe=? ORDER BY open_time DESC LIMIT 500", (symbol.upper(), timeframe)).fetchall()
            candles = [{"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5], "close_time": r[6], "closed": bool(r[7])} for r in reversed(rows) if r[7]]
            highs, lows = _swings(candles, "high"), _swings(candles, "low")
            if len(highs) < 2 or len(lows) < 2:
                continue
            high_up = highs[-1]["price"] > highs[-2]["price"]
            low_up = lows[-1]["price"] > lows[-2]["price"]
            high_down = highs[-1]["price"] < highs[-2]["price"]
            low_down = lows[-1]["price"] < lows[-2]["price"]
            result[timeframe] = "bullish" if high_up and low_up else "bearish" if high_down and low_down else "neutral"
        return result
    finally:
        db.close()


def analyze_market(db_path: str, symbol: str, timeframe: str, refresh_seconds: int = 20) -> dict[str, Any]:
    symbol, timeframe = symbol.upper(), timeframe.lower()
    if symbol not in SUPPORTED_SYMBOLS:
        raise ValueError("Unsupported instrument. Choose XAUUSDT, XAGUSDT, BTCUSDT or ETHUSDT.")
    if timeframe not in TIMEFRAMES:
        raise ValueError("Unsupported timeframe. Choose 1m, 5m, 15m, 1h, 4h or 1d.")
    cache_key = (symbol, timeframe)
    now_mono = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now_mono - cached[0] < refresh_seconds:
            return cached[1]
    db = _open_db(db_path)
    warning = ""
    current = 0.0
    try:
        try:
            candles, current = _get_market_data(symbol, timeframe)
            db.executemany("""INSERT INTO market_candles VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(symbol,timeframe,open_time) DO UPDATE SET open=excluded.open,high=excluded.high,
                low=excluded.low,close=excluded.close,volume=excluded.volume,close_time=excluded.close_time,is_closed=excluded.is_closed""",
                [(symbol, timeframe, c["time"], c["open"], c["high"], c["low"], c["close"], c["volume"], c["close_time"], int(c["closed"])) for c in candles])
            retention_ms = (LONG_HISTORY_DAYS + 30) * 86_400_000 if timeframe == "1d" else _tf_ms(timeframe) * 3000
            db.execute("DELETE FROM market_candles WHERE symbol=? AND timeframe=? AND open_time < (SELECT MAX(open_time) FROM market_candles WHERE symbol=? AND timeframe=?)-?",
                       (symbol, timeframe, symbol, timeframe, retention_ms))
            db.commit()
        except Exception as exc:
            warning = f"Live Binance feed unavailable; showing saved candles. {exc}"
            current = 0.0
        stored = db.execute("SELECT open_time,open,high,low,close,volume,close_time,is_closed FROM market_candles WHERE symbol=? AND timeframe=? ORDER BY open_time DESC LIMIT 1200", (symbol, timeframe)).fetchall()
        candles = [{"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5], "close_time": r[6], "closed": bool(r[7])} for r in reversed(stored)]
        if not candles:
            raise RuntimeError(warning or "No historical candles are available yet.")
        if not current:
            current = candles[-1]["close"]
        confirmed = [c for c in candles if c["closed"]]
        forming = next((c for c in reversed(candles) if not c["closed"]), None)
        if len(confirmed) < 12:
            raise RuntimeError("Not enough closed candles to analyse this timeframe.")
        atr = _atr(confirmed)
        highs, lows = _swings(confirmed, "high"), _swings(confirmed, "low")
        levels_found = _detect_levels(symbol, timeframe, confirmed, current, atr, highs, lows, db)
        structures = _detect_fvgs(symbol, timeframe, confirmed, atr, levels_found, db)
        trendlines = _detect_trendlines(symbol, timeframe, confirmed, highs, lows, atr, db)
        zones = _detect_zones(symbol, timeframe, confirmed, atr, db)
        structure = _market_structure(confirmed, highs, lows, atr)
        db.commit()
        stored_levels = _load_stored_levels(db, symbol, current)
        # Persist every detected record, but only send a restrained, ranked set
        # to the overlay so successive small gaps don't obscure the candles.
        def proximity(item: dict[str, Any]) -> float:
            return abs((item["upper"] + item["lower"]) / 2 - current) / max(current, 1e-9)
        visible_fvgs = sorted((x for x in structures if x["status"] != "INVALIDATED"),
                              key=lambda x: (x["status"] == "FRESH / UNTOUCHED", x["score"], -proximity(x)), reverse=True)[:12]
        visible_zones = sorted(zones, key=lambda x: (x["status"] == "FRESH", x["score"], -proximity(x)), reverse=True)[:6]
        visible_trendlines = sorted((x for x in trendlines if x["type"] == "trendline"), key=lambda x: (x["status"] == "ACTIVE", x["score"]), reverse=True)[:2]
        visible_channels = sorted((x for x in trendlines if x["type"] == "channel"), key=lambda x: (x["status"] == "ACTIVE", x["score"]), reverse=True)[:2]
        structures = visible_fvgs + visible_trendlines + visible_channels + visible_zones
        response = {"symbol": symbol, "timeframe": timeframe, "current_price": current,
                    "updated_at": datetime.now(timezone.utc).isoformat(), "warning": warning,
                    "candles": candles, "forming_candle": forming, "atr": atr,
                    "levels": stored_levels, "structures": structures,
                    "market_structure": structure, "score_weights": SCORING,
                    "scoring_note": "Heuristic structure scores; tune the weights against saved historical candles."}
        evaluation = db.execute("SELECT COUNT(*), COALESCE(SUM(successful),0), COALESCE(AVG(rejection_move),0) FROM technical_level_touches WHERE level_uid IN (SELECT uid FROM technical_levels WHERE symbol=?)", (symbol,)).fetchone()
        total_tests = int(evaluation[0] or 0)
        response["historical_evaluation"] = {"tests": total_tests,
            "successful_reactions": int(evaluation[1] or 0),
            "success_rate": round(100 * float(evaluation[1] or 0) / total_tests, 1) if total_tests else None,
            "average_rejection": round(float(evaluation[2] or 0), 4),
            "note": "Historical confirmed swing reactions; descriptive validation, not a predictive guarantee."}
        with _CACHE_LOCK:
            _CACHE[cache_key] = (time.monotonic(), response)
        return response
    finally:
        db.close()
