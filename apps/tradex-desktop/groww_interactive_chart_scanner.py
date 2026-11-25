"""Interactive Groww Option Chart Scanner.

Sweeps the mouse cursor across the interactive Groww chart on screen,
captures the top display div showing price and timestamp (e.g. '435.00 | 11:23 AM'),
and extracts the minute-by-minute prices using OCR.

Works with:
- URL: https://groww.in/options/sp-bse-sensex/SENSEX26O2274100CE (or any Groww option chart)
- Screen OCR: macOS native Vision framework (instant, built-in) or pytesseract
- Cursor Bot: smooth, step-by-step horizontal sweep with failsafe
"""

from __future__ import annotations

import os
import re
import sys
import time
import json
import csv
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

from cursor_bot import CursorBot, FailSafeException


COORDS_FILE = Path(__file__).parent / "groww_coords.json"


def parse_price_and_timestamp(text: str) -> Tuple[Optional[float], Optional[str]]:
    """Extract price and timestamp from text like '435.00 | 11:23 AM' or '₹435.00  11:23 AM'."""
    # 1. Match timestamp: HH:MM with optional AM/PM
    time_match = re.search(r"(\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b)", text)
    stamp = None
    if time_match:
        raw_t = time_match.group(1).strip()
        try:
            if re.search(r"[a-zA-Z]", raw_t):
                # e.g. 11:23 AM
                t_obj = datetime.strptime(re.sub(r":\d{2}\b", "", raw_t), "%I:%M %p")
            else:
                # 24-hr or simple 11:23
                t_obj = datetime.strptime(re.sub(r":\d{2}\b", "", raw_t), "%H:%M")
            stamp = t_obj.strftime("%I:%M %p")
        except Exception:
            stamp = raw_t

    # 2. Extract price (exclude the matched time substring so hour/minute aren't parsed as price)
    cleaned = text
    if time_match:
        cleaned = text[:time_match.start()] + " " + text[time_match.end():]

    # Find float or decimal numbers
    price_matches = re.findall(r"(?:₹\s*)?([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)", cleaned)
    price = None
    for m in price_matches:
        val = m.replace(",", "")
        try:
            f = float(val)
            if f > 0:
                price = f
                break
        except ValueError:
            pass

    return price, stamp


def capture_roi_macos(x: int, y: int, width: int, height: int, output_png: str) -> bool:
    """Capture a specific screen rectangle using macOS screencapture."""
    # screencapture -R<x>,<y>,<w>,<h> -x (silent) <file>
    rect = f"{int(x)},{int(y)},{int(width)},{int(height)}"
    cmd = ["screencapture", "-R", rect, "-x", output_png]
    res = subprocess.run(cmd, capture_output=True)
    return res.returncode == 0 and os.path.exists(output_png)


def ocr_image_text(image_path: str) -> str:
    """Run fast macOS Vision OCR or pytesseract to read text from image."""
    # 1. Try macOS native Vision OCR (instant, built into macOS)
    if sys.platform == "darwin":
        swift_script = f'''
import Cocoa
import Vision

let imageURL = URL(fileURLWithPath: "{os.path.abspath(image_path)}")
guard let image = NSImage(contentsOf: imageURL),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {{
    exit(1)
}}

let request = VNRecognizeTextRequest {{ (req, err) in
    guard let obs = req.results as? [VNRecognizedTextObservation] else {{ return }}
    let strings = obs.compactMap {{ $0.topCandidates(1).first?.string }}
    print(strings.joined(separator: " "))
}}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
'''
        try:
            res = subprocess.run(["swift", "-"], input=swift_script, text=True, capture_output=True, timeout=5)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

    # 2. Fallback to pytesseract if installed
    try:
        import pytesseract
        from PIL import Image
        img = Image.open(image_path)
        return pytesseract.image_to_string(img).strip()
    except Exception:
        pass

    return ""


def calibrate_interactive(bot: CursorBot) -> dict:
    """Guided calibration to save screen coordinates of the chart and the display div."""
    print("=" * 60)
    print(" GROWW CHART SCREEN CALIBRATION")
    print("=" * 60)
    print("Open your browser with the Groww chart visible on screen.")
    print("We will capture 4 positions. Move your cursor to the requested spot")
    print("and wait 3 seconds for the countdown.\n")

    def capture_point(prompt: str) -> Tuple[float, float]:
        print(f"\n--> {prompt}")
        for i in range(3, 0, -1):
            print(f"    Capturing in {i} seconds... (position your mouse)")
            time.sleep(1)
        pos = bot.get_position()
        print(f"    Recorded: X={int(pos[0])}, Y={int(pos[1])}")
        return pos

    # 1. Top div ROI
    p1 = capture_point("1. Hover at TOP-LEFT corner of the price/timestamp display div")
    p2 = capture_point("2. Hover at BOTTOM-RIGHT corner of the price/timestamp display div")

    # 2. Graph sweep line
    p3 = capture_point("3. Hover at the LEFT edge of the chart line (9:15 AM start)")
    p4 = capture_point("4. Hover at the RIGHT edge of the chart line (3:30 PM end)")

    x = min(p1[0], p2[0])
    y = min(p1[1], p2[1])
    w = abs(p2[0] - p1[0])
    h = abs(p2[1] - p1[1])

    cfg = {
        "display_div_roi": {"x": int(x), "y": int(y), "width": int(w), "height": int(h)},
        "chart_sweep": {
            "start_x": int(p3[0]),
            "end_x": int(p4[0]),
            "y": int((p3[1] + p4[1]) / 2)
        }
    }

    with open(COORDS_FILE, "w") as f:
        json.dump(cfg, f, indent=2)

    print("\nCalibration saved to:", COORDS_FILE)
    print("Saved Configuration:")
    print(json.dumps(cfg, indent=2))
    return cfg


