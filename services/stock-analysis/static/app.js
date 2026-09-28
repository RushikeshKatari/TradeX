/* ═══════════════════════════════════════════════════════════
   NSE Pulse — Dashboard JavaScript
   Socket.IO live updates, Chart.js charts, paper trading
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let activeSymbol = "NIFTY";
  let latestData = { NIFTY: null, BANKNIFTY: null };
  let socket = null;
  let priceChart = null;
  let oiChart = null;
  let connectionState = "connecting"; // connecting, live, stale, error

  // ── DOM References ─────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Helpers ────────────────────────────────────────────────
  function fmt(val, decimals = 2) {
    if (val === null || val === undefined || val === "") return "—";
    const n = Number(val);
    if (isNaN(n)) return "—";
    return n.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function fmtINR(val) {
    if (val === null || val === undefined) return "₹0";
    const n = Number(val);
    if (isNaN(n)) return "₹0";
    const sign = n < 0 ? "-" : "";
    return sign + "₹" + Math.abs(n).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  function fmtOI(val) {
    if (val === null || val === undefined) return "—";
    const n = Number(val);
    if (isNaN(n)) return "—";
    if (n >= 10000000) return (n / 10000000).toFixed(2) + " Cr";
    if (n >= 100000) return (n / 100000).toFixed(2) + " L";
    if (n >= 1000) return (n / 1000).toFixed(1) + " K";
    return n.toLocaleString("en-IN");
  }

  function pnlClass(val) {
    if (val === null || val === undefined) return "";
    return Number(val) >= 0 ? "positive" : "negative";
  }

  // ── Toast System ───────────────────────────────────────────
  function ensureToastContainer() {
    let c = $(".toast-container");
    if (!c) {
      c = document.createElement("div");
      c.className = "toast-container";
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(message, type = "info") {
    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 350);
    }, 4000);
  }

  // ── Connection Status ──────────────────────────────────────
  function setConnectionState(state) {
    connectionState = state;
    const dot = $(".status-dot");
    const text = $("#status-text");
    if (!dot || !text) return;

    dot.className = "status-dot";
    switch (state) {
      case "live":
        dot.classList.add("status-dot--live");
        text.textContent = "Live";
        break;
      case "stale":
        dot.classList.add("status-dot--stale");
        text.textContent = "Stale Data";
        break;
      case "connecting":
        dot.classList.add("status-dot--connecting");
        text.textContent = "Connecting…";
        break;
      case "error":
        dot.classList.add("status-dot--error");
        text.textContent = "Disconnected";
        break;
    }
  }

  // ═══ SOCKET.IO SETUP ════════════════════════════════════════
  function initSocket() {
    setConnectionState("connecting");
    socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 2000 });

    socket.on("connect", () => {
      console.log("[WS] Connected");
      setConnectionState("live");
      showToast("Connected to server", "success");
    });

    socket.on("disconnect", () => {
      console.log("[WS] Disconnected");
      setConnectionState("error");
    });

    socket.on("connect_error", (err) => {
      console.error("[WS] Connection error:", err.message);
      setConnectionState("error");
    });

    socket.on("market_update", (data) => {
      if (!data || !data.symbol) return;
      const sym = data.symbol.toUpperCase();
      latestData[sym] = data;
      setConnectionState("live");

      // Handle errors from server
      if (data.error) {
        console.warn(`[API] Error for ${sym}:`, data.error);
      }

      // Only render if it's the active symbol
      if (sym === activeSymbol) {
        renderAll(data);
      }
    });
  }

  // ═══ SYMBOL SWITCHING ══════════════════════════════════════
  function initTabs() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const sym = tab.dataset.symbol;
        if (sym === activeSymbol) return;

        // Update active tab
        $$(".tab").forEach((t) => t.classList.remove("tab--active"));
        tab.classList.add("tab--active");
        activeSymbol = sym;

        // Render cached data or fetch
        if (latestData[sym]) {
          renderAll(latestData[sym]);
        } else {
          fetchAndRender(sym);
        }
      });
    });
  }

  // ═══ FETCH HELPERS ═════════════════════════════════════════
  async function fetchJSON(url, options = {}) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`[Fetch] ${url}:`, err);
      throw err;
    }
  }

  async function fetchAndRender(symbol) {
    try {
      const data = await fetchJSON(`/api/analysis/${symbol}`);
      latestData[symbol] = data;
      if (symbol === activeSymbol) renderAll(data);
    } catch (err) {
      showToast(`Failed to load ${symbol} data: ${err.message}`, "error");
    }
  }

  // ═══ REFRESH BUTTON ════════════════════════════════════════
  function initRefresh() {
    const btn = $("#btn-refresh");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span>';
      try {
        const data = await fetchJSON(`/api/refresh/${activeSymbol}`, { method: "POST" });
        latestData[activeSymbol] = data;
        renderAll(data);
        showToast(`${activeSymbol} refreshed`, "success");
      } catch (err) {
        showToast(`Refresh failed: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "⟳";
      }
    });
  }

  // ═══ RENDER ALL ════════════════════════════════════════════
  function renderAll(data) {
    if (!data) return;
    renderPrice(data);
    renderRegime(data);
    renderSignal(data);
    renderIndicators(data);
    renderFactors(data);
    renderOptionChain(data);
    renderProvider(data);
    renderTimestamp(data);
    updatePriceChart(data);
    updateOIChart(data);
    loadTrades();
  }

  // ── Price Card ─────────────────────────────────────────────
  function renderPrice(data) {
    const q = data.index_quote;
    const sym = data.symbol || activeSymbol;
    const label = sym === "BANKNIFTY" ? "BANK NIFTY" : "NIFTY 50";
    const el = (id) => $(id);

    el("#price-symbol").textContent = label;

    if (!q) {
      el("#spot-price").textContent = "—";
      el("#price-change").textContent = "—";
      el("#price-change").className = "price-display__change";
      el("#price-open").textContent = "—";
      el("#price-high").textContent = "—";
      el("#price-low").textContent = "—";
      el("#price-prev").textContent = "—";
      return;
    }

    el("#spot-price").textContent = fmt(q.last_price);

    if (q.change !== null && q.change !== undefined) {
      const sign = q.change >= 0 ? "+" : "";
      const pct = q.change_pct !== null && q.change_pct !== undefined ? ` (${sign}${fmt(q.change_pct)}%)` : "";
      el("#price-change").textContent = `${sign}${fmt(q.change)}${pct}`;
      el("#price-change").className = "price-display__change " + (q.change >= 0 ? "positive" : "negative");
    }

    el("#price-open").textContent = fmt(q.open_price);
    el("#price-high").textContent = fmt(q.high_price);
    el("#price-low").textContent = fmt(q.low_price);
    el("#price-prev").textContent = fmt(q.prev_close);
  }

  // ── Regime Card ────────────────────────────────────────────
  function renderRegime(data) {
    const r = data.regime;
    const oc = data.option_chain || {};

    if (!r || !r.regime) {
      $("#regime-label").textContent = "—";
      $("#regime-confidence").textContent = "";
      return;
    }

    const regime = r.regime;
    const dial = $("#regime-dial");
    dial.className = "regime-dial regime-dial--" + regime.toLowerCase();
    $("#regime-label").textContent = regime;
    $("#regime-confidence").textContent = r.confidence ? `${fmt(r.confidence, 1)}%` : "";

    // Badge in price card
    const badge = $("#regime-badge");
    badge.textContent = regime;
    badge.className = "badge badge--" + regime.toLowerCase();

    // Details
    $("#trend-strength").textContent = r.trend_strength || "—";
    $("#volatility").textContent = r.volatility || "—";
    $("#atm-strike").textContent = oc.atm_strike ? fmt(oc.atm_strike, 0) : "—";
    $("#pcr-value").textContent = oc.pcr ? fmt(oc.pcr, 4) : "—";
    $("#max-pain").textContent = oc.max_pain ? fmt(oc.max_pain, 0) : "—";
  }

  // ── Signal Card ────────────────────────────────────────────
  function renderSignal(data) {
    const s = data.signal;
    const badge = $("#signal-badge");
    const btn = $("#btn-paper-trade");

    if (!s) {
      badge.textContent = "NO_TRADE";
      badge.className = "signal-badge-large";
      btn.style.display = "none";
      return;
    }

    const sig = s.signal || "NO_TRADE";
    badge.textContent = sig.replace(/_/g, " ");

    badge.className = "signal-badge-large";
    if (sig === "LONG_CALL") badge.classList.add("long-call");
    else if (sig === "LONG_PUT") badge.classList.add("long-put");
    else if (sig === "VOLATILITY_STRATEGY") badge.classList.add("vol-strategy");

    // Details
    $("#signal-strike").textContent = s.strike ? fmt(s.strike, 0) : "—";
    $("#signal-premium").textContent = s.premium ? "₹" + fmt(s.premium) : "—";
    $("#signal-expected-move").textContent =
      s.expected_move ? `₹${fmt(s.expected_move)} (${fmt(s.expected_move_pct, 1)}%)` : "—";
    $("#signal-straddle").textContent = s.straddle_cost ? "₹" + fmt(s.straddle_cost) : "—";
    $("#signal-iv").textContent = s.iv ? fmt(s.iv, 1) + "%" : "—";
    $("#signal-dte").textContent = s.time_to_expiry_days !== null && s.time_to_expiry_days !== undefined
      ? s.time_to_expiry_days + " days" : "—";
    $("#signal-rr").textContent = s.risk_reward ? fmt(s.risk_reward) : "—";

    // Reasons
    const container = $("#signal-reasons");
    container.innerHTML = "";
    if (s.reasons && s.reasons.length) {
      s.reasons.forEach((reason) => {
        const div = document.createElement("div");
        div.className = "signal-reason";
        div.textContent = reason;
        container.appendChild(div);
      });
    }

    // Paper trade button
    if (sig !== "NO_TRADE" && s.strike && s.premium) {
      btn.style.display = "block";
      btn.onclick = () => placePaperTrade(s, data);
    } else {
      btn.style.display = "none";
    }
  }

  // ── Indicators Grid ────────────────────────────────────────
  function renderIndicators(data) {
    const ind = data.indicators;
    if (!ind) return;

    const setInd = (id, val, decimals = 2) => {
      const card = $(id);
      if (!card) return;
      const valEl = card.querySelector(".indicator-card__value");
      if (!valEl) return;
      if (val === null || val === undefined) {
        valEl.textContent = "N/A";
        card.classList.add("indicator-card--unavailable");
      } else {
        valEl.textContent = fmt(val, decimals);
        card.classList.remove("indicator-card--unavailable");
      }
    };

    setInd("#ind-ema20", ind.ema_20);
    setInd("#ind-ema50", ind.ema_50);
    setInd("#ind-rsi", ind.rsi_14);
    setInd("#ind-adx", ind.adx_14);
    setInd("#ind-atr", ind.atr_14);
    setInd("#ind-bb-upper", ind.bollinger_upper);
    setInd("#ind-bb-lower", ind.bollinger_lower);
    setInd("#ind-bb-width", ind.bollinger_width, 4);
    setInd("#ind-momentum", ind.momentum_10);
    setInd("#ind-vwap", ind.vwap);

    // OI
    const ceOI = $("#ind-ce-oi");
    const peOI = $("#ind-pe-oi");
    if (ceOI) {
      const v = ceOI.querySelector(".indicator-card__value");
      if (v) v.textContent = ind.total_ce_oi ? fmtOI(ind.total_ce_oi) : "N/A";
    }
    if (peOI) {
      const v = peOI.querySelector(".indicator-card__value");
      if (v) v.textContent = ind.total_pe_oi ? fmtOI(ind.total_pe_oi) : "N/A";
    }
  }

  // ── Factors ────────────────────────────────────────────────
  function renderFactors(data) {
    const r = data.regime;
    const sup = $("#supporting-factors");
    const opp = $("#opposing-factors");
    if (!sup || !opp) return;

    sup.innerHTML = "";
    opp.innerHTML = "";

    if (r && r.supporting_factors) {
      r.supporting_factors.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f;
        sup.appendChild(li);
      });
    }
    if (!sup.children.length) {
      sup.innerHTML = '<li style="color:var(--text-muted);font-style:italic">No supporting factors</li>';
    }

    if (r && r.opposing_factors) {
      r.opposing_factors.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f;
        opp.appendChild(li);
      });
    }
    if (!opp.children.length) {
      opp.innerHTML = '<li style="color:var(--text-muted);font-style:italic">No opposing factors</li>';
    }
  }

  // ── Option Chain Table ─────────────────────────────────────
  function renderOptionChain(data) {
    const oc = data.option_chain;
    const tbody = $("#chain-tbody");
    const expiryEl = $("#chain-expiry");
    const underlyingEl = $("#chain-underlying");
    if (!tbody) return;

    if (!oc || !oc.strikes || !oc.strikes.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-row">No option chain data available</td></tr>';
      if (expiryEl) expiryEl.textContent = "—";
      if (underlyingEl) underlyingEl.textContent = "—";
      return;
    }

    // Meta
    if (expiryEl && oc.expiry_dates && oc.expiry_dates.length) {
      expiryEl.textContent = "Expiry: " + oc.expiry_dates[0];
    }
    if (underlyingEl && oc.underlying_value) {
      underlyingEl.textContent = "Spot: " + fmt(oc.underlying_value);
    }

    const atm = oc.atm_strike;
    const strikes = oc.strikes;

    // Find max OI for bar width scaling
    let maxOI = 0;
    strikes.forEach((s) => {
      if (s.ce && s.ce.open_interest) maxOI = Math.max(maxOI, s.ce.open_interest);
      if (s.pe && s.pe.open_interest) maxOI = Math.max(maxOI, s.pe.open_interest);
    });

    const rows = strikes.map((s) => {
      const isATM = s.strike_price === atm;
      const isITM_CE = atm && s.strike_price < atm;
      const isITM_PE = atm && s.strike_price > atm;

      let cls = "";
      if (isATM) cls = "atm-row";
      if (isITM_CE) cls += " itm-ce";
      if (isITM_PE) cls += " itm-pe";

      const ce = s.ce || {};
      const pe = s.pe || {};

      const oiBarWidth = (oi) => {
        if (!oi || !maxOI) return "";
        return `<span class="oi-bar oi-bar--ce" style="width:${Math.round((oi / maxOI) * 40)}px"></span>`;
      };
      const oiBarWidthPE = (oi) => {
        if (!oi || !maxOI) return "";
        return `<span class="oi-bar oi-bar--pe" style="width:${Math.round((oi / maxOI) * 40)}px"></span>`;
      };

      return `<tr class="${cls}">
        <td>${fmtOI(ce.open_interest)}${oiBarWidth(ce.open_interest)}</td>
        <td>${fmtOI(ce.change_in_oi)}</td>
        <td>${fmtOI(ce.volume)}</td>
        <td>${ce.iv ? fmt(ce.iv, 1) : "—"}</td>
        <td>${ce.ltp ? fmt(ce.ltp) : "—"}</td>
        <td>${ce.bid_price ? fmt(ce.bid_price) : "—"}</td>
        <td class="strike-col">${fmt(s.strike_price, 0)}</td>
        <td>${pe.bid_price ? fmt(pe.bid_price) : "—"}</td>
        <td>${pe.ltp ? fmt(pe.ltp) : "—"}</td>
        <td>${pe.iv ? fmt(pe.iv, 1) : "—"}</td>
        <td>${fmtOI(pe.volume)}</td>
        <td>${fmtOI(pe.change_in_oi)}</td>
        <td>${fmtOI(pe.open_interest)}${oiBarWidthPE(pe.open_interest)}</td>
      </tr>`;
    });

    tbody.innerHTML = rows.join("");
  }

  // ── Provider & Timestamp ───────────────────────────────────
  function renderProvider(data) {
    const el = $("#provider-name");
    if (el) el.textContent = data.provider || "—";
  }

  function renderTimestamp(data) {
    const el = $("#last-updated");
    if (!el) return;
    if (data.timestamp) {
      try {
        const d = new Date(data.timestamp);
        el.textContent = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } catch {
        el.textContent = data.timestamp;
      }
    }
  }

  // ═══ CHARTS ════════════════════════════════════════════════
  function initCharts() {
    // Price chart
    const priceCtx = document.getElementById("price-chart");
    if (priceCtx) {
      priceChart = new Chart(priceCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: [{
            label: "Spot Price",
            data: [],
            borderColor: "#4a90d9",
            backgroundColor: "rgba(74, 144, 217, 0.08)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: "index",
              intersect: false,
              backgroundColor: "#1a1d2e",
              titleColor: "#e8eaed",
              bodyColor: "#9aa0b4",
              borderColor: "#2a2d3e",
              borderWidth: 1,
            },
          },
          scales: {
            x: {
              display: true,
              grid: { color: "rgba(42,45,62,0.4)" },
              ticks: { color: "#606580", maxTicksLimit: 8, font: { size: 10 } },
            },
            y: {
              display: true,
              grid: { color: "rgba(42,45,62,0.4)" },
              ticks: { color: "#606580", font: { size: 10, family: "'JetBrains Mono'" } },
            },
          },
          interaction: { mode: "nearest", axis: "x", intersect: false },
        },
      });
    }

    // OI chart
    const oiCtx = document.getElementById("oi-chart");
    if (oiCtx) {
      oiChart = new Chart(oiCtx, {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            {
              label: "CE OI",
              data: [],
              backgroundColor: "rgba(239, 83, 80, 0.6)",
              borderColor: "#ef5350",
              borderWidth: 1,
            },
            {
              label: "PE OI",
              data: [],
              backgroundColor: "rgba(38, 166, 154, 0.6)",
              borderColor: "#26a69a",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              labels: { color: "#9aa0b4", font: { size: 11 } },
            },
            tooltip: {
              backgroundColor: "#1a1d2e",
              titleColor: "#e8eaed",
              bodyColor: "#9aa0b4",
              borderColor: "#2a2d3e",
              borderWidth: 1,
              callbacks: {
                label: function (ctx) {
                  return ctx.dataset.label + ": " + fmtOI(ctx.parsed.y);
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#606580", maxRotation: 45, font: { size: 9, family: "'JetBrains Mono'" } },
            },
            y: {
              grid: { color: "rgba(42,45,62,0.4)" },
              ticks: {
                color: "#606580",
                font: { size: 10, family: "'JetBrains Mono'" },
                callback: (val) => fmtOI(val),
              },
            },
          },
        },
      });
    }
  }

  function updatePriceChart(data) {
    if (!priceChart) return;
    // Fetch price history
    fetchJSON(`/api/price-history/${activeSymbol}`)
      .then((hist) => {
        const prices = hist.prices || [];
        if (!prices.length) return;

        priceChart.data.labels = prices.map((_, i) => `#${i + 1}`);
        priceChart.data.datasets[0].data = prices;
        priceChart.data.datasets[0].label = `${activeSymbol} Spot`;
        priceChart.update("none");
      })
      .catch(() => {}); // Silently fail — chart is non-critical
  }

  function updateOIChart(data) {
    if (!oiChart) return;
    const oc = data.option_chain;
    if (!oc || !oc.strikes || !oc.strikes.length) return;

    const strikes = oc.strikes;
    const labels = [];
    const ceOI = [];
    const peOI = [];

    strikes.forEach((s) => {
      labels.push(String(Math.round(s.strike_price)));
      ceOI.push(s.ce ? s.ce.open_interest || 0 : 0);
      peOI.push(s.pe ? s.pe.open_interest || 0 : 0);
    });

    oiChart.data.labels = labels;
    oiChart.data.datasets[0].data = ceOI;
    oiChart.data.datasets[1].data = peOI;
    oiChart.update("none");
  }

  // ═══ PAPER TRADING ═════════════════════════════════════════
  async function placePaperTrade(signal, data) {
    if (!signal || !signal.strike || !signal.premium) {
      showToast("Invalid signal — cannot place trade", "error");
      return;
    }

    const dir = signal.direction || "LONG";
    const body = {
      symbol: data.symbol || activeSymbol,
      option_type: signal.option_type || (signal.signal === "LONG_PUT" ? "PE" : "CE"),
      strike: signal.strike,
      premium: signal.premium,
      expiry: signal.expiry || "",
      lots: 1,
      direction: dir,
      signal: signal.signal,
      regime: data.regime ? data.regime.regime : "",
      confidence: signal.confidence || 0,
    };

    try {
      const result = await fetchJSON("/api/trades/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      showToast(
        `Trade entered: ${result.id} ${result.direction || 'LONG'} ${body.symbol} ${result.lots || 1} lot(s) (qty: ${result.quantity}) ${body.strike}${body.option_type} @ ₹${body.premium}`,
        "success"
      );
      loadTrades();
    } catch (err) {
      showToast(`Failed to enter trade: ${err.message}`, "error");
    }
  }

  async function closeTrade(tradeId) {
    // Prompt for exit premium
    const input = prompt("Enter exit premium:");
    if (!input) return;
    const exitPremium = parseFloat(input);
    if (isNaN(exitPremium) || exitPremium < 0) {
      showToast("Invalid exit premium", "error");
      return;
    }

    try {
      const result = await fetchJSON("/api/trades/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, exit_premium: exitPremium }),
      });
      const pnl = result.pnl || 0;
      showToast(`Trade ${tradeId} closed. P&L: ${fmtINR(pnl)}`, pnl >= 0 ? "success" : "error");
      loadTrades();
    } catch (err) {
      showToast(`Failed to close trade: ${err.message}`, "error");
    }
  }

  async function resetTrades() {
    if (!confirm("Reset all paper trades? This cannot be undone.")) return;
    try {
      await fetchJSON("/api/trades/reset", { method: "POST" });
      showToast("Paper trades reset", "info");
      loadTrades();
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, "error");
    }
  }

  async function loadTrades() {
    try {
      const data = await fetchJSON("/api/trades");
      renderPortfolio(data.portfolio);
      renderTrades(data.trades || []);
    } catch (err) {
      console.warn("Failed to load trades:", err);
    }
  }

  async function runBacktest() {
    const btn = $("#btn-backtest"), status = $("#backtest-status");
    if (btn) { btn.disabled = true; btn.textContent = "Running…"; }
    try {
      const result = await fetchJSON(`/api/backtest/${activeSymbol}`);
      if (status) { status.className = `backtest-banner backtest-banner--${result.status === "READY" ? "ready" : "limited"}`; status.textContent = result.message || "Backtest complete."; }
      const m = result.metrics || {};
      const values = [m.trades, m.win_rate == null ? null : `${fmt(m.win_rate, 1)}%`, m.pnl == null ? null : fmtINR(m.pnl), m.profit_factor, m.expectancy == null ? null : fmtINR(m.expectancy), m.max_drawdown == null ? null : fmtINR(m.max_drawdown)];
      $$("#backtest-metrics .metric-tile strong").forEach((el, i) => el.textContent = values[i] == null ? "—" : values[i]);
      const body = $("#backtest-regimes");
      body.innerHTML = (result.regime_performance || []).length ? result.regime_performance.map(r => `<tr><td>${r.regime}</td><td>${r.trades}</td><td>${fmt(r.win_rate, 1)}%</td><td class="${pnlClass(r.pnl)}">${fmtINR(r.pnl)}</td></tr>`).join("") : '<tr><td colspan="4">No regime results available.</td></tr>';
    } catch (err) { if (status) { status.className = "backtest-banner backtest-banner--limited"; status.textContent = `Backtest unavailable: ${err.message}`; } }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Run Backtest"; } }
  }

  function renderPortfolio(p) {
    if (!p) return;
    const el = (id) => $(id);
    el("#port-capital").textContent = fmtINR(p.current_capital);
    el("#port-open-pnl").textContent = fmtINR(p.open_pnl);
    el("#port-open-pnl").className = "portfolio-stat__value " + pnlClass(p.open_pnl);
    el("#port-total-pnl").textContent = fmtINR(p.total_pnl);
    el("#port-total-pnl").className = "portfolio-stat__value " + pnlClass(p.total_pnl);
    el("#port-win-rate").textContent = p.win_rate !== undefined && p.win_rate !== null
      ? fmt(p.win_rate, 1) + "%" : "—";
  }

  function renderTrades(trades) {
    const openContainer = $("#open-trades");
    const closedContainer = $("#closed-trades");
    if (!openContainer || !closedContainer) return;

    const openTrades = trades.filter((t) => t.status === "OPEN");
    const closedTrades = trades.filter((t) => t.status === "CLOSED").slice(-10).reverse();

    // Open trades
    if (!openTrades.length) {
      openContainer.innerHTML = '<div class="no-trades-msg">No open positions</div>';
    } else {
      openContainer.innerHTML = openTrades
        .map(
          (t) => `
        <div class="trade-card">
          <div class="trade-card__info">
            <span class="trade-card__title">
              <span class="badge ${t.direction === 'SHORT' ? 'badge--bearish' : 'badge--bullish'}" style="font-size:0.65rem;padding:0.1rem 0.4rem;margin-right:0.3rem">
                ${t.direction || 'LONG'}
              </span>
              ${t.symbol} ${fmt(t.strike, 0)} ${t.option_type}
            </span>
            <span class="trade-card__meta">
              Entry: ₹${fmt(t.entry_premium)} | Live: ₹${fmt(t.current_premium)} | Lots: ${t.lots || 1} × ${t.lot_size || (t.quantity / (t.lots || 1))} (Qty: ${t.quantity})
            </span>
          </div>
          <span class="trade-card__pnl ${pnlClass(t.pnl)}">${fmtINR(t.pnl)} (${t.pnl_pct ? fmt(t.pnl_pct, 1) + '%' : '—'})</span>
          <button class="btn btn--close-trade" data-trade-id="${t.id}">Close</button>
        </div>
      `
        )
        .join("");

      // Attach close handlers
      openContainer.querySelectorAll(".btn--close-trade").forEach((btn) => {
        btn.addEventListener("click", () => closeTrade(btn.dataset.tradeId));
      });
    }

    // Closed trades
    if (!closedTrades.length) {
      closedContainer.innerHTML = '<div class="no-trades-msg">No closed trades yet</div>';
    } else {
      closedContainer.innerHTML = closedTrades
        .map(
          (t) => `
        <div class="trade-card">
          <div class="trade-card__info">
            <span class="trade-card__title">
              <span class="badge ${t.direction === 'SHORT' ? 'badge--bearish' : 'badge--bullish'}" style="font-size:0.65rem;padding:0.1rem 0.4rem;margin-right:0.3rem">
                ${t.direction || 'LONG'}
              </span>
              ${t.symbol} ${fmt(t.strike, 0)} ${t.option_type}
            </span>
            <span class="trade-card__meta">
              Entry: ₹${fmt(t.entry_premium)} → Exit: ₹${fmt(t.exit_premium)} | Lots: ${t.lots || 1} × ${t.lot_size || (t.quantity / (t.lots || 1))} (Qty: ${t.quantity})
            </span>
          </div>
          <span class="trade-card__pnl ${pnlClass(t.pnl)}">${fmtINR(t.pnl)} (${t.pnl_pct ? fmt(t.pnl_pct, 1) + '%' : '—'})</span>
        </div>
      `
        )
        .join("");
    }
  }

  // ═══ RESET BUTTON ══════════════════════════════════════════
  function initResetButton() {
    const btn = $("#btn-reset-trades");
    if (btn) btn.addEventListener("click", resetTrades);
  }

  // ═══ INITIALIZATION ════════════════════════════════════════
  function init() {
    console.log("[NSEPulse] Initializing…");
    initTabs();
    initRefresh();
    initCharts();
    initSocket();
    initResetButton();
    const backtestButton = $("#btn-backtest");
    if (backtestButton) backtestButton.addEventListener("click", runBacktest);

    // Initial data fetch
    fetchAndRender(activeSymbol);
    loadTrades();
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
