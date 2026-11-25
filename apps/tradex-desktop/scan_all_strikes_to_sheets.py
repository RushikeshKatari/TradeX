"""Automated Option Chain Chart Scanner & Google Sheets Publisher.

Workflow:
1. Opens Groww SENSEX Option Chain (https://groww.in/options/sp-bse-sensex).
2. Discovers all option contracts (CE & PE) across available strikes.
3. Concurrently sweeps each contract's interactive chart from 09:15 AM to 03:39 PM.
4. Generates a clean wide table using 12-hour AM/PM time format:
   Header: ['Time', 'SENSEX <strike> CE', 'SENSEX <strike> PE', ...]
   Rows:   ['09:15 AM', price_ce, price_pe, ...]
           ...
           ['03:39 PM', price_ce, price_pe, ...]
5. Progressively updates the configured Google Sheet as each batch of contracts completes.
6. Saves local backup files (CSV and JSON).
"""

from __future__ import annotations

import os
import re
import csv
import json
import time
import socket
import argparse
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# Prefer IPv4 to avoid macOS LibreSSL IPv6 timeout on Google Sheets API
_orig_getaddrinfo = socket.getaddrinfo
def _getaddrinfo_v4(*args, **kwargs):
    res = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 if v4 else res
socket.getaddrinfo = _getaddrinfo_v4

try:
    import gspread
except ImportError:
    gspread = None  # optional, used only when Google Sheets publishing is enabled

try:
    from google.oauth2.service_account import Credentials
except ImportError:
    Credentials = None

from app import load_config, normalize_price
from chart_analyzer import analyze_url


# Import log_event from app if Flask is available, otherwise define a no-op logger
try:
    from app import log_event
except Exception:
    def log_event(message: str):
        # Simple fallback logger prints to console
        print(f"[LOG] {message}")



MARKET_START_STR = "09:15 AM"
MARKET_END_STR = "03:39 PM"


def generate_12hr_minute_grid() -> list[str]:
    """Return all minute labels from 09:15 AM to 03:39 PM."""
    grid = []
    curr = datetime(2000, 1, 1, 9, 15)
    end = datetime(2000, 1, 1, 15, 39)
    while curr <= end:
        grid.append(curr.strftime("%I:%M %p").lstrip('0'))
        curr += timedelta(minutes=1)
    return grid