def scan_chart(
    cfg: dict,
    duration: float = 10.0,
    step_pixels: int = 4,
    step_pause: float = 0.04
) -> list[dict[str, Any]]:
    """Sweep the cursor across the chart and extract timestamped prices."""
    bot = CursorBot(fail_safe=True)

    roi = cfg["display_div_roi"]
    sweep = cfg["chart_sweep"]

    start_x = sweep["start_x"]
    end_x = sweep["end_x"]
    sweep_y = sweep["y"]

    total_dist = abs(end_x - start_x)
    direction = 1 if end_x >= start_x else -1
    steps = max(10, int(total_dist / step_pixels))
    pause_per_step = max(0.01, duration / steps) if duration else step_pause

    tmp_crop = "/tmp/groww_roi_snapshot.png"
    observed_data: dict[str, float] = {}

    print(f"\nStarting sweep from X={start_x} to X={end_x} (Y={sweep_y})...")
    print(f"Total steps: {steps} | Approx time: {round(steps * pause_per_step, 1)}s")
    print("Press Ctrl+C or push cursor to screen corner to abort anytime.\n")

    time.sleep(1)  # Brief prep delay

    try:
        for i in range(steps + 1):
            curr_x = start_x + direction * int(i * step_pixels)
            if (direction == 1 and curr_x > end_x) or (direction == -1 and curr_x < end_x):
                curr_x = end_x

            # 1. Move cursor to chart coordinate
            bot.move_to(curr_x, sweep_y)
            time.sleep(pause_per_step)

            # 2. Capture the display div
            if capture_roi_macos(roi["x"], roi["y"], roi["width"], roi["height"], tmp_crop):
                text = ocr_image_text(tmp_crop)
                price, stamp = parse_price_and_timestamp(text)
                if stamp and price is not None:
                    if stamp not in observed_data:
                        observed_data[stamp] = price
                        print(f"  [{stamp}] Price: ₹{price:.2f} (read from: '{text}')")

            if curr_x == end_x:
                break

    except (KeyboardInterrupt, FailSafeException) as e:
        print(f"\nSweep interrupted: {e}")

    # Build chronological output
    results = []
    for stamp, price in sorted(
        observed_data.items(),
        key=lambda item: datetime.strptime(item[0], "%I:%M %p") if ":" in item[0] else item[0]
    ):
        results.append({"timestamp": stamp, "price": price})

    print(f"\nCompleted: captured {len(results)} distinct minute price points.")
    return results


def save_results(results: list[dict[str, Any]], base_filename: str = "groww_prices") -> None:
    """Save extracted observations to CSV and JSON."""
    if not results:
        print("No data points to save.")
        return

    csv_path = f"{base_filename}.csv"
    json_path = f"{base_filename}.json"

    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "price"])
        writer.writeheader()
        writer.writerows(results)

    with open(json_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Data saved to:\n  - {csv_path}\n  - {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Groww Interactive Chart Scanner & Number Extractor")
    parser.add_argument("--calibrate", action="store_true", help="Run guided calibration to record screen coordinates")
    parser.add_argument("--duration", type=float, default=12.0, help="Total seconds for full chart sweep (default: 12.0)")
    parser.add_argument("--step", type=int, default=4, help="Pixel step between reads (default: 4)")
    parser.add_argument("--output", type=str, default="SENSEX26O2274100CE_prices", help="Base output filename")

    args = parser.parse_args()
    bot = CursorBot()

    if args.calibrate or not COORDS_FILE.exists():
        cfg = calibrate_interactive(bot)
        if args.calibrate:
            return
    else:
        with open(COORDS_FILE) as f:
            cfg = json.load(f)
        print("Loaded existing calibration from:", COORDS_FILE)

    results = scan_chart(cfg, duration=args.duration, step_pixels=args.step)
    save_results(results, args.output)


if __name__ == "__main__":
    main()
