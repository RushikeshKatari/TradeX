"""
groww_scraper.py
~~~~~~~~~~~~~~~~
Scrapes live equity and commodity option chain data from Groww by extracting
the __NEXT_DATA__ JSON that Next.js embeds in each page's HTML — no browser
or Playwright required.

Public API
----------
fetch_option_chain(slug, index_url) → dict
    Returns a dict with keys:
        rows              : list of {index, expiry, strike, call, put, groww_ce_url, groww_pe_url}
        underlying_price  : float
        expiry            : str  (YYYY-MM-DD)
        lot_size          : int
        expiry_dates      : list[str]
        fetched_at        : ISO timestamp

fetch_spot_price(symbol, exchange) → float
    Uses Groww's public indices API as a quick spot-price lookup.
"""

import json
import re
import time
import logging
import subprocess
import urllib.request
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

try:
    import requests
    from requests import HTTPAdapter, Retry
except ImportError:
    requests = None  # will raise a friendly error at call time

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

GROWW_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

SPOT_API_BASE = "https://groww.in/v1/api/stocks_data/v1/accord_points"
GROWW_OPTIONS_BASE = "https://groww.in/options"

# slug → (exchange, symbol for spot API)
INDEX_META = {
    "sp-bse-sensex": {"exchange": "BSE", "symbol": "SENSEX", "name": "SENSEX"},
    "nifty":         {"exchange": "NSE", "symbol": "NIFTY",  "name": "NIFTY"},
    "mcx_goldm": {"exchange": "MCX", "symbol": "GOLDM", "name": "GOLDM", "lot_size": 10},
    "mcx_silverm": {"exchange": "MCX", "symbol": "SILVERM", "name": "SILVERM", "lot_size": 5},
}


