"""Public historical OHLCV ingestion for the GoldLiquidity dashboard."""
from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, time as day_time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
MAX_CANDLES = 60_000
CACHE_SECONDS = 60
_CACHE: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
_CACHE_LOCK = threading.RLock()

TIMEFRAMES = {
    "1m": {"ms": 60_000, "binance": "1m", "bybit": "1", "okx": "1m", "gate": "1m"},
    "5m": {"ms": 300_000, "binance": "5m", "bybit": "5", "okx": "5m", "gate": "5m"},
    "15m": {"ms": 900_000, "binance": "15m", "bybit": "15", "okx": "15m", "gate": "15m"},
    "30m": {"ms": 1_800_000, "binance": "30m", "bybit": "30", "okx": "30m", "gate": "30m"},
    "1h": {"ms": 3_600_000, "binance": "1h", "bybit": "60", "okx": "1H", "gate": "1h"},
    "4h": {"ms": 14_400_000, "binance": "4h", "bybit": "240", "okx": "4H", "gate": "4h"},
    "6h": {"ms": 21_600_000, "binance": "6h", "bybit": "360", "okx": "6Hutc", "gate": "6h"},
    "12h": {"ms": 43_200_000, "binance": "12h", "bybit": "720", "okx": "12Hutc", "gate": "12h"},
    "1d": {"ms": 86_400_000, "binance": "1d", "bybit": "D", "okx": "1Dutc", "gate": "1d"},
}
EXCHANGES = {"binance", "bybit", "okx", "gate"}
SYMBOLS = {
    "binance": "PAXGUSDT",
    "bybit": "XAUUSDT",
    "okx": "XAU-USDT-SWAP",
    "gate": "XAU_USDT",
}


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={
        "User-Agent": "TradeX-GoldLiquidity/1.0",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Exchange request failed: {exc}") from exc


def _url(base: str, params: dict[str, Any]) -> str:
    return base + "?" + urllib.parse.urlencode(params)


def _to_candle(open_time: Any, open_: Any, high: Any, low: Any, close: Any, volume: Any,
               interval_ms: int) -> dict[str, float | int]:
    return {
        "time": int(open_time),
        "open": float(open_),
        "high": float(high),
        "low": float(low),
        "close": float(close),
        "volume": float(volume or 0),
        "close_time": int(open_time) + interval_ms - 1,
    }


def _fetch_binance(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    cursor = start_ms
    while cursor <= end_ms and len(result) < MAX_CANDLES:
        payload = _get_json(_url("https://api.binance.com/api/v3/klines", {
            "symbol": symbol, "interval": interval, "startTime": cursor,
            "endTime": end_ms, "limit": 1000,
        }))
        if not isinstance(payload, list) or not payload:
            break
        page = [_to_candle(row[0], row[1], row[2], row[3], row[4], row[5], TIMEFRAMES_INV[interval]["ms"])
                for row in payload if len(row) >= 7]
        if not page:
            break
        result.extend(page)
        next_cursor = max(c["time"] for c in page) + TIMEFRAMES_INV[interval]["ms"]
        if next_cursor <= cursor:
            break
        cursor = next_cursor
    return result


def _fetch_bybit(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    cursor_end = end_ms
    interval_ms = next(v["ms"] for v in TIMEFRAMES.values() if v["bybit"] == interval)
    while cursor_end >= start_ms and len(result) < MAX_CANDLES:
        payload = _get_json(_url("https://api.bybit.com/v5/market/kline", {
            "category": "linear", "symbol": symbol, "interval": interval,
            "start": start_ms, "end": cursor_end, "limit": 1000,
        }))
        if payload.get("retCode") != 0:
            raise RuntimeError(payload.get("retMsg") or "Bybit returned an error")
        rows = (payload.get("result") or {}).get("list") or []
        if not rows:
            break
        page = [_to_candle(row[0], row[1], row[2], row[3], row[4], row[5], interval_ms)
                for row in rows if len(row) >= 6]
        result.extend(page)
        oldest = min(c["time"] for c in page)
        if oldest <= start_ms or oldest >= cursor_end:
            break
        cursor_end = oldest - 1
    return result


def _fetch_okx(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    cursor = end_ms + 1
    interval_ms = next(v["ms"] for v in TIMEFRAMES.values() if v["okx"] == interval)
    while cursor > start_ms and len(result) < MAX_CANDLES:
        payload = _get_json(_url("https://www.okx.com/api/v5/market/history-candles", {
            "instId": symbol, "bar": interval, "after": cursor, "limit": 300,
        }))
        if payload.get("code") != "0":
            raise RuntimeError(payload.get("msg") or "OKX returned an error")
        rows = payload.get("data") or []
        if not rows:
            break
        page = [_to_candle(row[0], row[1], row[2], row[3], row[4], row[5], interval_ms)
                for row in rows if len(row) >= 6]
        result.extend(page)
        oldest = min(c["time"] for c in page)
        if oldest <= start_ms or oldest >= cursor:
            break
        cursor = oldest
    return result


def _fetch_gate(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    interval_ms = next(v["ms"] for v in TIMEFRAMES.values() if v["gate"] == interval)
    cursor = start_ms
    page_seconds = interval_ms // 1000 * 1999
    while cursor <= end_ms and len(result) < MAX_CANDLES:
        page_end = min(end_ms, cursor + page_seconds)
        payload = _get_json(_url("https://api.gateio.ws/api/v4/futures/usdt/candlesticks", {
            "contract": symbol, "interval": interval,
            "from": cursor // 1000, "to": page_end // 1000, "limit": 2000,
        }))
        if not isinstance(payload, list) or not payload:
            break
        page = []
        for row in payload:
            if isinstance(row, dict):
                page.append(_to_candle(int(row.get("t") or row.get("time")), row["o"], row["h"], row["l"], row["c"], row.get("v", 0), interval_ms))
            elif len(row) >= 6:
                page.append(_to_candle(row[0], row[5], row[3], row[4], row[2], row[1], interval_ms))
        if not page:
            break
        result.extend(page)
        next_cursor = max(c["time"] for c in page) + interval_ms
        if next_cursor <= cursor:
            break
        cursor = next_cursor
    return result


TIMEFRAMES_INV = {value["binance"]: value for value in TIMEFRAMES.values()}


def _date_bounds(start_date: str, end_date: str) -> tuple[int, int]:
    try:
        start = datetime.combine(date.fromisoformat(start_date), day_time.min, IST)
        end = datetime.combine(date.fromisoformat(end_date) + timedelta(days=1), day_time.min, IST)
    except ValueError as exc:
        raise ValueError("Dates must be ISO calendar dates in YYYY-MM-DD format") from exc
    if end <= start:
        raise ValueError("End date must be the same as or later than start date")
    return int(start.astimezone(timezone.utc).timestamp() * 1000), int(end.astimezone(timezone.utc).timestamp() * 1000) - 1


def fetch_candles(exchange: str, timeframe: str, start_date: str, end_date: str) -> dict[str, Any]:
    exchange = exchange.lower().strip()
    timeframe = timeframe.lower().strip()
    if exchange not in EXCHANGES:
        raise ValueError("Select Binance, Bybit, OKX, or Gate.io")
    if timeframe not in TIMEFRAMES:
        raise ValueError("Unsupported timeframe")
    start_ms, end_ms = _date_bounds(start_date, end_date)
    key = (exchange, timeframe, start_ms, end_ms)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return dict(cached[1])

    symbol = SYMBOLS[exchange]
    interval = TIMEFRAMES[timeframe][exchange]
    loaders = {"binance": _fetch_binance, "bybit": _fetch_bybit,
               "okx": _fetch_okx, "gate": _fetch_gate}
    candles = loaders[exchange](symbol, interval, start_ms, end_ms)
    candles = sorted({int(c["time"]): c for c in candles
                      if start_ms <= int(c["time"]) <= end_ms}.values(), key=lambda c: c["time"])
    if len(candles) > MAX_CANDLES:
        raise ValueError(f"This range returned more than {MAX_CANDLES:,} candles. Choose a shorter range or a larger timeframe.")
    if len(candles) >= MAX_CANDLES and candles[-1]["time"] + TIMEFRAMES[timeframe]["ms"] <= end_ms:
        raise ValueError(f"The selected date range exceeds the {MAX_CANDLES:,}-candle download limit. Choose a shorter range or a larger timeframe to cover the full period.")
    if not candles:
        raise RuntimeError(f"No {symbol} candles were returned for {exchange.title()} in that date range. Verify the contract is listed and try another exchange or CSV upload.")
    result = {
        "exchange": exchange,
        "symbol": symbol,
        "timeframe": timeframe,
        "start_date": start_date,
        "end_date": end_date,
        "candles": candles,
        "count": len(candles),
        "source": {
            "binance": "Binance Spot",
            "bybit": "Bybit Linear Perpetual",
            "okx": "OKX USDT Perpetual Swap",
            "gate": "Gate.io USDT Perpetual Futures",
        }[exchange],
    }
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), result)
    return result


def fetch_usd_inr() -> dict[str, Any]:
    payload = _get_json("https://open.er-api.com/v6/latest/USD")
    rate = float(((payload.get("rates") or {}).get("INR")) or 0)
    if rate <= 0:
        raise RuntimeError("The FX service did not return a valid USD/INR rate")
    return {"rate": rate, "source": "ExchangeRate-API open rates", "updated_at": payload.get("time_last_update_utc")}


def fetch_ticker(exchange: str) -> dict[str, Any]:
    exchange = exchange.lower().strip()
    if exchange not in EXCHANGES:
        raise ValueError("Select a supported exchange")
    symbol = SYMBOLS[exchange]
    if exchange == "bybit":
        payload = _get_json(_url("https://api.bybit.com/v5/market/tickers", {"category": "linear", "symbol": symbol}))
        rows = (payload.get("result") or {}).get("list") or []
        if payload.get("retCode") != 0 or not rows:
            raise RuntimeError(payload.get("retMsg") or "Bybit has no ticker for this contract")
        row = rows[0]
        last, high, low = row.get("lastPrice"), row.get("highPrice24h"), row.get("lowPrice24h")
    elif exchange == "binance":
        payload = _get_json(_url("https://api.binance.com/api/v3/ticker/24hr", {"symbol": symbol}))
        last, high, low = payload.get("lastPrice"), payload.get("highPrice"), payload.get("lowPrice")
    elif exchange == "okx":
        payload = _get_json(_url("https://www.okx.com/api/v5/market/ticker", {"instId": symbol}))
        rows = payload.get("data") or []
        if payload.get("code") != "0" or not rows:
            raise RuntimeError(payload.get("msg") or "OKX has no ticker for this contract")
        row = rows[0]
        last, high, low = row.get("last"), row.get("high24h"), row.get("low24h")
    else:
        payload = _get_json(_url("https://api.gateio.ws/api/v4/futures/usdt/tickers", {"contract": symbol}))
        if not isinstance(payload, list) or not payload:
            raise RuntimeError("Gate.io has no ticker for this contract")
        row = payload[0]
        last, high, low = row.get("last"), row.get("high_24h"), row.get("low_24h")
    try:
        return {"exchange": exchange, "symbol": symbol, "last": float(last),
                "high_24h": float(high), "low_24h": float(low),
                "updated_at": datetime.now(timezone.utc).isoformat()}
    except (TypeError, ValueError) as exc:
        raise RuntimeError("The exchange returned an invalid live ticker") from exc
