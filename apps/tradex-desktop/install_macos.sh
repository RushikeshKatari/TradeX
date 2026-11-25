#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HOME/Library/Application Support/TradeX/runtime/.venv"
APP_DEST="$HOME/Applications/TradeX.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS." >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "Install Xcode Command Line Tools first: xcode-select --install" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Install Python 3.11 or newer, then run this installer again." >&2
  exit 1
fi
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' || {
  echo "Python 3.11 or newer is required. Select it with the python3 command and try again." >&2
  exit 1
}

mkdir -p "$(dirname "$RUNTIME")" "$HOME/Library/Caches/ms-playwright" "$HOME/Applications"
python3 -m venv "$RUNTIME"
"$RUNTIME/bin/python" -m pip install --upgrade pip
"$RUNTIME/bin/python" -m pip install -r "$ROOT/requirements.txt"
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
  "$RUNTIME/bin/python" -m playwright install chromium

"$ROOT/build_macos_app.sh"
rm -rf "$APP_DEST"
cp -R "$ROOT/TradeX.app" "$APP_DEST"
open -a "$APP_DEST"
echo "TradeX is installed at $APP_DEST"
