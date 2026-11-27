# TradeX Desktop

TradeX is a local desktop app for viewing equity and commodity option chains, managing paper positions, and exploring technical analysis charts. It supports NIFTY and SENSEX under Equity, and Gold Mini and Silver Mini under Commodity. It does not place real orders and has no user accounts or admin login.

The supplied TradeX artwork is used as the app icon on macOS, the Windows desktop shortcut icon, and the dashboard brand mark. The original image and generated platform icon assets are kept in `apps/tradex-desktop/assets/`.

The app runs on your computer and serves its dashboard only on the local machine. Windows and macOS setup scripts install the app and its Python dependencies; on Windows the installer adds a desktop shortcut, and on macOS it builds and installs `TradeX.app`.

## Install on Windows

Requirements: Windows 10 or 11, Git, and Python 3.11 or newer with the Python Launcher (`py`) enabled. The installer downloads the Playwright Chromium browser used for JavaScript-rendered option chains.

Run these commands in PowerShell:

```powershell
git clone https://github.com/RushikeshKatari/TradeX.git
cd TradeX\apps\tradex-desktop
powershell -NoProfile -ExecutionPolicy Bypass -File .\install_windows.ps1
```

The installer copies TradeX to `%LOCALAPPDATA%\Programs\TradeX`, creates a private Python environment, installs the required packages and Playwright Chromium, adds a `TradeX` shortcut to your desktop, and opens the dashboard. Double-click the shortcut to start TradeX later. The dashboard uses `http://127.0.0.1:5000` and your default browser. Use **Start webscraping** in the dashboard to begin scanning; scraping is off when the app starts.

## Install on macOS

Requirements: macOS 12 or newer, Git, Python 3.11 or newer, and Xcode Command Line Tools. The installer downloads the Playwright Chromium browser used for JavaScript-rendered option chains. Install the command-line tools once if needed:

```sh
xcode-select --install
```

Then run these commands in Terminal:

```sh
git clone https://github.com/RushikeshKatari/TradeX.git
cd TradeX/apps/tradex-desktop
chmod +x install_macos.sh
./install_macos.sh
```

The installer creates the Python runtime and Playwright browser, builds `TradeX.app`, installs it in `~/Applications/TradeX.app`, and opens it. To start it later, open **TradeX** from your Applications folder. The small **Backend scraping** switch starts the local server and scraping, then opens the dashboard in Chrome. Turning the switch off stops scraping and shuts down the local server; an already-open browser tab will lose its connection until you switch it on again. Scraping starts off. The app's runtime, settings, logs, and analysis database are stored under `~/Library/Application Support/TradeX`.

To rebuild the macOS app after updating the source, run `./install_macos.sh` again. The existing user settings and local data are kept in Application Support.

## Use the dashboard

- **Option chains:** Choose an equity or commodity instrument, expiry, and strikes. Leave exact strikes blank to load all available strikes.
- **Paper positions:** Add option legs to positions, edit entries, and use Exit Trade to record completed paper trades locally.
- **Technical Analysis:** View live Binance USDⓈ-M Futures charts for Gold, Silver, Bitcoin, and Ethereum across six timeframes. The analyzer includes support and resistance, structures, historical levels, a live commentary panel, and bullish/bearish evidence meters.
- **Gold Liquidity:** Open the tab beside Technical Analysis for actual gold-market OHLCV history from Bybit XAUUSDT, OKX XAU-USDT-SWAP, Gate.io XAU_USDT, Binance Spot PAXGUSDT, or uploaded CSV. Turn on Live mode for five-second current candle and ticker updates. Choose date presets and timeframe buttons for immediate analysis. The Overview includes a 24-hour IST session clock and volatility graph, hourly volatility heatmap, weekly-average bars on the left, and today’s bars on the right. INR mode converts USD per troy ounce into INR per 10g using the exact troy-ounce weight and the editable USD/INR rate plus an explicit editable India-market adjustment; missing source candles are reported without interpolation.
- **Data Workloads:** Switch Terminal & Pairs, Position PnL, Technical Analysis, and Gold Liquidity on or off separately. NIFTY, SENSEX, Gold Mini, and Silver Mini market switches control which contracts are scanned and shown. Workloads and markets start off for opt-in loading, and selections persist locally. The master backend switch still controls the scraper service.
- **Scraping:** A scan runs immediately when started and repeats every minute. The Windows dashboard's **Start webscraping** control and macOS app's **Backend scraping** switch start scraping; scraping is off after launch.

Technical analysis scores are heuristic evidence summaries, not calibrated probabilities or guaranteed predictions. Its Binance futures charts are separate from MCX option prices. For detailed configuration and feature notes, see [the desktop app guide](apps/tradex-desktop/README.md).

## Configure data sources and Google Sheets

The app includes NIFTY, SENSEX, Gold Mini, and Silver Mini sources. In Settings, you can choose an expiry and adjust a source URL or selectors. JavaScript-rendered sources use the Playwright Chromium browser installed by the setup script; a separate Google Chrome installation is not required for option-chain scraping. The dashboard opens in your default browser. TradeX does not bypass a source site's login, access controls, or terms of use.

Google Sheets publishing is optional. Create a Google service account, enable the Sheets API, share the spreadsheet with the service-account email, then enter the spreadsheet ID, worksheet name, and local credentials JSON path in Settings. Keep that credential file private. Local settings are not committed to the repository.

## Install scripts and source run

- Windows installer and launcher: [`install_windows.ps1`](apps/tradex-desktop/install_windows.ps1), [`Start-TradeX.ps1`](apps/tradex-desktop/Start-TradeX.ps1)
- macOS installer: [`install_macos.sh`](apps/tradex-desktop/install_macos.sh)
- macOS app builder: [`build_macos_app.sh`](apps/tradex-desktop/build_macos_app.sh)

For development, run TradeX directly from `apps/tradex-desktop` after installing Python 3.11+:

macOS/Linux:

```sh
cd apps/tradex-desktop
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

Windows PowerShell:

```powershell
cd apps\tradex-desktop
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

Then open `http://127.0.0.1:5000` in your browser.

TradeX is a local prototype with no authentication. Do not expose its local server to the internet or a shared network. Keep credentials and local trade data on your device.
