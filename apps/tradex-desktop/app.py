"""TradeX configurable options-chain dashboard.

This app fetches user-configured public pages and extracts rows with CSS selectors.
Use only sources you are permitted to access; respect each site's rate limits/terms.
"""
from __future__ import annotations

import json
import csv
import os
import queue
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

# Prefer IPv4 to avoid macOS LibreSSL IPv6 timeout on Google Sheets API
_orig_getaddrinfo = socket.getaddrinfo
def _getaddrinfo_v4(*args, **kwargs):
    res = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 if v4 else res
socket.getaddrinfo = _getaddrinfo_v4

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template_string, request
from werkzeug.serving import make_server
from chart_analyzer import analyze_url as analyze_groww_chart, chart_png, parse_instrument, pivot_minute_prices
import groww_scraper as _groww_scraper
from technical_analysis import analyze_market as analyze_technical_market, get_live_price as get_technical_live_price, warm_multi_timeframe, get_timeframe_biases, warm_long_history, get_long_term_context
from market_intelligence import build_market_intelligence
from gold_liquidity import fetch_candles as fetch_gold_liquidity_candles, fetch_india_market_adjustment, fetch_live as fetch_gold_liquidity_live, fetch_ticker as fetch_gold_liquidity_ticker, fetch_usd_inr

# Shared HTTP session for Groww scraping (connection-pool reuse)
_groww_session = _groww_scraper._make_session(retries=2, backoff=1.0)

PROJECT_ROOT = Path(__file__).parent
DATA_DIR = Path(os.environ.get("TRADEX_DATA_DIR", PROJECT_ROOT)).expanduser().resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "tradex_config.json"
SNAPSHOT_INTERVAL_SECONDS = 60.0
SHEETS_MIN_WRITE_INTERVAL_SECONDS = 60.0
MARKET_TIMEZONE = ZoneInfo("Asia/Kolkata")
MARKET_START = datetime_time(9, 15)
MARKET_END = datetime_time(15, 39)
app = Flask(__name__)
# Provide a test_client method if missing (Werkzeug fallback)
# Test client shim removed; Flask provides its own test_client.
# Expose the Flask instance via 'app.app' for compatibility with tests
app.app = app
lock = threading.RLock()
state: dict[str, Any] = {"running": False, "scanning": False, "last_update": None, "rows": [], "error": None,
                         "option_chain_rows": [],
                         "option_chain_complete": False,
                         "underlying_prices": {},
                         "underlying_details": {},
                         "last_option_prices": {},
                         "sheets_error": None, "sheets_last_write": None, "sheets_rows_written": 0,
                         "sheets_pending": False, "sheets_write_started": False,
                         "sheets_next_write_at": None, "sheets_wait_started_at": None,
                         "sheets_wait_seconds": 0, "matched_rows": 0, "source_rows": 0, "logs": []}
stop_event = threading.Event()
refresh_event = threading.Event()
force_scan_event = threading.Event()
scraping_enabled = False
last_dashboard_activity = time.monotonic()
IDLE_SHUTDOWN_SECONDS = 3600
playwright_runtime = None
rendered_browser = None
rendered_pages: dict[str, Any] = {}
rendered_page_refresh: dict[str, float] = {}
rendered_page_retry_at: dict[str, float] = {}
rendered_page_errors: dict[str, str] = {}
sheets_queue: queue.Queue = queue.Queue(maxsize=1)
http_server = None
chart_results: dict[str, Any] = {"analysis": None, "rows": [], "table": [], "analyses": []}
HISTORICAL_WIDE_ROWS_KEY = "__historical_wide_rows__"
offhours_history: dict[str, Any] = {"session_date": None, "jobs": [], "position": 0,
                                   "wide_by_time": {}, "complete": False}


def log_event(message: str, level: str = "info") -> None:
    """Keep a small, newest-first activity log for the dashboard."""
    entry = {"time": datetime.now().astimezone().isoformat(timespec="seconds"),
             "message": str(message), "level": level}
    with lock:
        state["logs"].insert(0, entry)
        del state["logs"][100:]

DEFAULT_CONFIG: dict[str, Any] = {
    "refresh_seconds": 5,
    "indices": [],
    "sheets": {"enabled": False, "spreadsheet_id": "", "credentials_file": "", "worksheet": "Options"},
}


def load_config() -> dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            return {**DEFAULT_CONFIG, **data, "sheets": {**DEFAULT_CONFIG["sheets"], **data.get("sheets", {})}}
        except (ValueError, OSError):
            pass
    return json.loads(json.dumps(DEFAULT_CONFIG))


config = load_config()

DEFAULT_WORKLOADS = {
    "sections": {"terminal": False, "pnl": False, "technical": False, "gold_liquidity": False},
    "instruments": {"NIFTY": False, "SENSEX": False, "GOLDM": False, "SILVERM": False},
}
WORKLOADS_PATH = DATA_DIR / "workloads.json"


