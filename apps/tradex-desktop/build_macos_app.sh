#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/TradeX.app"
RES="$APP/Contents/Resources"
RUNTIME="$HOME/Library/Application Support/TradeX/runtime/.venv"
PLAYWRIGHT_CACHE="$HOME/Library/Caches/ms-playwright"
if [[ ! -d "$RUNTIME" ]]; then
  echo "TradeX runtime not found at $RUNTIME. Run install_macos.sh first." >&2
  exit 1
fi
CHROMIUM_EXECUTABLE="$(PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_CACHE" "$RUNTIME/bin/python" -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()')"
BROWSER_REVISION="$(printf '%s' "$CHROMIUM_EXECUTABLE" | sed -E 's#^.*/chromium(_headless_shell)?-([0-9]+)/.*$#\2#')"
CHROMIUM="$PLAYWRIGHT_CACHE/chromium-$BROWSER_REVISION"
HEADLESS_SHELL="$PLAYWRIGHT_CACHE/chromium_headless_shell-$BROWSER_REVISION"
if [[ ! -d "$CHROMIUM" || ! -d "$HEADLESS_SHELL" ]]; then
  echo "Playwright Chromium not found in $PLAYWRIGHT_CACHE. Run install_macos.sh first." >&2
  exit 1
fi
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/backend" "$RES/runtime" "$RES/ms-playwright"
LOGO_PYTHON="$RUNTIME/bin/python"
if ! "$LOGO_PYTHON" -c 'import PIL' >/dev/null 2>&1; then
  LOGO_PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$LOGO_PYTHON" ]] || ! "$LOGO_PYTHON" -c 'import PIL' >/dev/null 2>&1; then
  echo "Pillow is required to generate app icons. Install requirements.txt and retry." >&2
  exit 1
fi
"$LOGO_PYTHON" "$ROOT/generate_logo_assets.py"
cp "$ROOT/assets/TradeX.icns" "$RES/TradeX.icns"
cp "$ROOT/app.py" "$ROOT/chart_analyzer.py" "$ROOT/technical_analysis.py" "$ROOT/market_intelligence.py" "$ROOT/gold_liquidity.py" "$ROOT/groww_scraper.py" "$ROOT/scan_all_strikes_to_sheets.py" "$ROOT/sweep_and_extract_groww.py" "$ROOT/groww_interactive_chart_scanner.py" "$ROOT/ocr_number_extractor.py" "$ROOT/requirements.txt" "$RES/backend/"
cp "$ROOT/tradex_config.example.json" "$RES/backend/tradex_config.json"
cp -R "$ROOT/templates" "$ROOT/static" "$ROOT/flask" "$ROOT/werkzeug" "$ROOT/requests" "$ROOT/bs4" "$RES/backend/"
cp -R "$RUNTIME/." "$RES/runtime/"
cp -R "$CHROMIUM" "$HEADLESS_SHELL" "$RES/ms-playwright/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TradeX</string>
<key>CFBundleIdentifier</key><string>com.tradex.desktop</string>
<key>CFBundleName</key><string>TradeX</string>
<key>CFBundleIconFile</key><string>TradeX.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
xcrun swiftc -parse-as-library "$ROOT/packaging/TradeXApp.swift" -o "$APP/Contents/MacOS/TradeX" -framework AppKit -framework WebKit
chmod +x "$APP/Contents/MacOS/TradeX"
echo "Built $APP"