def get_gspread_worksheet(sheet_cfg: dict[str, Any]):
    """Authenticate and return the Google Sheets worksheet."""
    creds_file = os.path.expanduser(sheet_cfg["credentials_file"])
    creds = Credentials.from_service_account_file(
        creds_file,
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(sheet_cfg["spreadsheet_id"])
    return spreadsheet.worksheet(sheet_cfg["worksheet"])


def clean_contract_label(name: str) -> str:
    """Convert 'SENSEX 74100 CE' or '74100 CE' to '74100 CE'."""
    m = re.search(r"(\d+)\s*(CE|PE)", str(name), re.I)
    if m:
        return f"{m.group(1)} {m.group(2).upper()}"
    return str(name).strip()


def push_to_sheets_12hr(
    new_contract_columns: dict[str, dict[str, Any]],
    sheet_cfg: dict[str, Any],
    session_date: Optional[str] = None
) -> int:
    """Incrementally merge and upload wide columns into Google Sheets with 12-hour AM/PM time.

    A1: Date (e.g. 2026-10-15)
    B1, C1...: Clean contract names (e.g. '74100 CE', '74100 PE')
    A2..A386: 12-hour minutes ('09:15 AM' to '03:39 PM')
    """
    if not sheet_cfg.get("enabled"):
        return 0

    ws = get_gspread_worksheet(sheet_cfg)
    grid_minutes = generate_12hr_minute_grid()
    existing_rows = ws.get_all_values()

    session_date = session_date or datetime.now().strftime("%Y-%m-%d")

    # Dictionary mapping: col_name -> {minute_label -> price_str}
    all_columns: dict[str, dict[str, Any]] = {}

    if existing_rows and len(existing_rows) > 1 and existing_rows[0]:
        existing_headers = [clean_contract_label(h) for h in existing_rows[0][1:]]
        for col_idx, col_name in enumerate(existing_headers, start=1):
            if not col_name.strip():
                continue
            col_data = {}
            for row_idx in range(1, len(existing_rows)):
                if row_idx - 1 < len(grid_minutes):
                    val = existing_rows[row_idx][col_idx] if col_idx < len(existing_rows[row_idx]) else ""
                    if val and val != "NA":
                        col_data[grid_minutes[row_idx - 1]] = val
            all_columns[col_name.strip()] = col_data

    # Merge newly scraped contracts with clean labels
    for raw_name, time_map in new_contract_columns.items():
        if time_map:
            col_name = clean_contract_label(raw_name)
            col_entry = all_columns.setdefault(col_name, {})
            col_entry.update(time_map)

    if not all_columns:
        return 0

    # Sort columns numerically by strike, then CE before PE
    def col_sort_key(name: str) -> tuple[int, int, str]:
        m = re.search(r"(\d+)\s*(CE|PE)", name)
        if m:
            strike = int(m.group(1))
            side_order = 0 if m.group(2) == "CE" else 1
            return (strike, side_order, name)
        return (9999999, 0, name)

    sorted_cols = sorted(all_columns.keys(), key=col_sort_key)
    header_row = [session_date] + sorted_cols

    output_rows = [header_row]
    for minute in grid_minutes:
        row = [minute]
        for col in sorted_cols:
            val = all_columns[col].get(minute, "")
            row.append(val if val is not None else "")
        output_rows.append(row)

    needed_cols = len(header_row)
    if ws.col_count < needed_cols:
        ws.add_cols(needed_cols - ws.col_count + 10)
    if ws.row_count < len(output_rows):
        ws.add_rows(len(output_rows) - ws.row_count + 50)

    ws.update(values=output_rows, range_name="A1", value_input_option="USER_ENTERED")
    return len(sorted_cols)


def extract_chain_links(chain_url: str = "https://groww.in/options/sp-bse-sensex") -> list[dict[str, Any]]:
    """Open option chain page and extract all CE and PE chart links.
    Uses Playwright if available; otherwise falls back to a simple HTTP GET via the stubbed
    `requests` module and parses the HTML with the stubbed `BeautifulSoup`.
    Returns a list of dictionaries with keys 'href' and 'text' for each discovered link.
    """
    # Try Playwright first
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None

    print(f"Loading option chain from: {chain_url} ...")
    links: list[dict[str, Any]] = []

    if sync_playwright:
        # Playwright path – same as before
        with sync_playwright() as p:
            browser = p.webkit.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(chain_url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(3000)
            for _ in range(7):
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(1500)
            page.wait_for_timeout(2000)
            links = page.evaluate("""() => Array.from(document.querySelectorAll('a[href*="/options/"]'),
                a => ({href: a.getAttribute('href'), text: (a.textContent || '').trim()}))""")
            browser.close()
    else:
        # Simple fallback using requests + BeautifulSoup stub
        try:
            import requests
            from bs4 import BeautifulSoup
        except Exception as e:
            print("Fallback modules not available:", e)
            return []
        response = requests.get(chain_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        # Find all anchor tags with href containing '/options/'
        for a in soup.select('a[href*="/options/"]'):
            href = a.get('href')
            text = a.get_text(strip=True)
            if href:
                links.append({"href": href, "text": text})

    discovered: dict[int, dict[str, Any]] = {}
    for link in links:
        href = str(link.get("href", ""))
        text = str(link.get("text", ""))
        ticker = href.rstrip("/").rsplit("/", 1)[-1].upper()
        match = re.search(r"(\d{2})([A-Z])(\d{2})(\d+)(CE|PE)$", ticker)
        if not match:
            continue
        yy, month_letter, day, strike_str, side = match.groups()
        strike = int(strike_str)
        full_url = urljoin("https://groww.in", href)
        entry = discovered.setdefault(strike, {"strike": strike, "CE": None, "PE": None, "has_price": False})
        entry[side] = full_url
        if "₹" in text:
            entry["has_price"] = True
    result = [discovered[s] for s in sorted(discovered.keys())]
    print(f"Discovered {len(result)} strikes ({len(result) * 2} potential CE & PE contracts).")
    return result


def analyze_single_contract(contract_info: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], Optional[str]]:
    """Worker to sweep a single contract chart."""
    col_name = contract_info["column"]
    url = contract_info["url"]
    try:
        analysis, rows = analyze_url(url, "1D")
        return contract_info, rows, None
    except Exception as exc:
        return contract_info, [], str(exc)


def scan_all_strikes_and_update_sheets(
    strikes_filter: Optional[list[int]] = None,
    max_workers: int = 4,
    push_sheets: bool = True,
    clear_first: bool = False
) -> dict[str, Any]:
    cfg = load_config()
    sheet_cfg = cfg.get("sheets", {})
    index_cfg = next((idx for idx in cfg.get("indices", []) if str(idx.get("name", "")).upper() == "SENSEX"), {})
    chain_url = index_cfg.get("url") or "https://groww.in/options/sp-bse-sensex"
    session_date_str = datetime.now().strftime("%Y-%m-%d")

    print("=" * 65)
    print(" SENSEX OPTION CHAIN AUTOMATED SCANNER (12-HR AM/PM FORMAT)")
    print("=" * 65)

    if clear_first and push_sheets and sheet_cfg.get("enabled"):
        print("Clearing Google Sheet for fresh start...")
        try:
            ws = get_gspread_worksheet(sheet_cfg)
            ws.clear()
            print("Google Sheet cleared.")
        except Exception as e:
            print("Could not clear Google Sheet:", e)

    # Discover contract chart links
    strike_entries = extract_chain_links(chain_url)
    if strikes_filter:
        strike_entries = [e for e in strike_entries if e["strike"] in strikes_filter]
        print(f"Filtered down to {len(strike_entries)} selected strike(s): {strikes_filter}")

    # Filter out strikes where neither CE nor PE chart is available
    strike_entries = [e for e in strike_entries if e.get("CE") or e.get("PE")]
    if not strike_entries:
        print("No valid strikes with available charts found.")

    # Build job list from discovered strike entries (only include sides with a chart)
    jobs: list[dict[str, Any]] = []
    for entry in strike_entries:
        for side in ("CE", "PE"):
            url = entry.get(side)
            if url:
                jobs.append({
                    "column": f"SENSEX {entry['strike']} {side}",
                    "url": url,
                })
    total_jobs = len(jobs)
    completed_count = 0
    success_count = 0
    new_contract_columns: dict[str, dict[str, Any]] = {}

    # Initial extraction of all contracts
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_job = {executor.submit(analyze_single_contract, job): job for job in jobs}
        for future in as_completed(future_to_job):
            job, rows, err = future.result()
            completed_count += 1
            if err:
                print(f"[Error] {job['column']}: {err}")
                continue
            if rows:
                # rows is a list of dicts with 'timestamp' and 'price'
                time_map = {r["timestamp"]: normalize_price(r.get("price")) for r in rows if r.get("price") is not None}
                new_contract_columns[job["column"]] = time_map
                success_count += 1
                log_event(f"Processing strike {job['column']}")
                # Write progress for UI
                try:
                    progress_path = Path(__file__).parent / "progress.json"
                    progress_data = {
                        "total": total_jobs,
                        "completed": completed_count,
                        "current_strike": job["column"]
                    }
                    progress_path.write_text(json.dumps(progress_data))
                except Exception:
                    pass
            # Progress display
            if completed_count % 10 == 0 or completed_count == total_jobs:
                print(f"Processed {completed_count}/{total_jobs} contracts (success: {success_count})")

    # ---------------------------------------------------
    # Fill missing minutes by re‑scanning contracts that have gaps
    # ---------------------------------------------------
    max_fill_iterations = 5
    iteration = 0
    while iteration < max_fill_iterations:
        iteration += 1
        # Determine which columns still have missing minutes
        missing_columns = []
        for col, minutes in new_contract_columns.items():
            missing = set(generate_12hr_minute_grid()) - set(minutes.keys())
            if missing:
                missing_columns.append(col)
        if not missing_columns:
            break
        print(f"\nIteration {iteration}: Re‑scanning {len(missing_columns)} contracts to fill missing minutes...\n")
        # Re‑run only those contracts
        refill_jobs = [job for job in jobs if job["column"] in missing_columns]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_job = {executor.submit(analyze_single_contract, job): job for job in refill_jobs}
            for future in as_completed(future_to_job):
                job, rows, err = future.result()
                if err:
                    print(f"[Error] (refill) {job['column']}: {err}")
                    continue
                if rows:
                    time_map = {r["timestamp"]: normalize_price(r.get("price")) for r in rows if r.get("price") is not None}
                    # Merge new data into existing column map (preserve previously filled values)
                    new_contract_columns[job["column"]].update(time_map)
        # Loop again to check if any gaps remain

    # After all data gathered, push to Google Sheets
    if push_sheets:
        pushed = push_to_sheets_12hr(new_contract_columns, sheet_cfg, session_date_str)
        print(f"\n✅ Uploaded {pushed} contract columns to Google Sheet.")
    else:
        print("\n⚠️ Sheet upload disabled – data was collected locally.")

    # Return a summary dict
    return {
        "total_jobs": total_jobs,
        "completed": completed_count,
        "successful": success_count,
        "uploaded_columns": pushed if push_sheets else 0,
    }
    collected_by_contract: dict[str, dict[str, Any]] = {}

    print(f"\nSweeping interactive charts using {max_workers} concurrent workers...\n")

    grid_minutes = set(generate_12hr_minute_grid())

    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="groww-chart") as executor:
        futures = {executor.submit(analyze_single_contract, job): job for job in jobs}
        for future in as_completed(futures):
            job, rows, error = future.result()
            completed_count += 1
            col = job["column"]

            if error:
                print(f"  [{completed_count}/{total_jobs}] ❌ {col}: Failed ({error[:60]})")
            elif not rows:
                print(f"  [{completed_count}/{total_jobs}] ⚠️ {col}: No chart / zero trades")
            else:
                contract_minute_prices = {}
                for pt in rows:
                    stamp = pt.get("timestamp")
                    if stamp in grid_minutes:
                        contract_minute_prices[stamp] = normalize_price(pt.get("estimated_premium"))

                if contract_minute_prices:
                    collected_by_contract[col] = contract_minute_prices
                    success_count += 1
                    print(f"  [{completed_count}/{total_jobs}] ✅ {col}: {len(contract_minute_prices)} minute prices recovered")

            # Checkpoint push to Google Sheets every 5 contracts with data
            if push_sheets and sheet_cfg.get("enabled") and (completed_count % 5 == 0 or completed_count == total_jobs):
                if collected_by_contract:
                    try:
                        col_count = push_to_sheets_12hr(collected_by_contract, sheet_cfg, session_date=session_date_str)
                        print(f"  📊 Checkpoint [{completed_count}/{total_jobs}]: Updated Google Sheet with {col_count} columns (12-hr format)")
                    except Exception as exc:
                        print(f"  ⚠️ Checkpoint Google Sheet push error: {exc}")

    print(f"\nSweep complete: {success_count}/{total_jobs} contracts successfully parsed.")

    # Save local backup files
    grid_all = generate_12hr_minute_grid()
    sorted_cols = sorted(collected_by_contract.keys())
    csv_file = "sensex_all_strikes_12hr.csv"
    with open(csv_file, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([session_date_str] + [clean_contract_label(c) for c in sorted_cols])
        for minute in grid_all:
            row = [minute] + [collected_by_contract[c].get(minute, "") for c in sorted_cols]
            writer.writerow(row)
    print(f"Saved local backup: {csv_file}")

    # Final Google Sheets push
    if push_sheets and sheet_cfg.get("enabled") and collected_by_contract:
        try:
            total_in_sheet = push_to_sheets_12hr(collected_by_contract, sheet_cfg, session_date=session_date_str)
            print(f"🎉 Final Google Sheet updated with {total_in_sheet} columns in 12-hour AM/PM format!")
        except Exception as exc:
            print(f"❌ Final Google Sheet push error: {exc}")

    return {
        "total_contracts": total_jobs,
        "success_contracts": success_count,
        "contracts_recorded": len(collected_by_contract)
    }


def main():
    parser = argparse.ArgumentParser(description="Scan all SENSEX strikes (CE & PE) and upload to Google Sheets")
    parser.add_argument("--strikes", nargs="+", type=int, help="Optional strike filter (e.g. --strikes 74000 74100)")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent workers (default: 4)")
    parser.add_argument("--no-sheets", action="store_true", help="Skip Google Sheets upload")
    parser.add_argument("--clear", action="store_true", help="Clear sheet before starting")

    args = parser.parse_args()
    scan_all_strikes_and_update_sheets(
        strikes_filter=args.strikes,
        max_workers=args.workers,
        push_sheets=not args.no_sheets,
        clear_first=args.clear
    )


if __name__ == "__main__":
    main()