def load_workloads() -> dict[str, dict[str, bool]]:
    try:
        saved = json.loads(WORKLOADS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    return {
        group: {key: bool(saved.get(group, {}).get(key, value))
                for key, value in defaults.items()}
        for group, defaults in DEFAULT_WORKLOADS.items()
    }


workloads = load_workloads()


def section_enabled(section: str) -> bool:
    with lock:
        return bool(workloads["sections"].get(section, False))


def instrument_enabled(name: str) -> bool:
    with lock:
        return bool(workloads["instruments"].get(str(name).strip().upper(), False))


def active_market_indices() -> list[dict[str, Any]]:
    if not (section_enabled("terminal") or section_enabled("pnl")):
        return []
    return [item for item in config.get("indices", []) if instrument_enabled(item.get("name", ""))]


@app.before_request
def record_dashboard_activity() -> None:
    global last_dashboard_activity
    with lock:
        last_dashboard_activity = time.monotonic()


def save_config(data: dict[str, Any]) -> None:
    global config
    with lock:
        config = data
        CONFIG_PATH.write_text(json.dumps(config, indent=2))
    refresh_event.set()


def save_workloads(data: dict[str, Any]) -> dict[str, dict[str, bool]]:
    global workloads
    incoming = data if isinstance(data, dict) else {}
    updated = {
        group: {key: bool(incoming.get(group, {}).get(key, current))
                for key, current in defaults.items()}
        for group, defaults in DEFAULT_WORKLOADS.items()
    }
    with lock:
        workloads = updated
        WORKLOADS_PATH.write_text(json.dumps(workloads, indent=2), encoding="utf-8")
    refresh_event.set()
    if scraping_enabled:
        force_scan_event.set()
    return updated


def valid_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def extract_rows(index: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch option chain rows for a configured index.

    For Groww option URLs we use groww_scraper which parses the
    __NEXT_DATA__ JSON embedded in the page -- no browser / Playwright needed.
    For any other URL we fall back to the CSS-selector based HTML scraper.
    """
    url = index.get("url", "").strip()
    name = str(index.get("name", "Index"))

    # -- Groww fast-path ------------------------------------------------------
    configured_strikes = [s for s in index.get("strikes", []) if str(s).strip()]
    is_commodity = "groww.in/commodities/options/" in url
    if "groww.in/options/" in url or is_commodity:
        slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
        # Position PnL cards need the entire expiry chain, including strikes
        # outside the main terminal's compact ATM window.
        limit_atm = None
        try:
            result = _groww_scraper.fetch_option_chain(
                slug, session=_groww_session, strikes_above_below=limit_atm,
                expiry=str(index.get("selected_expiry", "")).strip() or None,
                commodity=is_commodity,
                exclude_illiquid=bool(index.get("exclude_illiquid", False)),
                lot_size=index.get("lot_size"),
            )
        except Exception as exc:
            raise RuntimeError(f"{name}: Groww scraper failed -- {exc}") from exc

        # Update live spot price in shared state
        spot = result.get("underlying_price", 0)
        if spot:
            with lock:
                state.setdefault("underlying_prices", {})[name] = spot
                state.setdefault("underlying_details", {})[name] = {
                    "price": spot,
                    "day_change": result.get("day_change", 0.0),
                    "day_change_perc": result.get("day_change_perc", 0.0),
                    "prev_close": result.get("prev_close", 0.0),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

        # Update lot size in config so downstream logic uses it
        lot = result.get("lot_size")
        if lot:
            index["lot_size"] = lot

        return result.get("rows", [])

    # -- Legacy CSS-selector scraper ------------------------------------------
    if index.get("browser_rendered"):
        return extract_rendered_option_chain(index)
    if not valid_url(url):
        raise ValueError(f"{name}: enter a valid http(s) URL")
    response = requests.get(url, timeout=15, headers={"User-Agent": "TradeXOptionsDashboard/1.0"})
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    quote_selector = str(index.get("underlying_selector", "")).strip()
    quote_node = soup.select_one(quote_selector) if quote_selector else None
    quote_text = quote_node.get_text(" ", strip=True) if quote_node else ""
    underlying = normalize_price(quote_text)
    with lock:
        state.setdefault("underlying_prices", {}).pop(name, None)
        if underlying != "":
            state["underlying_prices"][name] = underlying
    row_selector = index.get("row_selector", "").strip()
    if row_selector:
        candidates = soup.select(row_selector)
    else:
        # Reasonable fallback for static pages: table rows with cells.
        candidates = [row for row in soup.select("table tr") if row.select("td")]
    fields = index.get("selectors", {})
    result = []
    for item in candidates:
        def value(field: str, fallback_index: int) -> str:
            selector = fields.get(field, "").strip()
            if selector:
                node = item.select_one(selector)
                return node.get_text(" ", strip=True) if node else ""
            cells = item.select("td")
            return cells[fallback_index].get_text(" ", strip=True) if len(cells) > fallback_index else ""

        row = {
            "index": name, "expiry": value("expiry", 0), "strike": value("strike", 1),
            "call": normalize_price(value("call", 2)), "put": normalize_price(value("put", 3)),
        }
        if row["strike"] or row["call"] or row["put"]:
            result.append(row)

    if not configured_strikes and result:
        spot_val = state.get("underlying_prices", {}).get(name) or 0
        if spot_val:
            try:
                spot_float = float(spot_val)
                valid = []
                for r in result:
                    try:
                        s_val = float(str(r.get("strike", "")).replace(",", "").replace("₹", "").strip())
                        valid.append((s_val, r))
                    except (ValueError, TypeError):
                        continue
                if valid:
                    valid.sort(key=lambda x: x[0])
                    atm_idx = min(range(len(valid)), key=lambda i: abs(valid[i][0] - spot_float))
                    start = max(0, atm_idx - 10)
                    end = min(len(valid), atm_idx + 11)
                    result = [item[1] for item in valid[start:end]]
            except Exception:
                pass

    return result


def extract_rendered_option_chain(index: dict[str, Any]) -> list[dict[str, Any]]:
    """Read Groww-style option rows after the page's JavaScript has rendered them."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Browser mode requires Playwright. Install requirements.txt") from exc
    url = index.get("url", "").strip()
    if not valid_url(url):
        raise ValueError(f"{index.get('name', 'Index')}: enter a valid http(s) URL")
    chosen_expiry = str(index.get("selected_expiry", "")).strip()
    expected_codes: set[str] = set()
    if chosen_expiry:
        try:
            selected_date = datetime.strptime(chosen_expiry, "%Y-%m-%d")
            month_code = "JFMAMJJASOND"[selected_date.month - 1]
            expected_codes = {f"{selected_date:%y}{month_code}{selected_date:%d}", selected_date.strftime("%y%b").upper()}
        except ValueError:
            # A visible text expiry can still be matched against the page's own selected option.
            expected_code = ""

    contracts: dict[tuple[str, str], dict[str, Any]] = {}
    global rendered_browser
    if playwright_runtime is None:
        raise RuntimeError("Browser-rendered polling is not running")
    if rendered_browser is None:
        try:
            state["scan_stage"] = "Launching Chrome"
            # Keep the browser page visible so its live market feed continues
            # updating while the dashboard is open.
            # Use Playwright's managed Chromium so the packaged app does not
            # depend on or launch the user's system Chrome installation.
            rendered_browser = playwright_runtime.chromium.launch(headless=True)
        except Exception as exc:
            raise RuntimeError("Could not launch Chrome for browser-rendered scraping. Install Google Chrome.") from exc
    page = rendered_pages.get(url)
    if page is None or page.is_closed():
        retry_at = rendered_page_retry_at.get(url, 0)
        if time.monotonic() < retry_at:
            detail = rendered_page_errors.get(url, "unknown page load failure")
            raise RuntimeError(f"Groww page retry cooling down ({int(retry_at - time.monotonic()) + 1}s). Last load error: {detail}")
        page = rendered_browser.new_page()
        rendered_pages[url] = page
        try:
            state["scan_stage"] = "Loading Groww page"
            page.goto(url, wait_until="domcontentloaded", timeout=25000)
            # Let Groww finish hydrating its virtualized chain before querying
            # anchors; evaluating during initial React work can stall the page.
            time.sleep(5)
            rendered_page_refresh[url] = time.monotonic()
        except Exception as exc:
            rendered_pages.pop(url, None)
            rendered_page_refresh.pop(url, None)
            rendered_page_retry_at[url] = time.monotonic() + 15
            rendered_page_errors[url] = str(exc)
            page.close()
            raise
    # Groww can leave a separate browser's rendered prices unchanged when its
    # live feed is unavailable. Reload the rendered page to fetch a fresh snapshot.
    # Keep dashboard reads fast, but avoid repeatedly reloading the source site.
    # Its rendered page should receive live updates; reload only as a recovery.
    refresh_interval = SNAPSHOT_INTERVAL_SECONDS
    if time.monotonic() - rendered_page_refresh.get(url, 0) >= refresh_interval:
        try:
            page.reload(wait_until="domcontentloaded", timeout=45000)
            time.sleep(2)
            rendered_page_refresh[url] = time.monotonic()
        except Exception as exc:
            rendered_pages.pop(url, None)
            rendered_page_refresh.pop(url, None)
            rendered_page_retry_at[url] = time.monotonic() + 15
            rendered_page_errors[url] = str(exc)
            page.close()
            raise
    try:
        state["scan_stage"] = "Reading rendered option links"
        # Reuse the live page so its WebSocket updates continue; each cycle only reads rendered text.
        # Avoid Playwright's :visible check: some Chrome sessions report the
        # virtualized chain as hidden even while rendered text is available.
        # Navigation links contain no price and are discarded below.
        links = page.evaluate(
            """() => Array.from(document.querySelectorAll('a[href*="/options/"]'),
                a => ({href: a.getAttribute('href'), text: a.textContent || ''}))"""
        )
        selector = str(index.get("underlying_selector", "")).strip()
        symbol = re.sub(r"[^A-Z0-9]", "", str(index.get("name", "")).upper())
        exchange = "BSE" if "bse" in urlparse(url).path.casefold() else "NSE"
        with lock:
            state.setdefault("underlying_prices", {}).pop(str(index.get("name", "")), None)
        page_data = page.evaluate("""async ({selector, symbol, exchange}) => {
          const node = selector ? document.querySelector(selector) : null;
          let quote = node ? (node.textContent || '') : '';
          if (!quote) {
            try {
              const path = `/v1/api/stocks_data/v1/accord_points/exchange/${exchange}/segment/CASH/latest_indices_ohlc/${encodeURIComponent(symbol)}`;
              const data = await (await fetch(path)).json();
              quote = data.value ?? data.indexIndicativePrice ?? '';
            } catch (_) {}
          }
          const text = document.body ? document.body.innerText : '';
          const expiry = text.match(/\\b(\\d{1,2})\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\b/i);
          return {quote, expiry: expiry ? expiry[0] : ''};
        }""", {"selector": selector, "symbol": symbol, "exchange": exchange})
        quote_text = page_data.get("quote", "")
        underlying = normalize_price(quote_text)
        if underlying != "":
            with lock:
                state.setdefault("underlying_prices", {})[str(index.get("name", ""))] = underlying
        visible_expiry = str(page_data.get("expiry", ""))
        state["scan_stage"] = f"Parsing {len(links)} rendered links"
    except Exception as exc:
        rendered_pages.pop(url, None)
        rendered_page_retry_at[url] = time.monotonic() + 15
        rendered_page_errors[url] = str(exc)
        page.close()
        raise

    for link in links:
        href = str(link.get("href", ""))
        ticker = href.rstrip("/").rsplit("/", 1)[-1].upper()
        compact = re.search(r"(\d{2})([A-Z])(\d{2})(\d+)(CE|PE)$", ticker)
        monthly = re.search(r"(\d{2})([A-Z]{3})(\d+)(CE|PE)$", ticker)
        if compact:
            yy, month_letter, day, strike, side = compact.groups()
            code = f"{yy}{month_letter}{day}"
        elif monthly:
            yy, month_name, strike, side = monthly.groups()
            code = f"{yy}{month_name}"
        else:
            continue
        if expected_codes and code not in expected_codes:
            continue
        # The current page can expose multiple expiries; use the chosen ISO date when available.
        expiry = chosen_expiry or code
        if not chosen_expiry and monthly:
            visible_date = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]{3})", visible_expiry)
            if visible_date and visible_date.group(2).upper() == month_name:
                expiry = f"20{yy}-{datetime.strptime(month_name, '%b').month:02d}-{int(visible_date.group(1)):02d}"
        price = re.search(r"₹\s*([\d,]+(?:\.\d+)?)", str(link.get("text", "")))
        normalized_strike = exact_strike(strike)
        key = (expiry, normalized_strike)
        row = contracts.setdefault(key, {"index": index.get("name", ""), "expiry": expiry,
                                         "strike": strike, "call": "", "put": "", "chart_urls": {}})
        row["chart_urls"][side] = urljoin("https://groww.in", href)
        if price:
            row["call" if side == "CE" else "put"] = normalize_price(price.group(1))
    # Use the live LTP values already rendered beside each contract on the
    # option-chain page. Historical chart OCR remains available through the
    # existing chart analyzer page and is not invoked for every chain row.
    return [contract for contract in contracts.values()
            if contract.get("call") not in ("", None) or contract.get("put") not in ("", None)]