def _make_session(retries: int = 3, backoff: float = 1.0) -> "requests.Session":
    if requests is None:
        raise RuntimeError("requests library is required. Run: pip install requests")
    session = requests.Session()
    retry = Retry(
        total=retries,
        backoff_factor=backoff,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(GROWW_HEADERS)
    return session


def _extract_next_data(html: str) -> dict:
    """Extract and parse the __NEXT_DATA__ JSON blob from Groww page HTML."""
    marker = '__NEXT_DATA__'
    idx = html.find(marker)
    if idx != -1:
        start = html.find('>', idx)
        if start != -1:
            end = html.find('</script>', start)
            if end != -1:
                try:
                    return json.loads(html[start + 1:end])
                except Exception:
                    pass
    m = re.search(
        r'<script\s+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        raise ValueError("__NEXT_DATA__ script tag not found in page HTML")
    return json.loads(m.group(1))


def _fetch_html(url: str, session: Optional["requests.Session"] = None, timeout: int = 20) -> str:
    """Fetch HTML with requests, falling back to curl subprocess if blocked or failed."""
    sess = session or _make_session()
    try:
        resp = sess.get(url, timeout=timeout)
        resp.raise_for_status()
        if resp.text:
            return resp.text
    except Exception as exc:
        log.warning("Requests fetch failed for %s (%s). Attempting curl fallback...", url, exc)

    # Subprocess curl fallback
    try:
        cmd = [
            "curl", "-s", "--compressed",
            "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H", f"User-Agent: {GROWW_HEADERS['User-Agent']}",
            "-H", "Accept-Language: en-IN,en;q=0.9",
            url,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if proc.returncode == 0 and proc.stdout and "__NEXT_DATA__" in proc.stdout:
            return proc.stdout
    except Exception as curl_exc:
        log.error("Curl fallback failed for %s: %s", url, curl_exc)

    raise RuntimeError(f"Unable to fetch HTML from {url}")


def fetch_option_chain(
    slug: str,
    session: Optional["requests.Session"] = None,
    timeout: int = 20,
    strikes_above_below: Optional[int] = 10,
    expiry: Optional[str] = None,
    commodity: bool = False,
    exclude_illiquid: bool = False,
    lot_size: Optional[int] = None,
) -> dict:
    """
    Fetch option chain for the given Groww slug.

    Parameters
    ----------
    slug : str
        e.g. "sp-bse-sensex" or "nifty" or "tata-consultancy-services-ltd"
    session : requests.Session, optional
        Reuse an existing session (for connection pooling).
    timeout : int
        HTTP request timeout in seconds.
    strikes_above_below : int, optional
        Number of strikes to load above and below the ATM strike (default 10).
        If None or 0, loads all available strikes.
    expiry : str, optional
        Specific expiry date (YYYY-MM-DD) to fetch. If None, fetches the nearest expiry.

    Returns
    -------
    dict with keys: rows, underlying_price, expiry, lot_size, expiry_dates, fetched_at
    """
    if requests is None:
        raise RuntimeError("requests library is required. Run: pip install requests")

    meta = INDEX_META.get(slug, {"exchange": "NSE", "symbol": slug.upper(), "name": slug.upper()})
    index_name = meta["name"]
    page_base = "https://groww.in/commodities/options" if commodity else GROWW_OPTIONS_BASE
    url = f"{page_base}/{slug}"
    query = []
    if expiry:
        query.append(f"expiry={expiry}")
    if commodity and exclude_illiquid:
        query.append("excludeIlliquid=true")
    if query:
        url += "?" + "&".join(query)

    log.info("Fetching Groww option chain: %s", url)
    html = _fetch_html(url, session=session, timeout=timeout)
    data = _extract_next_data(html)

    page_data = data["props"]["pageProps"]["data"]
    option_chain = page_data["optionChain"]
    aggregated = option_chain.get("aggregatedDetails", {})
    contracts = option_chain.get("optionContracts", [])

    # ── Spot price & change ────────────────────────────────────────────────
    underlying_price: float = 0.0
    day_change: float = 0.0
    day_change_perc: float = 0.0
    prev_close: float = 0.0
    try:
        live = page_data.get("company", {}).get("liveData", {})
        underlying_price = float(live.get("ltp") or live.get("close") or 0.0)
        day_change = float(live.get("dayChange") or 0.0)
        day_change_perc = float(live.get("dayChangePerc") or 0.0)
        prev_close = float(live.get("close") or 0.0)
    except (KeyError, TypeError, ValueError):
        pass

    if not underlying_price and not commodity:
        # Fallback to spot API
        try:
            underlying_price = fetch_spot_price(
                meta["symbol"], meta["exchange"], session=sess, timeout=timeout
            )
        except Exception as exc:
            log.warning("Spot price fallback failed: %s", exc)

    # ── Expiry ─────────────────────────────────────────────────────────────
    expiry = aggregated.get("currentExpiry", "")
    expiry_dates: list = aggregated.get("expiryDates", [])
    lot_size: int = int(aggregated.get("lotSize") or lot_size or meta.get("lot_size") or (20 if "sensex" in slug else 65))

    # ── Rows ───────────────────────────────────────────────────────────────
    # Pre-filter contracts around ATM before parsing to minimize processing time
    if strikes_above_below is not None and strikes_above_below > 0 and underlying_price > 0 and len(contracts) > strikes_above_below * 2:
        contracts.sort(key=lambda c: int(c.get("strikePrice", 0)))
        atm_idx = min(
            range(len(contracts)),
            key=lambda i: abs((int(contracts[i].get("strikePrice", 0)) // 100) - underlying_price)
        )
        start_idx = max(0, atm_idx - strikes_above_below)
        end_idx = min(len(contracts), atm_idx + strikes_above_below + 1)
        contracts = contracts[start_idx:end_idx]

    if commodity and contracts:
        _refresh_commodity_live_prices(contracts, url, timeout)

    rows = []
    for contract in contracts:
        raw_strike = contract.get("strikePrice", 0)
        strike = str(int(raw_strike) // 100)  # paise → rupees

        ce_data = contract.get("ce") or {}
        pe_data = contract.get("pe") or {}

        ce_ltp = _safe_ltp(ce_data)
        pe_ltp = _safe_ltp(pe_data)

        if not ce_ltp and not pe_ltp:
            continue  # skip fully empty rows

        # Build Groww direct URLs from growwContractId (MUST be uppercase for Groww contract pages)
        ce_id = ce_data.get("growwContractId", "")
        pe_id = pe_data.get("growwContractId", "")
        ce_url = f"{page_base}/{slug}/{ce_id.upper()}" if ce_id else ""
        pe_url = f"{page_base}/{slug}/{pe_id.upper()}" if pe_id else ""

        rows.append({
            "index":        index_name,
            "expiry":       expiry,
            "strike":       strike,
            "call":         ce_ltp,
            "put":          pe_ltp,
            "call_oi":      str(ce_data.get("liveData", {}).get("oi", "")),
            "put_oi":       str(pe_data.get("liveData", {}).get("oi", "")),
            "call_iv":      str(ce_data.get("greeks", {}).get("iv", "") or ""),
            "put_iv":       str(pe_data.get("greeks", {}).get("iv", "") or ""),
            "groww_ce_url": ce_url,
            "groww_pe_url": pe_url,
            # keep chart_urls compatible with existing app.py code
            "chart_urls":   {
                "CE": ce_url,
                "PE": pe_url,
            },
        })

    # Sort rows by numeric strike ascending
    rows.sort(key=lambda r: float(r["strike"]) if str(r.get("strike", "")).replace(".", "", 1).isdigit() else 0.0)

    # Filter to 10 strikes above and 10 strikes below ATM strike
    if strikes_above_below is not None and strikes_above_below > 0 and underlying_price > 0 and rows:
        atm_idx = min(
            range(len(rows)),
            key=lambda i: abs(float(rows[i]["strike"]) - underlying_price)
            if str(rows[i].get("strike", "")).replace(".", "", 1).isdigit() else float("inf")
        )
        start_idx = max(0, atm_idx - strikes_above_below)
        end_idx = min(len(rows), atm_idx + strikes_above_below + 1)
        rows = rows[start_idx:end_idx]

    log.info(
        "Fetched %d %s contracts (around ATM). Spot=%.2f Expiry=%s",
        len(rows), index_name, underlying_price, expiry,
    )

    return {
        "rows":             rows,
        "underlying_price": underlying_price,
        "day_change":       day_change,
        "day_change_perc":  day_change_perc,
        "prev_close":       prev_close,
        "expiry":           expiry,
        "lot_size":         lot_size,
        "expiry_dates":     expiry_dates,
        "fetched_at":       datetime.now().isoformat(),
    }


def fetch_spot_price(
    symbol: str,
    exchange: str = "NSE",
    session: Optional["requests.Session"] = None,
    timeout: int = 10,
) -> float:
    """
    Quick spot-price lookup using Groww's public indices endpoint.

    Parameters
    ----------
    symbol   : "SENSEX" | "NIFTY" | any valid Groww symbol
    exchange : "BSE" | "NSE"
    """
    if requests is None:
        raise RuntimeError("requests library is required.")
    sess = session or _make_session()
    url = f"{SPOT_API_BASE}/exchange/{exchange}/segment/CASH/latest_indices_ohlc/{symbol}"
    headers = {
        "User-Agent": GROWW_HEADERS["User-Agent"],
        "Accept": "application/json",
        "Referer": f"https://groww.in/indices/{symbol.lower()}",
    }
    resp = sess.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    # prefer ltp (live), fall back to close
    price = data.get("value") or data.get("indexIndicativePrice") or data.get("close") or 0
    return float(price)


def _safe_ltp(contract_side: dict) -> str:
    """Return LTP as a string, preferring live ltp over close."""
    if not contract_side:
        return ""
    live = contract_side.get("liveData") or {}
    ltp = live.get("ltp")
    if ltp is not None:
        try:
            return str(round(float(ltp), 2))
        except (TypeError, ValueError):
            pass
    close = live.get("close")
    if close is not None:
        try:
            return str(round(float(close), 2))
        except (TypeError, ValueError):
            pass
    return ""


def _refresh_commodity_live_prices(contracts: list, page_url: str, timeout: int) -> None:
    """Fetch MCX option quotes from Groww's live batch endpoint.

    Commodity option prices can be zero in the page's embedded Next.js data
    while the live quote endpoint already has the current premium.
    """
    tokens = list(dict.fromkeys(
        str(side.get("token"))
        for contract in contracts
        for side in (contract.get("ce") or {}, contract.get("pe") or {})
        if side.get("token")
    ))
    if not tokens:
        return
    endpoint = "https://groww.in/v1/api/commodity_fo/v1/tr_live_prices/exchange/MCX/segment/COMMODITY/latest_prices_batch"
    payload = json.dumps(tokens).encode("utf-8")
    req = urllib.request.Request(endpoint, data=payload, method="POST", headers={
        "User-Agent": GROWW_HEADERS["User-Agent"],
        "Origin": "https://groww.in",
        "Referer": page_url,
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            prices = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        log.warning("Commodity live quote refresh failed: %s", exc)
        return
    if not isinstance(prices, dict):
        return
    for contract in contracts:
        for side_name in ("ce", "pe"):
            side = contract.get(side_name) or {}
            quote = prices.get(str(side.get("token", "")))
            if not isinstance(quote, dict):
                continue
            live = side.setdefault("liveData", {})
            for field in ("ltp", "close", "dayChange", "dayChangePerc", "oi"):
                value = quote.get(field)
                if value is not None:
                    live[field] = value


# ── CLI quick-test ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    slug = sys.argv[1] if len(sys.argv) > 1 else "sp-bse-sensex"
    result = fetch_option_chain(slug)

    print(f"\nIndex     : {result['rows'][0]['index'] if result['rows'] else 'N/A'}")
    print(f"Spot      : ₹{result['underlying_price']:,.2f}")
    print(f"Expiry    : {result['expiry']}")
    print(f"Lot size  : {result['lot_size']}")
    print(f"Contracts : {len(result['rows'])}")
    print(f"Fetched at: {result['fetched_at']}")
    print("\nSample rows (around ATM):")
    spot = result["underlying_price"]
    atm_rows = sorted(result["rows"], key=lambda r: abs(int(r["strike"]) - spot))[:10]
    for r in sorted(atm_rows, key=lambda r: int(r["strike"])):
        print(f"  {r['strike']:>6}  CE={r['call']:>8}  PE={r['put']:>8}  CE_OI={r['call_oi']}  PE_OI={r['put_oi']}")
