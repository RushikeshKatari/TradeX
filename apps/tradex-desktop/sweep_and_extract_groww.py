"""Live Sweep and Extraction for Groww Option Interactive Chart.

Target URL: https://groww.in/options/sp-bse-sensex/SENSEX26O2274100CE

Workflow:
1. Launches Chrome with the Groww option chart.
2. Identifies the interactive chart SVG and the top price/time tooltip div.
3. Sweeps the cursor smoothly across the chart line (9:15 AM to 3:30 PM).
4. Extracts exact displayed price and timestamp from the tooltip:
   e.g. '<span class="bodySmallHeavy">₹510.00</span>| 12:12 PM'
5. Saves the results to CSV and JSON, displaying a clean table of the results.
"""

from __future__ import annotations

import re
import csv
import json
import time
from datetime import datetime
from typing import Dict, Any, List
from playwright.sync_api import sync_playwright


TARGET_URL = "https://groww.in/options/sp-bse-sensex/SENSEX26O2274100CE"


def parse_tooltip_text(text: str) -> tuple[float | None, str | None]:
    """Parse string like '₹510.00| 12:12 PM' into (510.0, '12:12 PM')."""
    # 1. Match timestamp
    time_match = re.search(r"(\b\d{1,2}:\d{2}\s*(?:AM|PM)\b)", text, re.I)
    if not time_match:
        return None, None
    raw_time = time_match.group(1).strip()
    try:
        stamp = datetime.strptime(raw_time, "%I:%M %p").strftime("%I:%M %p")
    except Exception:
        stamp = raw_time

    # 2. Match price
    price_match = re.search(r"₹\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)", text)
    if not price_match:
        # Fallback without currency symbol
        price_match = re.search(r"([0-9]+(?:\.[0-9]+))", text[:time_match.start()])

    if not price_match:
        return None, None

    try:
        price = float(price_match.group(1).replace(",", ""))
        return price, stamp
    except ValueError:
        return None, None


def sweep_chart(url: str = TARGET_URL, step_px: int = 2) -> list[dict[str, Any]]:
    print(f"Opening {url} ...")
    data_by_time: dict[str, float] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(4000)

        # Locate chart SVG
        chart_info = page.evaluate("""() => {
            const svgs = Array.from(document.querySelectorAll('svg')).filter(s => {
                const r = s.getBoundingClientRect();
                return r.width > 400 && r.height > 150;
            });
            if (!svgs.length) return null;
            const r = svgs[0].getBoundingClientRect();
            return {x: r.x, y: r.y, width: r.width, height: r.height};
        }""")

        if not chart_info:
            raise RuntimeError("Chart SVG element was not found on page.")

        print(f"Chart located at X={chart_info['x']}, Y={chart_info['y']}, Width={chart_info['width']}, Height={chart_info['height']}")

        start_x = int(chart_info["x"] + 2)
        end_x = int(chart_info["x"] + chart_info["width"] - 2)
        y = int(chart_info["y"] + chart_info["height"] * 0.5)

        total_pixels = end_x - start_x
        print(f"Sweeping cursor from X={start_x} to X={end_x} (Y={y}) in steps of {step_px}px...")

        last_stamp = None
        for curr_x in range(start_x, end_x + 1, step_px):
            page.mouse.move(curr_x, y)
            page.wait_for_timeout(15)

            # Read tooltip div text
            tooltip_text = page.evaluate("""() => {
                const node = document.querySelector('.contentPrimary.bodySmall');
                if (node && node.innerText && node.innerText.includes('|')) {
                    return node.innerText;
                }
                // Fallback: check all small divs with '|'
                const all = Array.from(document.querySelectorAll('div'));
                for (const d of all) {
                    if (d.children.length <= 2 && d.innerText && d.innerText.includes('|') && /\\d+:\\d+/.test(d.innerText)) {
                        return d.innerText;
                    }
                }
                return '';
            }""")

            if tooltip_text:
                price, stamp = parse_tooltip_text(tooltip_text)
                if stamp and price is not None and stamp != last_stamp:
                    if stamp not in data_by_time:
                        data_by_time[stamp] = price
                        print(f"  [{stamp}] Price: ₹{price:.2f}")
                    last_stamp = stamp

        browser.close()

    # Sort chronologically
    sorted_rows = []
    for stamp, price in sorted(data_by_time.items(), key=lambda x: datetime.strptime(x[0], "%I:%M %p")):
        sorted_rows.append({"timestamp": stamp, "price": price})

    return sorted_rows


if __name__ == "__main__":
    results = sweep_chart()
    print("\n" + "=" * 50)
    print(f"SWEEP COMPLETE: {len(results)} minute price points extracted.")
    print("=" * 50)

    # Save to CSV
    csv_file = "SENSEX26O2274100CE_extracted.csv"
    with open(csv_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "price"])
        writer.writeheader()
        writer.writerows(results)

    # Save to JSON
    json_file = "SENSEX26O2274100CE_extracted.json"
    with open(json_file, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Saved results to:\n- {csv_file}\n- {json_file}")