def exact_strike(raw: str) -> str:
    # Normalize numeric formatting while preserving non-numeric source values.
    try:
        return format(float(raw.replace(",", "").replace("₹", "").strip()), "g")
    except ValueError:
        return " ".join(raw.casefold().split())


def normalize_price(raw: Any) -> Any:
    """Return parsed option premiums as numbers without currency symbols."""
    text = str(raw or "").replace("₹", "").replace(",", "").strip()
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return ""
    number = float(match.group(0))
    return int(number) if number.is_integer() else number


def remember_option_price(index_name: str, expiry: str, strike: Any, side: str,
                          raw_price: Any, observed_at: Optional[str] = None,
                          source: str = "option_chain") -> None:
    price = normalize_price(raw_price)
    if not isinstance(price, (int, float)) or price <= 0:
        return
    normalized = exact_strike(str(strike))
    key = "|".join((str(index_name), str(expiry), normalized, side.upper()))
    with lock:
        item = state.setdefault("last_option_prices", {}).setdefault(key, {
            "index": str(index_name), "expiry": str(expiry), "strike": normalized, "side": side.upper(),
        })
        if item.get("source") == "option_chain" and source == "chart_hover":
            return
        item.update(price=price, observed_at=observed_at or datetime.now(timezone.utc).isoformat(), source=source)


