# TradeX Universal Options Chain Scraper

A local dashboard for equity and commodity option chains, selecting exact strikes and expiries, and optionally publishing matches to Google Sheets. The built-in markets are NIFTY and SENSEX under Equity, plus Gold Mini and Silver Mini under Commodity.

The supplied TradeX logo appears in the dashboard and as the macOS app and Windows shortcut icon. Its source and generated icons are kept under `assets/`; run `python generate_logo_assets.py` after replacing the source image to regenerate them.

## Install the desktop app

Use the repository root README for complete Windows and macOS installation commands. In short:

- **Windows:** Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install_windows.ps1` from this folder. It installs to `%LOCALAPPDATA%\Programs\TradeX`, creates a desktop shortcut, and opens the local dashboard.
- **macOS:** Run `chmod +x install_macos.sh && ./install_macos.sh` from this folder. It builds and installs `~/Applications/TradeX.app`. The existing `build_macos_app.sh` remains available for rebuilding the app bundle after preparing its runtime.

Both installers require Python 3.11 or newer. macOS app packaging also requires Xcode Command Line Tools.

## Run

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

In Windows PowerShell, use `py -3 -m venv .venv`, then `.\.venv\Scripts\Activate.ps1`, followed by `python -m pip install -r requirements.txt`, `python -m playwright install chromium`, and `python app.py`.

Open http://127.0.0.1:5000. Settings are saved to `tradex_config.json` in this folder.

## Gold Liquidity

Open the **Gold Liquidity** tab beside Technical Analysis for historical gold-market analysis. It downloads actual OHLCV candles from Bybit XAUUSDT, OKX XAU-USDT-SWAP, Gate.io XAU_USDT, or Binance Spot PAXGUSDT, and accepts timestamped OHLCV CSV files. Turn on **Live mode** to refresh current OHLCV candles and the ticker every five seconds while the tab is active; uploaded CSV has no live feed. Daily grouping and displayed times use Asia/Kolkata (IST). INR/10g conversion uses `USD/oz × USD/INR × 10 ÷ 31.1034768g`, plus a separately editable India-market adjustment (default 14.1225%, calibrated to the supplied ₹125,148 per 10g and $3,670 per troy ounce example at USD/INR 92.9385). This adjustment represents the chosen local price basis; it is not an exchange FX conversion or a tax calculation. Raw candles remain in USD per troy ounce for calculations. Overview includes the 24-hour IST session clock, hourly volatility graph, hourly heatmap, weekly-average bars on the left, and today’s bars on the right. It also includes daily range charts, candle movement logs, UK/US DST-aware sessions, timeframe summaries, and custom date comparisons. Source gaps are reported and never filled with generated prices. Some exchanges may not list the requested contract or full historical range, in which case the dashboard reports the source error.

## Configure a source

Add a market name, category, and an `http(s)` page URL. Gold Mini and Silver Mini are configured for Groww's MCX options pages with the supplied expiries and illiquid contracts excluded. The default extractor reads HTML table rows. For pages with a different layout, provide a CSS selector for each row and for its expiry, strike, call, and put values. The field selectors are evaluated inside each selected row. Exact strike values are comma-separated; leave them empty to include all available strikes. Expiry matching uses the exact visible text from the page.

For JavaScript-rendered pages, enable **Read JavaScript-rendered rows with Chrome**. This uses Playwright's installed Chromium browser to read rendered option contract links and prices. TradeX reuses the page and reloads it no more than once per minute. Groww's SENSEX chain is configured to use this mode. A separate Google Chrome installation is not required for option-chain scraping.

Many option-chain sites render data in JavaScript or require authenticated sessions. Browser mode uses the Playwright Chromium browser installed by the setup scripts. It does not bypass login or access controls. Check the source site's terms and rate limits. Starting webscraping takes an immediate snapshot and then scans once per minute. It sends all strikes for the selected expiry to Google Sheets only; no local snapshot history is written.

## Google Sheets

Create a Google service account, enable the Sheets API, and share the target spreadsheet with its service-account email. Enter the spreadsheet ID, worksheet tab name, and local JSON credentials path in Settings. The app creates the header if needed and appends every timestamped minute snapshot in one batch. Sheets reads and writes remain far below 60 requests per minute. Keep the credential file private. The dashboard shows the last successful Sheets write or the current Sheets error separately from source scraping errors. Failed writes are also recorded in `tradex.log` beside `app.py`. Install `requirements.txt` in the same Python environment used to launch TradeX.

Use the dashboard **Start webscraping** toggle to take an immediate snapshot and then repeat once per minute. Each minute adds a timestamped row with one column per available contract to the configured worksheet. Switching it off stops scans, closes all Chrome pages TradeX opened for scraping, and shuts down the local TradeX server. Launch `TradeX.app` again to start another session.

On macOS, open `TradeX.app`; the backend starts only when you turn on **Backend scraping** in its small control window. Turning it on starts collection and opens the dashboard in Google Chrome. Turning the switch off stops collection and shuts down the local server. An already-open browser tab loses its connection until the switch is turned on again. Closing the app also stops the backend. The installed app keeps its runtime and settings under `~/Library/Application Support/TradeX`.

This is a local prototype. Do not expose it directly to the internet; it has no user authentication.

## Automatic technical analysis

Open **Technical Analysis** in the dashboard. The chart starts with Gold (`XAUUSDT`) and supports Silver (`XAGUSDT`), Bitcoin (`BTCUSDT`) and Ethereum (`ETHUSDT`). It reads public Binance USDⓈ-M Futures candles and current ticker prices, and offers 1m, 5m, 15m, 1h, 4h and 1d views. The candle API is documented at https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/market-data/rest-api/Kline-Candlestick-Data.

The overlay detects closed-candle swing points, heuristic support and resistance zones, three-candle fair value gaps and mitigation, trendlines, impulse-origin supply/demand zones, and basic BOS/CHOCH events. Support and resistance have independent controls, alongside trendlines, FVGs, supply/demand, historical levels, structure breaks, and timeframe confluence. Analysis modes can focus on support, resistance, bullish scenarios, bearish scenarios, or the complete view. A forming candle is drawn separately and provisional FVGs remain dashed until confirmed. Pan by dragging and zoom with the scroll wheel. Hover candles and levels for details.

The live commentary describes detected trendline approaches, retests, rejections, and confirmed breaks. Conditional bullish and bearish scenarios state the trigger, required closing confirmation, invalidation level, and up to three targets drawn from stored levels and structures, with ATR projections labelled as such when no structural target is available. Evidence scores are heuristic rankings, not calibrated probabilities or guaranteed predictions. Commentary events and scenario outcomes are stored in the local database for later review. Market data is Binance USDⓈ-M Futures data; it does not represent MCX options or their premiums, so unsupported option levels are not presented as live data.

The analyzer also backfills up to ten years of daily candles for the selected Binance USDⓈ-M Futures contract and uses the available long-term daily trend as one input to its live bullish and bearish evidence meters. Coverage depends on when each contract began trading; the interface reports the actual date range and marks shorter history. See Binance's [official kline documentation](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/market-data/rest-api/Kline-Candlestick-Data).

Candle history, level reactions, level scores, breakout lifecycle and detected structures are stored in the existing `tradex_trades.sqlite3` database. In the packaged macOS app, this database is kept under `~/Library/Application Support/TradeX/data`. On each instrument's first analysis, TradeX warms all six timeframes so nearby historical levels can show timeframe confluence. Scoring weights can be overridden with the `TRADEX_TA_SCORING` JSON environment variable. Detection scores are heuristic and should be assessed against historical candles; they are not trade signals.
