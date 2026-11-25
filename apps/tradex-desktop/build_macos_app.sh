#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/TradeX.app"
RES="$APP/Contents/Resources"
RUNTIME="$HOME/Library/Application Support/TradeX/runtime/.venv"
BROWSER="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1223"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/backend" "$RES/runtime" "$RES/ms-playwright"
cp "$ROOT/app.py" "$ROOT/chart_analyzer.py" "$ROOT/technical_analysis.py" "$ROOT/market_intelligence.py" "$ROOT/groww_scraper.py" "$ROOT/scan_all_strikes_to_sheets.py" "$ROOT/sweep_and_extract_groww.py" "$ROOT/groww_interactive_chart_scanner.py" "$ROOT/ocr_number_extractor.py" "$ROOT/requirements.txt" "$RES/backend/"
cp "$ROOT/tradex_config.example.json" "$RES/backend/tradex_config.json"
cp -R "$ROOT/templates" "$ROOT/static" "$ROOT/flask" "$ROOT/werkzeug" "$ROOT/requests" "$ROOT/bs4" "$RES/backend/"
cp -R "$RUNTIME/." "$RES/runtime/"
cp -R "$BROWSER" "$RES/ms-playwright/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TradeX</string>
<key>CFBundleIdentifier</key><string>com.tradex.desktop</string>
<key>CFBundleName</key><string>TradeX</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
xcrun swiftc -parse-as-library "$ROOT/packaging/TradeXApp.swift" -o "$APP/Contents/MacOS/TradeX" -framework AppKit -framework WebKit
chmod +x "$APP/Contents/MacOS/TradeX"
echo "Built $APP"