def make_wide_snapshot(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Collapse one captured chain into Time + one premium column per contract."""
    snapshot: dict[str, Any] = {"Time": rows[0].get("snapshot_time", "") if rows else ""}
    expiry_counts: dict[str, set[str]] = {}
    for row in rows:
        expiry_counts.setdefault(str(row.get("index", "")).upper(), set()).add(str(row.get("expiry", "")))
    for row in rows:
        parts = [str(row.get(key, "")).strip() for key in ("index", "strike") if row.get(key, "")]
        if len(expiry_counts.get(str(row.get("index", "")).upper(), ())) > 1 and row.get("expiry"):
            parts.insert(1, str(row["expiry"]).strip())
        root = " ".join(parts).upper()
        for side, field in (("CE", "call"), ("PE", "put")):
            value = row.get(field, "")
            snapshot[f"{root} {side}"] = value if value not in (None, "") else "NA"
    return snapshot


def push_to_sheets(rows: list[dict[str, Any]], sheet_cfg: Optional[dict[str, Any]] = None) -> None:
    if not rows:
        raise ValueError("No matching price rows were found to publish")
    push_wide_rows_to_sheets([make_wide_snapshot(rows)], sheet_cfg)


def push_wide_rows_to_sheets(wide_rows: list[dict[str, Any]], sheet_cfg: Optional[dict[str, Any]] = None,
                             deduplicate: bool = False) -> int:
    sheet_cfg = sheet_cfg or config.get("sheets", {})
    if not sheet_cfg.get("enabled"):
        return 0
    try:
        missing = [key for key in ("credentials_file", "spreadsheet_id", "worksheet") if not str(sheet_cfg.get(key, "")).strip()]
        if missing:
            raise ValueError("Missing Sheets setting(s): " + ", ".join(missing))
        credentials_file = Path(sheet_cfg["credentials_file"]).expanduser()
        if not credentials_file.is_file():
            raise FileNotFoundError(f"Service account JSON file not found: {credentials_file}")
        if not wide_rows:
            raise ValueError("No matching price rows were found to publish")
        import gspread
        from google.oauth2.service_account import Credentials
        creds = Credentials.from_service_account_file(str(credentials_file), scopes=["https://www.googleapis.com/auth/spreadsheets"])
        client = gspread.authorize(creds)
        worksheet = client.open_by_key(sheet_cfg["spreadsheet_id"]).worksheet(sheet_cfg["worksheet"])
        # Store each trading date as a compact block: date/contract headings in
        # the first row, then one HH:MM timestamp per row below it.
        def parse_timestamp(value: Any) -> tuple[str, str]:
            raw = str(value or "").strip()
            for fmt in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S%z"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed.strftime("%Y-%m-%d"), parsed.strftime("%H:%M")
                except ValueError:
                    continue
            raise ValueError(f"Unrecognized snapshot time: {raw}")

        def contract_name(value: Any) -> str:
            name = " ".join(str(value).strip().split())
            if name.upper().startswith("SENSEX "):
                name = name[7:].strip()
            return name

        # date -> time -> contract -> numeric premium; load current values once
        # so retries and live snapshots update existing minute rows in place.
        day_values: dict[str, dict[str, dict[str, Any]]] = {}
        day_contracts: dict[str, set[str]] = {}
        existing = worksheet.get_all_values()
        legacy_headers: list[str] = []
        if existing and existing[0] and existing[0][0].strip().casefold() == "time":
            legacy_headers = [contract_name(v) for v in existing[0][1:] if v.strip()]
            for values in existing[1:]:
                if not values or not values[0].strip():
                    continue
                try:
                    day, minute = parse_timestamp(values[0])
                except ValueError:
                    continue
                day_values.setdefault(day, {}).setdefault(minute, {})
                day_contracts.setdefault(day, set()).update(legacy_headers)
                for i, header in enumerate(legacy_headers, start=1):
                    if i < len(values) and values[i] != "":
                        day_values[day][minute][header] = values[i]
        else:
            # Read the new date-block format to merge newly discovered strikes.
            row = 0
            while row < len(existing):
                values = existing[row]
                if values and re.fullmatch(r"\d{4}-\d{2}-\d{2}", values[0].strip()):
                    day = values[0].strip()
                    headers = [contract_name(v) for v in values[1:] if v.strip()]
                    day_contracts.setdefault(day, set()).update(headers)
                    row += 1
                    while row < len(existing) and (not existing[row] or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", existing[row][0].strip())):
                        vals = existing[row]
                        if vals and re.fullmatch(r"\d{2}:\d{2}", vals[0].strip()):
                            minute = vals[0].strip()
                            day_values.setdefault(day, {}).setdefault(minute, {})
                            for i, header in enumerate(headers, start=1):
                                if i < len(vals) and vals[i] != "":
                                    day_values[day][minute][header] = vals[i]
                        row += 1
                    continue
                row += 1

        incoming_minutes: set[tuple[str, str]] = set()
        for record in wide_rows:
            day, minute = parse_timestamp(record.get("Time", ""))
            incoming_minutes.add((day, minute))
            day_values.setdefault(day, {}).setdefault(minute, {})
            day_contracts.setdefault(day, set())
            for key, value in record.items():
                if key == "Time" or not str(key).upper().endswith((" CE", " PE")):
                    continue
                header = contract_name(key)
                day_contracts[day].add(header)
                if value != "":
                    day_values[day][minute][header] = "NA" if str(value).strip().upper() == "NA" else normalize_price(value)

        output: list[list[Any]] = []
        for day in sorted(day_values):
            headers = sorted(day_contracts.get(day, set()), key=lambda s: (int(s.split()[0]) if s.split() and s.split()[0].isdigit() else 10**12, s))
            output.append([day, *headers])
            for minute in sorted(day_values[day]):
                values = day_values[day][minute]
                output.append([minute, *[values.get(header, "") for header in headers]])
        if not output:
            return 0
        needed_cols = max(len(row) for row in output)
        if worksheet.col_count < needed_cols:
            worksheet.add_cols(needed_cols - worksheet.col_count)
        worksheet.update(values=output, range_name="A1", value_input_option="RAW")
        return len(incoming_minutes)
    except Exception as exc:  # report configuration/API failures on dashboard
        raise RuntimeError(f"Google Sheets: {exc}") from exc


def poll_once() -> None:
    found: list[dict[str, Any]] = []
    history_found: list[dict[str, Any]] = []
    errors = []
    source_row_count = 0
    snapshot_time = datetime.now().astimezone().strftime("%Y-%m-%d %I:%M %p")
    log_event("Live scan started")
    indices = active_market_indices()
    if not indices:
        with lock:
            state.update(rows=[], option_chain_rows=[], underlying_prices={}, underlying_details={},
                         scanning=False, running=False, scan_stage="No market data services are enabled")
        return

    def fetch_one_index(idx: dict[str, Any]):
        try:
            return idx, extract_rows(idx), None
        except Exception as exc:
            return idx, [], exc

    if len(indices) > 1:
        with ThreadPoolExecutor(max_workers=min(4, len(indices))) as executor:
            fetched_batches = list(executor.map(fetch_one_index, indices))
    else:
        fetched_batches = [fetch_one_index(idx) for idx in indices]

    for index, rows, exc in fetched_batches:
        if exc is not None:
            errors.append(str(exc))
            log_event(f"{index.get('name', 'Index')} scan failed: {exc}", "error")
            continue
        try:
            state["scan_stage"] = f"Processing {index.get('name', 'index')}"
            for quote in rows:
                for side in ("CE", "PE"):
                    value = quote.get("call" if side == "CE" else "put")
                    remember_option_price(quote.get("index", index.get("name", "")), quote.get("expiry", ""),
                                          quote.get("strike", ""), side, value)
            log_event(f"{index.get('name', 'Index')}: read {len(rows)} source rows")
            source_row_count += len(rows)
            selected = {exact_strike(str(s)) for s in index.get("strikes", []) if str(s).strip()}
            expiry = str(index.get("selected_expiry", "")).strip()
            for row in rows:
                if expiry and row["expiry"].strip() != expiry:
                    continue
                historical_row = {**row, "snapshot_time": snapshot_time}
                history_found.append(historical_row)
                if selected and exact_strike(row["strike"]) not in selected:
                    continue
                found.append(historical_row)
        except Exception as exc:
            errors.append(str(exc))
            log_event(f"{index.get('name', 'Index')} scan failed: {exc}", "error")
    # This destination is dedicated to SENSEX. Other configured indices may
    # still appear on the dashboard, but must never be appended to this sheet.
    sensex_history = [row for row in history_found
                      if str(row.get("index", "")).strip().casefold() == "sensex"]
    if sensex_history and config.get("sheets", {}).get("enabled"):
        # Keep only the newest snapshot if the Sheets API is slower than the scan rate.
        payload = (sensex_history, json.loads(json.dumps(config["sheets"])))
        try:
            sheets_queue.put_nowait(payload)
            log_event(f"Queued {len(sensex_history)} SENSEX rows for Google Sheets")
        except queue.Full:
            try:
                sheets_queue.get_nowait()
                sheets_queue.task_done()
            except queue.Empty:
                pass
            try:
                sheets_queue.put_nowait(payload)
                log_event(f"Replaced pending Sheets snapshot with latest {len(sensex_history)} SENSEX rows", "warning")
            except queue.Full:
                log_event("Could not queue snapshot for Google Sheets", "error")
    with lock:
        # Keep the last successful snapshot during a source outage. Its timestamp
        # remains unchanged so the dashboard can show that the data is stale.
        if found or not errors:
            state["rows"] = found
            state["option_chain_rows"] = history_found
            state["option_chain_complete"] = True
            state["last_update"] = datetime.now(timezone.utc).isoformat()
            save_last_snapshot(state["rows"], state.get("underlying_prices", {}), state["last_update"], state.get("option_chain_rows", []))
        state["last_attempt"] = datetime.now(timezone.utc).isoformat()
        state["source_rows"] = source_row_count
        state["matched_rows"] = len(found)
        state["scan_stage"] = "Updating Google Sheets" if found and config.get("sheets", {}).get("enabled") else "Idle"
        if errors:
            state["error"] = " · ".join(errors)
        elif not found and config.get("indices"):
            state["error"] = ("No price contracts were parsed from the source page" if not source_row_count
                               else "No rows matched the selected expiry")
        else:
            state["error"] = None
    if errors:
        log_event(f"Scan finished with errors; {source_row_count} source rows, {len(found)} matched", "error")
    elif not source_row_count and config.get("indices"):
        log_event("Scan finished, but no price contracts were parsed", "warning")
    else:
        log_event(f"Scan finished: {source_row_count} source rows, {len(found)} matched")


def run_offhours_chart_history(session_date: str) -> None:
    """Backfill minute readings from every SENSEX contract chart after hours."""
    def full_minute_grid() -> list[dict[str, Any]]:
        date = datetime.strptime(session_date, "%Y-%m-%d").date()
        start = datetime.combine(date, MARKET_START)
        end = datetime.combine(date, MARKET_END)
        columns = list(dict.fromkeys(job["column"] for job in offhours_history.get("jobs", [])))
        rows = []
        minute = start
        while minute <= end:
            stamp = minute.strftime("%I:%M %p")
            row: dict[str, Any] = {"Time": f"{session_date} {stamp}"}
            row.update({column: "NA" for column in columns})
            row.update(offhours_history.get("wide_by_time", {}).get(stamp, {}))
            rows.append(row)
            minute += timedelta(minutes=1)
        return rows

    if offhours_history["session_date"] != session_date:
        jobs_by_url: dict[str, dict[str, str]] = {}
        try:
            for index in config.get("indices", []):
                if str(index.get("name", "")).strip().casefold() != "sensex":
                    continue
                chart_seed = str(index.get("history_chart_url", "")).strip()
                if chart_seed:
                    jobs_by_url[chart_seed] = {"url": chart_seed, "expiry": ""}
                chain_rows = extract_rows(index)
                for quote in chain_rows:
                    for side in ("CE", "PE"):
                        value = quote.get("call" if side == "CE" else "put")
                        remember_option_price(quote.get("index", index.get("name", "SENSEX")), quote.get("expiry", ""),
                                              quote.get("strike", ""), side, value)
                discovered_links = 0
                for row in chain_rows:
                    for side, url in row.get("chart_urls", {}).items():
                        if url:
                            jobs_by_url[url] = {"url": url, "expiry": str(row.get("expiry", ""))}
                            discovered_links += 1
                log_event(f"SENSEX chain scan found {len(chain_rows)} contracts and {discovered_links} chart links")
        except Exception as exc:
            log_event(f"Could not discover SENSEX option charts for history: {exc}", "error")
            with lock:
                state["error"] = str(exc)
                state["scanning"] = False
            return
        expiry_codes = {parse_instrument(job["url"]).get("expiry_code") for job in jobs_by_url.values()}
        multiple_expiries = len(expiry_codes) > 1
        jobs = []
        for url, job in jobs_by_url.items():
            instrument = parse_instrument(url)
            if not instrument.get("strike") or instrument.get("option_type") not in {"CE", "PE"}:
                continue
            label_parts = ["SENSEX"]
            if multiple_expiries and instrument.get("expiry_code"):
                label_parts.append(str(instrument["expiry_code"]))
            label_parts.extend((str(instrument["strike"]), str(instrument["option_type"])))
            jobs.append({"url": url, "column": " ".join(label_parts)})
        offhours_history.update(session_date=session_date, jobs=jobs, position=0,
                                wide_by_time={}, complete=False, retry_jobs=[], retries_scheduled=False,
                                completed_count=0)
        log_event(f"Discovered {len(jobs)} SENSEX option charts for {session_date} history")
        if not jobs:
            log_event("No contract chart links were available for off-hours history", "warning")
            return

    jobs = offhours_history["jobs"]
    total = len(jobs)
    def analyze_chart_job(job: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], Optional[str]]:
        worker_code = (
            "import json,sys; from chart_analyzer import analyze_url; "
            "a,r=analyze_url(sys.argv[1],'1D'); print(json.dumps({'analysis':a,'rows':r}))"
        )
        worker_env = dict(os.environ)
        worker_env["PYTHONPYCACHEPREFIX"] = "/tmp/webscraper-pycache"
        try:
            completed = subprocess.run(
                [sys.executable, "-c", worker_code, job["url"]], cwd=str(PROJECT_ROOT),
                env=worker_env, capture_output=True, text=True, timeout=150,
            )
            if completed.returncode:
                raise RuntimeError(completed.stderr.strip()[-1200:] or "Chart worker exited unsuccessfully")
            result = json.loads(completed.stdout)
            return job, result["analysis"], result["rows"], None
        except Exception as exc:
            return job, {}, [], str(exc)

    completed_count = int(offhours_history.get("completed_count", 0))
    last_chart_launch = 0.0
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="sensex-chart") as executor:
        while offhours_history["position"] < total:
            local_now = datetime.now(MARKET_TIMEZONE)
            if MARKET_START <= local_now.time().replace(tzinfo=None) <= MARKET_END:
                log_event("Pausing chart-history extraction for live market collection")
                return
            with lock:
                if not scraping_enabled:
                    return
                state["scanning"] = True
            batch = []
            while len(batch) < 3 and offhours_history["position"] < total:
                if last_chart_launch and time.monotonic() - last_chart_launch < 1.1:
                    time.sleep(1.1 - (time.monotonic() - last_chart_launch))
                index = offhours_history["position"]
                job = jobs[index]
                offhours_history["position"] += 1
                batch.append((index, executor.submit(analyze_chart_job, job)))
                last_chart_launch = time.monotonic()
            future_indices = {future: index for index, future in batch}
            for future in as_completed(future_indices):
                index = future_indices[future]
                job, analysis, points, error = future.result()
                recovered = False
                accepted = 0
                if error:
                    log_event(f"Chart {index + 1}/{total} failed: {error}", "error")
                elif analysis.get("prices_exact"):
                    for point in points:
                        stamp = str(point.get("timestamp", ""))
                        try:
                            minute = datetime.strptime(stamp, "%I:%M %p").time()
                        except ValueError:
                            continue
                        if not (MARKET_START <= minute <= MARKET_END):
                            continue
                        row = offhours_history["wide_by_time"].setdefault(
                            stamp, {"Time": f"{session_date} {stamp}"})
                        row[job["column"]] = normalize_price(point.get("estimated_premium"))
                        instrument = parse_instrument(job["url"])
                        remember_option_price("SENSEX", job.get("expiry") or instrument.get("expiry_code", ""),
                                              instrument.get("strike", ""), instrument.get("option_type", ""),
                                              point.get("estimated_premium"), datetime.strptime(f"{session_date} {stamp}", "%Y-%m-%d %I:%M %p").replace(tzinfo=MARKET_TIMEZONE).isoformat(), "chart_hover")
                        accepted += 1
                    recovered = accepted > 0
                    if recovered:
                        log_event(f"Chart {index + 1}/{total}: {job['column']} · {accepted} minute prices")
                    else:
                        log_event(f"Chart {index + 1}/{total}: no exact minute prices recovered", "warning")
                else:
                    log_event(f"Chart {index + 1}/{total}: no exact minute prices recovered", "warning")

                attempt = int(job.get("attempt", 0))
                if not recovered and attempt == 0:
                    offhours_history.setdefault("retry_jobs", []).append({**job, "attempt": 1})
                elif not recovered:
                    log_event(f"Final retry gave no exact minute prices for {job['column']}; continuing", "warning")

                completed_count += 1
                offhours_history["completed_count"] = completed_count
                with lock:
                    state["scan_stage"] = f"Chart history {completed_count}/{total}"

                # Publish completed readings as they arrive. Sheets writes stay
                # serialized by the one-minute writer queue.
                if offhours_history["wide_by_time"]:
                    snapshot = full_minute_grid()
                    payload = ({HISTORICAL_WIDE_ROWS_KEY: snapshot}, json.loads(json.dumps(config["sheets"])))
                    try:
                        sheets_queue.put_nowait(payload)
                    except queue.Full:
                        try:
                            sheets_queue.get_nowait()
                            sheets_queue.task_done()
                        except queue.Empty:
                            pass
                        try:
                            sheets_queue.put_nowait(payload)
                        except queue.Full:
                            log_event("Google Sheets is busy; the next chart checkpoint will retry the upload", "warning")

    # Give contracts with timeouts or empty tooltips one fresh page attempt.
    if offhours_history.get("retry_jobs") and not offhours_history.get("retries_scheduled"):
        retries = offhours_history.pop("retry_jobs")
        offhours_history["retries_scheduled"] = True
        jobs.extend(retries)
        total = len(jobs)
        log_event(f"Retrying {len(retries)} charts that timed out or had no exact minute readings")
        while offhours_history["position"] < total:
            # Re-enter this routine's chart loop without re-discovering links.
            run_offhours_chart_history(session_date)
            return

    if offhours_history["complete"]:
        return
    wide_rows = full_minute_grid()
    if not offhours_history["wide_by_time"]:
        log_event("Off-hours chart pass finished without exact minute prices; all cells will be marked NA", "warning")
    payload = ({HISTORICAL_WIDE_ROWS_KEY: wide_rows}, json.loads(json.dumps(config["sheets"])))
    try:
        sheets_queue.put_nowait(payload)
        offhours_history["complete"] = True
        log_event(f"Queued {len(wide_rows)} historical SENSEX minute rows for Google Sheets")
    except queue.Full:
        log_event("Historical SENSEX rows could not be queued because Google Sheets is busy", "error")
    with lock:
        state["scanning"] = False
        state["scan_stage"] = "Waiting for market window (9:15 AM–3:39 PM IST)"


def poll_loop() -> None:
    global playwright_runtime, rendered_browser
    last_scan_started = 0.0
    market_window_active: Optional[bool] = None
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            playwright_runtime = playwright
            while not stop_event.is_set():
                with lock:
                    enabled = scraping_enabled
                if not enabled:
                    # Playwright objects stay on this worker thread. Closing the
                    # browser here closes every visible source tab safely.
                    if rendered_browser is not None:
                        try:
                            rendered_browser.close()
                        except Exception:
                            pass
                        rendered_browser = None
                    rendered_pages.clear()
                    rendered_page_refresh.clear()
                    rendered_page_retry_at.clear()
                    rendered_page_errors.clear()
                    last_scan_started = 0.0
                    market_window_active = None
                    with lock:
                        state["scanning"] = False
                    refresh_event.wait(0.5)
                    refresh_event.clear()
                    continue
                if not active_market_indices():
                    with lock:
                        state.update(rows=[], option_chain_rows=[], underlying_prices={}, underlying_details={},
                                     scanning=False, running=False, scan_stage="No market data services are enabled")
                    refresh_event.wait(1.0)
                    refresh_event.clear()
                    continue
                local_now = datetime.now(MARKET_TIMEZONE)
                inside_market_window = MARKET_START <= local_now.time().replace(tzinfo=None) <= MARKET_END
                if market_window_active is None or market_window_active != inside_market_window:
                    market_window_active = inside_market_window
                    if inside_market_window:
                        log_event("Market collection window opened (09:15–15:39 IST)")
                        with lock:
                            state["scan_stage"] = "Idle"
                    else:
                        log_event("Outside market collection window; waiting until 09:15 IST")
                        with lock:
                            state["scanning"] = False
                            state["scan_stage"] = "Waiting for market window (9:15 AM–3:39 PM IST)"
                if not inside_market_window:
                    # Keep the latest option chain prices refreshed after hours
                    # too; MCX options can continue trading after the equity window.
                    force_scan_event.clear()
                    try:
                        poll_once()
                    except Exception as exc:
                        log_event(f"Option chain poll failed: {exc}", "error")
                    session_day = local_now.date()
                    if local_now.weekday() >= 5 or local_now.time().replace(tzinfo=None) < MARKET_START:
                        session_day -= timedelta(days=1)
                        while session_day.weekday() >= 5:
                            session_day -= timedelta(days=1)
                    if section_enabled("pnl") and instrument_enabled("SENSEX"):
                        run_offhours_chart_history(session_day.isoformat())
                    refresh_event.wait(30)
                    refresh_event.clear()
                    continue
                # Scan on configured refresh interval (sub-second or live cadence) while market window is open
                scan_interval = max(0.1, float(config.get("refresh_seconds", 0.5)))
                if last_scan_started and not force_scan_event.is_set():
                    remaining = scan_interval - (time.monotonic() - last_scan_started)
                    if remaining > 0:
                        refresh_event.wait(remaining)
                        refresh_event.clear()
                        with lock:
                            enabled = scraping_enabled
                        if not enabled:
                            continue
                        if not force_scan_event.is_set() and time.monotonic() - last_scan_started < scan_interval:
                            continue
                force_scan_event.clear()
                last_scan_started = time.monotonic()
                with lock:
                    state["scanning"] = True
                    state["running"] = True
                log_event("Scraper worker is running")
                poll_once()
                with lock:
                    state["scanning"] = False
                    enabled = scraping_enabled
                if not enabled:
                    continue
    except Exception as exc:
        with lock:
            state["error"] = str(exc)
            state["running"] = False
        log_event(f"Scraper worker stopped: {exc}", "error")
    finally:
        with lock:
            state["running"] = False
            state["scanning"] = False
        log_event("Scraper worker exited")
        if rendered_browser is not None:
            try:
                rendered_browser.close()
            except Exception:
                # The idle dashboard shutdown may already have stopped Playwright.
                pass
        rendered_browser = None
        rendered_pages.clear()
        rendered_page_refresh.clear()
        rendered_page_retry_at.clear()
        rendered_page_errors.clear()
        playwright_runtime = None


def sheets_loop() -> None:
    last_write = 0.0
    last_payload = None
    while not stop_event.is_set():
        try:
            rows, sheet_cfg = sheets_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        try:
            # Keep one batch append per minute and only the newest waiting snapshot.
            delay = max(3.0 if last_write == 0 else 0.0,
                        last_write + SHEETS_MIN_WRITE_INTERVAL_SECONDS - time.monotonic())
            with lock:
                state["sheets_pending"] = True
                state["sheets_write_started"] = False
                state["sheets_wait_started_at"] = time.time()
                state["sheets_wait_seconds"] = delay
                state["sheets_next_write_at"] = time.time() + delay
            stop_event.wait(delay)
            while True:
                try:
                    rows, sheet_cfg = sheets_queue.get_nowait()
                    sheets_queue.task_done()
                except queue.Empty:
                    break
            if (rows, sheet_cfg) == last_payload:
                with lock:
                    state["sheets_pending"] = False
                    state["sheets_next_write_at"] = None
                continue
            with lock:
                state["sheets_write_started"] = True
            if isinstance(rows, dict) and HISTORICAL_WIDE_ROWS_KEY in rows:
                wide_rows = rows[HISTORICAL_WIDE_ROWS_KEY]
                written = push_wide_rows_to_sheets(wide_rows, sheet_cfg, deduplicate=True)
                unit = "historical minute rows"
            else:
                push_to_sheets(rows, sheet_cfg)
                written = len(rows)
                unit = "contracts"
            last_write = time.monotonic()
            last_payload = (rows, sheet_cfg)
            with lock:
                state["sheets_error"] = None
                state["sheets_last_write"] = datetime.now(timezone.utc).isoformat()
                state["sheets_rows_written"] = written
                state["sheets_pending"] = False
                state["sheets_write_started"] = False
                state["sheets_next_write_at"] = None
            log_event(f"Google Sheets updated successfully ({written} {unit})")
        except Exception as exc:
            with lock:
                state["sheets_error"] = str(exc)
                state["sheets_pending"] = False
                state["sheets_write_started"] = False
                state["sheets_next_write_at"] = None
            log_event(f"Google Sheets write failed: {exc}", "error")
            # Keep a local diagnostic trail for failures that happen between dashboard polls.
            try:
                with open(DATA_DIR / "tradex.log", "a", encoding="utf-8") as log:
                    log.write(f"{datetime.now(timezone.utc).isoformat()} Sheets write failed: {exc}\n")
            except OSError:
                pass
        finally:
            sheets_queue.task_done()


def load_template(filename: str) -> str:
    path = PROJECT_ROOT / "templates" / filename
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return ""

PAGE = load_template("index.html")
CHART_PAGE = load_template("chart.html")


@app.get("/")
def home():
    html = load_template("index.html") or PAGE
    from flask import Response
    return Response(html, mimetype="text/html")


@app.get("/favicon.ico")
def favicon():
    # The dashboard has no custom icon; return an empty success response instead
    # of a noisy 404 in the browser console.
    return "", 204


@app.get("/chart")
def chart_page():
    html = load_template("chart.html") or CHART_PAGE
    from flask import Response
    return Response(html, mimetype="text/html")


@app.get("/static/<path:filename>")
def serve_static(filename: str):
    target = (PROJECT_ROOT / "static" / filename).resolve()
    base_static = (PROJECT_ROOT / "static").resolve()
    if not str(target).startswith(str(base_static)) or not target.is_file():
        from flask import Response
        return Response("Not Found", status=404, mimetype="text/plain")
    mime = "text/css" if filename.endswith(".css") else "application/javascript" if filename.endswith(".js") else "text/plain"
    from flask import Response
    return Response(target.read_text(encoding="utf-8"), mimetype=mime)


@app.get("/api/ta/market")
def technical_market_api():
    if not section_enabled("technical"):
        return jsonify(error="Turn on the Technical Analysis workload to fetch analysis."), 409
    try:
        symbol = str(request.args.get("symbol", "XAUUSDT")).upper()
        timeframe = str(request.args.get("timeframe", "15m")).lower()
        result = dict(analyze_technical_market(str(TRADES_DB_PATH), symbol, timeframe))
        threading.Thread(target=warm_multi_timeframe, args=(str(TRADES_DB_PATH), symbol),
                         daemon=True, name=f"ta-history-{symbol}").start()
        threading.Thread(target=warm_long_history, args=(str(TRADES_DB_PATH), symbol),
                         daemon=True, name=f"ta-long-history-{symbol}").start()
        result["historical_context"] = get_long_term_context(str(TRADES_DB_PATH), symbol)
        result["timeframes_ready"] = _technical_timeframes_ready(symbol)
        result["timeframe_biases"] = get_timeframe_biases(str(TRADES_DB_PATH), symbol)
        mode = str(request.args.get("mode", "complete")).lower()
        result["intelligence"] = build_market_intelligence(str(TRADES_DB_PATH), result, mode)
        response = jsonify(result)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    except Exception as exc:
        return jsonify(error=str(exc)), 400


@app.get("/api/ta/price")
def technical_live_price_api():
    if not section_enabled("technical"):
        return jsonify(error="Turn on the Technical Analysis workload to fetch live prices."), 409
    try:
        symbol = str(request.args.get("symbol", "XAUUSDT")).upper()
        response = jsonify(get_technical_live_price(symbol))
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    except Exception as exc:
        return jsonify(error=str(exc)), 400


@app.get("/api/gold-liquidity/candles")
def gold_liquidity_candles_api():
    if not section_enabled("gold_liquidity"):
        return jsonify(error="Turn on the Gold Liquidity workload to fetch candles."), 409
    try:
        return jsonify(fetch_gold_liquidity_candles(
            str(request.args.get("exchange", "bybit")),
            str(request.args.get("timeframe", "1m")),
            str(request.args.get("start", "")),
            str(request.args.get("end", "")),
        ))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.get("/api/gold-liquidity/fx")
def gold_liquidity_fx_api():
    if not section_enabled("gold_liquidity"):
        return jsonify(error="Turn on the Gold Liquidity workload to fetch exchange rates."), 409
    try:
        return jsonify(fetch_usd_inr())
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.get("/api/gold-liquidity/india-adjustment")
def gold_liquidity_india_adjustment_api():
    if not section_enabled("gold_liquidity"):
        return jsonify(error="Turn on the Gold Liquidity workload to sync the MCX price."), 409
    try:
        return jsonify(fetch_india_market_adjustment())
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.get("/api/gold-liquidity/ticker")
def gold_liquidity_ticker_api():
    if not section_enabled("gold_liquidity"):
        return jsonify(error="Turn on the Gold Liquidity workload to fetch live prices."), 409
    try:
        return jsonify(fetch_gold_liquidity_ticker(str(request.args.get("exchange", "bybit"))))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 502


@app.get("/api/gold-liquidity/live")
def gold_liquidity_live_api():
    if not section_enabled("gold_liquidity"):
        return jsonify(error="Turn on the Gold Liquidity workload to refresh live data."), 409
    try:
        return jsonify(fetch_gold_liquidity_live(
            str(request.args.get("exchange", "bybit")),
            str(request.args.get("timeframe", "1m")),
        ))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        return jsonify(error=str(exc)), 502


def _technical_timeframes_ready(symbol: str) -> list[str]:
    try:
        with sqlite3.connect(TRADES_DB_PATH) as db:
            rows = db.execute("SELECT DISTINCT timeframe FROM technical_levels WHERE symbol=?", (symbol,)).fetchall()
        return sorted({row[0] for row in rows})
    except sqlite3.Error:
        return []


@app.post("/api/chart/analyze")
def chart_analyze_api():
    if not section_enabled("technical"):
        return jsonify(error="Turn on the Technical Analysis workload to analyze charts."), 409
    data = request.get_json(force=True)
    try:
        urls = data.get("urls") or [data.get("url", "")]
        urls = [str(url).strip() for url in urls if str(url).strip()]
        if not urls or len(urls) > 12:
            return jsonify(error="Enter between 1 and 12 Groww option URLs."), 400
        analyses, combined = [], []
        errors = []
        for url in urls:
            try:
                info, points = analyze_groww_chart(url, str(data.get("timeframe", "")).strip() or None)
                contract = f"{info['instrument'].get('index') or info['instrument']['symbol']} {info['instrument'].get('strike') or ''} {info['instrument'].get('option_type') or ''}".strip()
                info["contract_column"] = contract
                analyses.append(info)
                for point in points:
                    point["contract"] = contract
                    combined.append(point)
            except Exception as exc:
                errors.append({"url": url, "error": str(exc)})
        if not analyses:
            return jsonify(error="No contracts could be analyzed.", failures=errors), 400
        table = pivot_minute_prices(analyses, combined)
        first = analyses[0]
        chart_results.update(analysis=first, analyses=analyses, rows=combined, table=table)
        return jsonify(analysis=first, analyses=analyses, rows=combined, table=chart_results["table"], failures=errors)
    except Exception as exc:
        return jsonify(error=str(exc)), 400


@app.get("/api/chart/csv")
def chart_csv():
    if not chart_results["analysis"]: return jsonify(error="Analyze a chart first"), 404
    table = chart_results.get("table") or {"columns": [], "rows": []}
    import csv, io
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=table["columns"])
    writer.writeheader()
    writer.writerows(table["rows"])
    from flask import Response
    return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition":"attachment; filename=minute_prices.csv"})


@app.get("/api/chart/json")
def chart_json():
    if not chart_results["analysis"]: return jsonify(error="Analyze a chart first"), 404
    payload = {"analyses": chart_results["analyses"], "minute_table": chart_results["table"]}
    return app.response_class(json.dumps(payload, indent=2), mimetype="application/json", headers={"Content-Disposition":"attachment; filename=chart_analysis.json"})


@app.get("/api/chart/png")
def chart_image():
    if not chart_results["analysis"]: return jsonify(error="Analyze a chart first"), 404
    from flask import Response
    return Response(chart_png(chart_results["rows"]), mimetype="image/png", headers={"Content-Disposition":"attachment; filename=reconstructed_chart.png"})


@app.get("/api/chart/report")
def chart_report():
    if not chart_results["analysis"]: return jsonify(error="Analyze a chart first"), 404
    info = chart_results["analysis"]
    notes = "\n".join(f"- {warning}" for warning in info.get("warnings", [])) or "- No extraction warnings."
    report = (f"Groww options chart analysis\nURL: {info['input_url']}\nInstrument: {info['instrument'].get('symbol')}\n"
              f"Observed at: {info['observed_at']}\nDisplayed LTP: {info.get('current_displayed_ltp')}\n"
              f"Scale: {info.get('scale_type') or 'uncalibrated'}\nPoints: {info.get('point_count', 0)}\n"
              f"Price status: {'exact' if info.get('prices_exact') else 'estimated or unavailable'}\n"
              f"Calibration: {json.dumps(info.get('calibration'), ensure_ascii=False)}\nWarnings:\n{notes}\n")
    from flask import Response
    return Response(report, mimetype="text/plain", headers={"Content-Disposition":"attachment; filename=analysis_report.txt"})


@app.get("/api/config")
def get_config():
    # Do not expose credential contents; only the configured local path is returned.
    return jsonify(config)


@app.get("/api/workloads")
def get_workloads():
    with lock:
        return jsonify(workloads)


@app.post("/api/workloads")
def update_workloads():
    data = request.get_json(force=True)
    return jsonify(ok=True, **save_workloads(data))


@app.post("/api/config")
def update_config():
    data = request.get_json(force=True)
    data["refresh_seconds"] = min(60.0, max(0.1, float(data.get("refresh_seconds", 0.5))))
    for index in data.get("indices", []):
        if not valid_url(index.get("url", "")):
            return jsonify(error=f"Invalid URL for {index.get('name', 'index')}") , 400
    save_config(data)
    return jsonify(ok=True)


LAST_SNAPSHOT_PATH = DATA_DIR / "tradex_last_snapshot.json"
TRADES_DB_PATH = DATA_DIR / "tradex_trades.sqlite3"


def init_trades_db() -> None:
    with sqlite3.connect(TRADES_DB_PATH) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS closed_trades (
            position_id TEXT PRIMARY KEY,
            closed_at TEXT NOT NULL,
            symbol TEXT NOT NULL,
            strategy TEXT NOT NULL DEFAULT '',
            expiry TEXT NOT NULL DEFAULT '',
            realized_pnl REAL NOT NULL,
            trade_json TEXT NOT NULL
        )""")


init_trades_db()


@app.get("/api/trades/closed")
def get_closed_trades():
    with sqlite3.connect(TRADES_DB_PATH) as db:
        rows = db.execute(
            "SELECT trade_json FROM closed_trades ORDER BY closed_at DESC"
        ).fetchall()
    return jsonify([json.loads(row[0]) for row in rows])


@app.post("/api/trades/closed")
def save_closed_trade():
    trade = request.get_json() or {}
    position_id = str(trade.get("position_id", "")).strip()
    if not position_id or not isinstance(trade.get("position"), dict):
        return jsonify(error="A position id and position snapshot are required."), 400
    try:
        realized_pnl = float(trade.get("realized_pnl"))
    except (TypeError, ValueError):
        return jsonify(error="A valid realized P&L value is required."), 400

    trade["closed_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    trade["realized_pnl"] = realized_pnl
    position = trade["position"]
    try:
        with sqlite3.connect(TRADES_DB_PATH) as db:
            db.execute("""INSERT INTO closed_trades
                (position_id, closed_at, symbol, strategy, expiry, realized_pnl, trade_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (position_id, trade["closed_at"], str(position.get("index", "")),
                 str(position.get("strategy", "")), str(position.get("expiry", "")),
                 realized_pnl, json.dumps(trade, ensure_ascii=False)))
    except sqlite3.IntegrityError:
        return jsonify(error="This position has already been closed."), 409
    return jsonify(ok=True, trade=trade)


def save_last_snapshot(rows: list[dict[str, Any]], underlying_prices: dict[str, Any], timestamp: str,
                       option_chain_rows: Optional[list[dict[str, Any]]] = None) -> None:
    if len(rows) < 5 and len(option_chain_rows or []) < 5:
        return
    try:
        LAST_SNAPSHOT_PATH.write_text(json.dumps({
            "rows": rows,
            "option_chain_rows": option_chain_rows or rows,
            "option_chain_complete": bool(state.get("option_chain_complete", False)),
            "underlying_prices": underlying_prices,
            "underlying_details": state.get("underlying_details", {}),
            "last_update": timestamp
        }, indent=2), encoding="utf-8")
    except Exception:
        pass


def load_last_snapshot() -> Optional[dict[str, Any]]:
    if LAST_SNAPSHOT_PATH.is_file():
        try:
            return json.loads(LAST_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


@app.get("/api/state")
def get_state():
    result = {**state}
    enabled_names = {str(item.get("name", "")).strip().upper() for item in active_market_indices()}
    if enabled_names:
        result["rows"] = [row for row in result.get("rows", [])
                          if str(row.get("index", "")).strip().upper() in enabled_names]
        result["underlying_prices"] = {key: value for key, value in result.get("underlying_prices", {}).items()
                                       if str(key).strip().upper() in enabled_names}
        result["underlying_details"] = {key: value for key, value in result.get("underlying_details", {}).items()
                                        if str(key).strip().upper() in enabled_names}
    else:
        result["rows"] = []
        result["underlying_prices"] = {}
        result["underlying_details"] = {}
    result["workloads"] = workloads
    # Full chains are fetched on demand by each Portfolio PnL card. Keep the
    # fast dashboard polling payload compact.
    result.pop("option_chain_rows", None)
    result["market_lot_sizes"] = {
        str(item.get("name", "")): int(item.get("lot_size") or 0)
        for item in config.get("indices", [])
        if item.get("name") and item.get("lot_size")
    }
    with lock:
        result["enabled"] = scraping_enabled
        # If live rows or spot quotes are not yet available, fallback to the last available snapshot
        if scraping_enabled and (not result.get("rows") or len(result.get("rows", [])) < 5):
            cached = load_last_snapshot()
            if cached:
                result["rows"] = cached.get("rows", [])
                result["is_cached"] = True
                result["cached_from"] = cached.get("last_update")
                cached_prices = cached.get("underlying_prices", {})
                result["underlying_prices"] = {**cached_prices, **(result.get("underlying_prices") or {})}
                cached_details = cached.get("underlying_details", {})
                result["underlying_details"] = {**cached_details, **(result.get("underlying_details") or {})}
                if not result.get("last_update"):
                    result["last_update"] = cached.get("last_update")
            elif scraping_enabled and active_market_indices() and not state.get("scanning"):
                # If no cache and no rows, trigger poll
                threading.Thread(target=poll_once, daemon=True).start()
    # Apply filters after the cached-snapshot fallback too; disabled markets
    # must never be reintroduced by a previous all-markets snapshot.
    enabled_names = {str(item.get("name", "")).strip().upper() for item in active_market_indices()}
    result["rows"] = [row for row in result.get("rows", [])
                      if str(row.get("index", "")).strip().upper() in enabled_names]
    result["underlying_prices"] = {key: value for key, value in result.get("underlying_prices", {}).items()
                                   if str(key).strip().upper() in enabled_names}
    result["underlying_details"] = {key: value for key, value in result.get("underlying_details", {}).items()
                                    if str(key).strip().upper() in enabled_names}
    if not result.get("enabled"):
        result["rows"] = []
        result["underlying_prices"] = {}
        result["underlying_details"] = {}
    if section_enabled("pnl"):
        result["last_option_prices"] = {
            key: value for key, value in result.get("last_option_prices", {}).items()
            if str(value.get("index", "")).strip().upper() in enabled_names
        }
    else:
        result["last_option_prices"] = {}
    response = jsonify(result)
    # The standalone dashboard reads the packaged scraper's state across its
    # localhost port. This endpoint is read-only and has no credentialed access.
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/api/option-chain")
def get_full_option_chain():
    index = str(request.args.get("index", "")).strip().upper()
    expiry = str(request.args.get("expiry", "")).strip()
    if not index:
        return jsonify(error="An index name is required."), 400
    if not section_enabled("pnl"):
        return jsonify(error="Turn on the Position PnL workload to load option chains."), 409
    if not instrument_enabled(index):
        return jsonify(error=f"Turn on {index} in Markets to load its option chain."), 409
    with lock:
        rows = state.get("option_chain_rows") or []
        timestamp = state.get("last_update")
        complete = bool(state.get("option_chain_complete", False))
    if not rows:
        cached = load_last_snapshot() or {}
        rows = cached.get("option_chain_rows") or cached.get("rows") or []
        timestamp = timestamp or cached.get("last_update")
        complete = bool(cached.get("option_chain_complete", False))
    selected = [row for row in rows if str(row.get("index", "")).strip().upper() == index
                and (not expiry or str(row.get("expiry", "")).strip() == expiry)]
    response = jsonify(index=index, expiry=expiry, rows=selected, last_update=timestamp,
                       count=len(selected), full_chain=complete)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

@app.get("/progress")
def get_progress():
    progress_path = DATA_DIR / "progress.json"
    if progress_path.is_file():
        try:
            return jsonify(json.loads(progress_path.read_text()))
        except Exception:
            return jsonify({"total": 0, "completed": 0, "current_strike": ""})
    return jsonify({"total": 0, "completed": 0, "current_strike": ""})


@app.post("/api/scraping")
def scraping_api():
    global scraping_enabled
    data = request.get_json(force=True)
    requested = bool(data.get("enabled"))
    # Sheets is an optional destination. A stale or unavailable Sheets setup
    # should not prevent the local live dashboard from starting.
    if requested and config.get("sheets", {}).get("enabled"):
        sheet_cfg = config["sheets"]
        missing = [key for key in ("spreadsheet_id", "worksheet", "credentials_file") if not str(sheet_cfg.get(key, "")).strip()]
        if missing:
            log_event("Scraper started without Sheets: missing " + ", ".join(missing), "warning")
        elif not Path(sheet_cfg["credentials_file"]).expanduser().is_file():
            log_event("Scraper started; Sheets credentials file is unavailable", "warning")
        else:
            try:
                import gspread  # noqa: F401
                from google.oauth2.service_account import Credentials  # noqa: F401
            except ImportError:
                log_event("Scraper started; optional Google Sheets dependencies are unavailable", "warning")
    with lock:
        scraping_enabled = requested
        state["running"] = requested
        state["scanning"] = False
    refresh_sec = config.get("refresh_seconds", 2)
    log_event(f"Scraping started; live option chain refreshing every {refresh_sec}s" if requested else "Scraping stopped")
    if scraping_enabled:
        force_scan_event.set()
    else:
        force_scan_event.clear()
    refresh_event.set()
    return jsonify(ok=True, enabled=scraping_enabled)


@app.post("/api/shutdown")
def shutdown_api():
    """Stop scraping and the local server when the desktop app is switched off."""
    global scraping_enabled
    with lock:
        scraping_enabled = False
        state["running"] = False
        state["scanning"] = False
    force_scan_event.clear()
    refresh_event.set()
    log_event("TradeX backend shutdown requested")
    threading.Thread(target=stop_local_server, daemon=True, name="shutdown-server").start()
    return jsonify(ok=True)


@app.post("/api/scan_all_charts")
def api_scan_all_charts():
    def worker():
        try:
            log_event("Starting full scan of all SENSEX strike charts (CE & PE)...")
            from scan_all_strikes_to_sheets import scan_all_strikes_and_update_sheets
            res = scan_all_strikes_and_update_sheets(max_workers=3, push_sheets=True)
            log_event(f"Completed full chart sweep: {res['success_contracts']}/{res['total_contracts']} contracts uploaded to Google Sheets!")
        except Exception as exc:
            log_event(f"Full chart scan failed: {exc}", "error")

    threading.Thread(target=worker, daemon=True, name="scan-all-charts-worker").start()
    return jsonify(ok=True, message="Scan started in background")


def stop_local_server() -> None:
    # Give the HTTP response time to reach the dashboard before shutdown.
    time.sleep(0.35)
    stop_event.set()
    refresh_event.set()
    if http_server is not None:
        http_server.shutdown()


def shutdown_when_dashboard_closes(server: Any) -> None:
    """Stop the local server after all dashboard tabs stop polling it."""
    while not stop_event.wait(2):
        with lock:
            idle_for = time.monotonic() - last_dashboard_activity
        if idle_for >= IDLE_SHUTDOWN_SECONDS:
            stop_event.set()
            refresh_event.set()
            server.shutdown()
            return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    server = make_server("127.0.0.1", port, app, threaded=True)
    http_server = server
    poller = threading.Thread(target=poll_loop, daemon=True)
    sheets_worker = threading.Thread(target=sheets_loop, daemon=True)
    idle_watcher = threading.Thread(target=shutdown_when_dashboard_closes, args=(server,), daemon=True)
    # Keep the local API available for the desktop toggle, but wait to scrape
    # until the user explicitly switches the backend scraping on.
    if scraping_enabled:
        threading.Thread(target=poll_once, daemon=True, name="initial-poll").start()
    poller.start()
    sheets_worker.start()
    idle_watcher.start()
    try:
        server.serve_forever()
    finally:
        stop_event.set()
        refresh_event.set()
        poller.join(timeout=8)
        sheets_worker.join(timeout=2)
        if hasattr(server, "server_close"):
            server.server_close()
