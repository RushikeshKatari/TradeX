/**
 * TradeX Pro - Frontend Trading & Options Engine
 */

let cfg = {};
let editingIndex = -1;
let pollBusy = false;
let scrapingOn = false;
let latestState = null;
let scraperAppConnected = false;
let currentFilterStrike = '';
let currentLogLevel = 'all';

// Toast Notification Engine
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <div>${esc(message)}</div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// API Helper
async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatMoney(num) {
  const n = Number(num);
  return isNaN(n) ? '0.00' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==========================================================================
// Initialization & Navigation
// ==========================================================================
async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  _applyBrokerModeUI();

  // Render browser-saved positions before waiting for the server. This keeps
  // the PnL tab usable on reload even if the initial API request is slow/fails.
  renderPnl();
  loadClosedTrades();

  try {
    cfg = await api('/api/config');
    renderIndicesList();
    fillSheetsForm();

    const savedIndex = localStorage.getItem('tradex.selectedIndex');
    const available = (cfg.indices || []).map(x => x.name);
    const chosen = available.includes(savedIndex)
      ? savedIndex
      : (available.includes('NIFTY') ? 'NIFTY' : (available[0] || ''));

    selectPairIndex(chosen);

    const savedSort = localStorage.getItem('tradex.pairSortFilter') || 'default';
    const sortSelect = document.getElementById('pairSortFilter');
    if (sortSelect) sortSelect.value = savedSort;

    await poll();
  } catch (err) {
    console.error('Init error:', err);
    showToast(err.message, 'error');
  }

  // Restore active tab
  const savedTab = localStorage.getItem('tradex.activeTab') || 'terminal';
  showPageTab(savedTab);

  // Background state polling (sub-second live streaming)
  setInterval(poll, 300);
}

function updateClock() {
  const clockEl = document.getElementById('headerClock');
  if (!clockEl) return;
  const now = new Date();
  const istStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
  clockEl.textContent = `${istStr} IST`;
}

function showPageTab(tabName) {
  const validTabs = ['terminal', 'pnl', 'chart', 'automation', 'logs'];
  const activeTab = validTabs.includes(tabName) ? tabName : 'terminal';

  document.querySelectorAll('.nav-tab').forEach(tab => {
    const isTarget = tab.dataset.tab === activeTab;
    tab.classList.toggle('active', isTarget);
    tab.setAttribute('aria-selected', String(isTarget));
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${activeTab}`);
  });

  localStorage.setItem('tradex.activeTab', activeTab);
  if (activeTab === 'chart' && typeof window.loadTechnicalMarket === 'function') {
    window.loadTechnicalMarket();
  }
  if (activeTab === 'pnl') requestAnimationFrame(() => renderPnl(false));
}

// ==========================================================================
// Index Selection & Rules Engine
// ==========================================================================
function refreshIndexChooser() {
  const container = document.getElementById('indexChips');
  if (!container) return;
  const current = getSelectedPairIndex();

  const groups = [
    ['equity', 'Equity'],
    ['commodity', 'Commodity']
  ];
  container.innerHTML = groups.map(([category, label]) => {
    const members = (cfg.indices || []).filter(idx => (idx.category || 'equity') === category);
    if (!members.length) return '';
    return `<div class="market-index-group"><span class="market-index-label">${label}</span><div class="market-index-options">${members.map(idx => {
      const lot = latestState?.market_lot_sizes?.[idx.name] || idx.lot_size || (idx.name.toUpperCase() === 'SENSEX' ? 20 : 65);
      const lotLabel = category === 'commodity' ? `${lot}×` : `${lot} u`;
      return `<button class="index-chip ${idx.name === current ? 'active' : ''}" onclick="selectPairIndex('${esc(idx.name)}')">
        <span>${esc(idx.display_name || idx.name)}</span><span style="font-size:10px;opacity:.75;">(${lotLabel})</span>
      </button>`;
    }).join('')}</div></div>`;
  }).join('');

  const rulesEl = document.getElementById('indexRuleBadge');
  if (rulesEl) {
    const selectedConfig = (cfg.indices || []).find(item => item.name === current);
    if (selectedConfig?.category === 'commodity') {
      rulesEl.textContent = `${selectedConfig.display_name || current}: strike spacing from live chain · Premium multiplier: ${latestState?.market_lot_sizes?.[current] || selectedConfig.lot_size || '—'}×`;
    } else if (current.toUpperCase() === 'SENSEX') {
      rulesEl.textContent = 'SENSEX: 100-pt Center Rule · Distances 100, 200, 300 · Lot: 20';
    } else {
      rulesEl.textContent = 'NIFTY: 50-pt Center Rule · Distances 50, 100, 150 · Lot: 65';
    }
  }

  const selectedBadge = document.getElementById('topSelectedBadge');
  if (selectedBadge) selectedBadge.textContent = current;
}

function getSelectedPairIndex() {
  const select = document.getElementById('pairIndex');
  return select?.value || localStorage.getItem('tradex.selectedIndex') || 'NIFTY';
}

function selectPairIndex(name) {
  const select = document.getElementById('pairIndex');
  if (select) select.value = name;
  localStorage.setItem('tradex.selectedIndex', name);

  // When switching index, reset user scroll so it immediately re-centers on the new spot price
  userHasScrolled = false;
  lastUserScrollTime = 0;
  if (recenterTimer) clearTimeout(recenterTimer);

  refreshIndexChooser();
  renderPairs();
  renderOptionsChain();
}

function setBudgetPreset(amt) {
  const budgetInput = document.getElementById('pairBudget');
  if (budgetInput) {
    budgetInput.value = amt;
    renderPairs();
  }
}

// Helper: Always fetch the latest available expiry for a given index
function getLatestExpiry(indexName, rows) {
  const matching = rows.filter(x => x.index === indexName && x.expiry);
  const expiries = [...new Set(matching.map(x => String(x.expiry).trim()))].filter(Boolean);
  if (!expiries.length) {
    const idxConfig = (cfg.indices || []).find(x => x.name === indexName);
    return idxConfig?.selected_expiry || 'Latest';
  }
  expiries.sort();
  return expiries[0];
}

// ==========================================================================
// Symmetric Pair Finder
// ==========================================================================
function makeGrowUrl(indexConfig, expiry, strike, side, rows) {
  const directRow = rows.find(x => x.index === indexConfig.name && String(x.strike) === String(strike) && (!expiry || String(x.expiry) === String(expiry)));
  if (directRow?.chart_urls?.[side]) return directRow.chart_urls[side];
  if (side === 'CE' && directRow?.groww_ce_url) return directRow.groww_ce_url;
  if (side === 'PE' && directRow?.groww_pe_url) return directRow.groww_pe_url;

  const sample = rows.find(x => x.index === indexConfig.name && String(x.expiry) === String(expiry) && (x.chart_urls?.[side] || x.groww_ce_url || x.groww_pe_url))
    || rows.find(x => x.index === indexConfig.name && (x.chart_urls?.CE || x.groww_ce_url));
  if (!sample) return '';
  const source = sample.chart_urls?.[side] || (side === 'CE' ? sample.groww_ce_url : sample.groww_pe_url) || sample.chart_urls?.CE || sample.groww_ce_url;
  try {
    const u = new URL(source);
    const ticker = u.pathname.split('/').pop();
    const m = ticker.match(/^([A-Za-z]+\d{2}[A-Za-z]{3}|[A-Za-z]+\d{2}[A-Za-z]\d{2})(\d+)(CE|PE)$/i);
    if (!m) return source;
    u.pathname = u.pathname.replace(/[^/]+$/, m[1] + String(strike) + side.toUpperCase());
    return u.toString();
  } catch (_) {
    return source || '';
  }
}

function findAffordableLots(cp, pp, lot, budget) {
  if (cp <= 0 || pp <= 0 || lot <= 0 || budget <= 0) return null;
  const maxLots = Math.min(80, Math.floor(budget / (Math.min(cp, pp) * lot)));
  if (maxLots < 1) return null;

  let best = null;

  // Search for optimal (cl, pl) that satisfies the 1:1.3 budget allocation rule:
  // 1. Total cost <= budget
  // 2. Capital ratio between Call and Put <= 1.35 (covers 1:1.3 allocation with live market skew rounding)
  // 3. Maximizes capital utilization
  for (let cl = 1; cl <= maxLots; cl++) {
    for (let pl = 1; pl <= maxLots; pl++) {
      const callInvest = cl * cp * lot;
      const putInvest = pl * pp * lot;
      const cost = callInvest + putInvest;
      if (cost > budget) continue;

      const maxCap = Math.max(callInvest, putInvest);
      const minCap = Math.min(callInvest, putInvest);
      const capRatio = maxCap / minCap;
      if (capRatio > 1.35) continue;

      const lotRatio = Math.max(cl, pl) / Math.min(cl, pl);

      if (!best || cost > best.cost || (cost === best.cost && capRatio < best.capRatio)) {
        best = { cl, pl, cost, callInvest, putInvest, capRatio, lotRatio };
      }
    }
  }

  // If no lot combination achieved <= 1.35, check if 1 lot each fits budget and skew <= 1.40
  if (!best) {
    const cost1 = (cp + pp) * lot;
    if (cost1 <= budget) {
      const maxCap = Math.max(cp * lot, pp * lot);
      const minCap = Math.min(cp * lot, pp * lot);
      const capRatio = maxCap / minCap;
      if (capRatio <= 1.40) {
        best = { cl: 1, pl: 1, cost: cost1, callInvest: cp * lot, putInvest: pp * lot, capRatio, lotRatio: 1 };
      }
    }
  }

  return best;
}

function renderPairs() {
  const name = getSelectedPairIndex();
  const idxConfig = (cfg.indices || []).find(x => x.name === name) || { name };
  const rows = latestState?.rows || [];
  const tbody = document.getElementById('pairRows');
  const infoEl = document.getElementById('centerInfo');

  // Backend Lot Size logic (No UI input needed)
  const isSensex = name.toUpperCase() === 'SENSEX';
  const isCommodity = idxConfig.category === 'commodity';
  const lot = Number(latestState?.market_lot_sizes?.[name] || idxConfig.lot_size) || (isSensex ? 20 : (name === 'GOLDM' ? 10 : (name === 'SILVERM' ? 5 : 65)));
  let interval = isSensex ? 100 : 50;

  // Automatically resolve latest expiry from rows (No UI input needed)
  const expiry = getLatestExpiry(name, rows);

  // Update Meta Badges in UI
  const autoExpiryBadge = document.getElementById('autoExpiryBadge');
  if (autoExpiryBadge) autoExpiryBadge.textContent = expiry;

  const backendLotBadge = document.getElementById('backendLotBadge');
  if (backendLotBadge) backendLotBadge.textContent = `${lot} units`;

  // Determine Spot Price (Live or Last Available)
  let quote = latestState?.underlying_prices?.[name];
  if (!quote) {
    // If not in state dict, infer from last available rows or defaults
    const indexRows = rows.filter(r => r.index === name);
    if (indexRows.length) {
      const strikes = indexRows.map(r => Number(r.strike)).filter(n => n > 0);
      if (strikes.length) {
        strikes.sort((a, b) => a - b);
        quote = strikes[Math.floor(strikes.length / 2)];
      }
    }
    if (!quote) quote = isSensex ? 74050 : (isCommodity ? 0 : 24850);
  }

  const spot = Number(quote);

  // Update header and card stats
  const spotHeader = document.getElementById('topSpotPrice');
  if (spotHeader) spotHeader.textContent = `₹${spot.toLocaleString()}`;
  const spotCard = document.getElementById('indexSpotDisplay');
  if (spotCard) spotCard.textContent = `₹${spot.toLocaleString()}`;

  // Update Data Source / Feed Pill
  const dsDot = document.getElementById('dataSourceDot');
  const dsText = document.getElementById('dataSourceText');
  if (dsDot && dsText) {
    if (latestState?.is_cached) {
      dsDot.className = 'status-dot warning';
      dsText.textContent = 'Last Available';
    } else {
      dsDot.className = 'status-dot active';
      dsText.textContent = 'Live Feed';
    }
  }

  const budget = Number(document.getElementById('pairBudget')?.value) || 25000;
  const indexRows = rows.filter(x => x.index === name && (!expiry || String(x.expiry) === String(expiry)));
  const availableStrikes = Array.from(new Set(indexRows.map(r => Number(r.strike)).filter(n => n > 0))).sort((a, b) => a - b);
  if (isCommodity && availableStrikes.length > 1) {
    const counts = new Map();
    for (let i = 1; i < availableStrikes.length; i++) {
      const step = Math.round((availableStrikes[i] - availableStrikes[i - 1]) * 100) / 100;
      if (step > 0) counts.set(step, (counts.get(step) || 0) + 1);
    }
    interval = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || interval;
  }
  let center;
  if (availableStrikes.length) {
    center = availableStrikes.reduce((nearest, strike) => Math.abs(strike - spot) < Math.abs(nearest - spot) ? strike : nearest, availableStrikes[0]);
  } else {
    center = Math.round(spot / interval) * interval;
  }

  if (infoEl) {
    infoEl.innerHTML = `Underlying <strong>${esc(idxConfig.display_name || name)}</strong>: <strong>₹${spot.toLocaleString()}</strong> · Center Strike: <strong style="color: #fbbf24;">${center.toLocaleString()}</strong> · Target Expiry: <strong>${esc(expiry)}</strong> · ${isCommodity ? `Premium multiplier: ${lot}×` : `Lot: ${lot} units`}`;
  }

  const candidatePairs = [];
  const seenPairKeys = new Set();
  let minRequiredBudget = Infinity;

  function addPairCandidate(ceStrike, peStrike, priority = 9999) {
    if (ceStrike <= 0 || peStrike <= 0) return;
    // Strict Trading Rules:
    // 1. PE recommendation must ALWAYS be strictly below current price (pe < spot)
    // 2. CE recommendation must ALWAYS be strictly above current price (ce > spot)
    if (!isCommodity && (Number(ceStrike) <= spot || Number(peStrike) >= spot)) return;

    const key = `${ceStrike}_${peStrike}`;
    if (seenPairKeys.has(key)) return;

    const crow = indexRows.find(x => Number(x.strike) === ceStrike);
    const prow = indexRows.find(x => Number(x.strike) === peStrike);
    const cp = Number(crow?.call);
    const pp = Number(prow?.put);
    if (!(cp > 0 && pp > 0 && lot > 0)) return;

    const minPairCost = (cp + pp) * lot;
    if (minPairCost < minRequiredBudget) minRequiredBudget = minPairCost;

    // Strictly enforce the 1:1.3 budget allocation rule
    const best = findAffordableLots(cp, pp, lot, budget);
    if (!best) return;

    seenPairKeys.add(key);

    const ceDiff = ceStrike - center;
    const peDiff = peStrike - center;
    const isSymmetric = (ceDiff === -peDiff && ceDiff > 0);
    const isEquidistant = Math.abs(ceDiff) === Math.abs(peDiff) && (ceDiff !== 0 || peDiff !== 0);
    const isPrimarySide = (ceDiff >= 0 && peDiff <= 0);
    const equiDist = isEquidistant ? Math.abs(ceDiff) : 999999;
    const avgDist = (Math.abs(ceDiff) + Math.abs(peDiff)) / 2;

    candidatePairs.push({
      ce: ceStrike,
      pe: peStrike,
      ceDiff,
      peDiff,
      cp,
      pp,
      crow,
      prow,
      best,
      priority,
      isSymmetric,
      isEquidistant,
      isPrimarySide,
      equiDist,
      avgDist,
      cost: best.cost,
    });
  }

  if (isCommodity) {
    const above = availableStrikes.filter(strike => strike > spot).sort((a, b) => a - b)[0];
    const belowStrikes = availableStrikes.filter(strike => strike < spot).sort((a, b) => a - b);
    const below = belowStrikes[belowStrikes.length - 1];
    // Commodity recommendations: same-strike straddles just above and below
    // spot, plus the other diagonal (CE above / PE below).
    if (above !== undefined) addPairCandidate(above, above, 1);
    if (below !== undefined) addPairCandidate(below, below, 2);
    if (above !== undefined && below !== undefined) addPairCandidate(above, below, 3);
  } else {
    // Priority combinations and symmetric strikes for equity indices.
    if (center > spot) addPairCandidate(center, center - interval, 1);
    if (center < spot) addPairCandidate(center + interval, center, 2);
    for (let mult = 1; mult <= 10; mult++) {
      const d = mult * interval;
      addPairCandidate(center + d, center - d, 2 + mult);
    }

    const ceAboveStrikes = availableStrikes.filter(s => s > spot && Math.abs(s - center) <= 10 * interval).sort((a, b) => a - b);
    const peBelowStrikes = availableStrikes.filter(s => s < spot && Math.abs(s - center) <= 10 * interval).sort((a, b) => b - a);
    for (const cStrike of ceAboveStrikes) {
      for (const pStrike of peBelowStrikes) {
        const distSum = Math.abs(cStrike - center) + Math.abs(pStrike - center);
        addPairCandidate(cStrike, pStrike, 100 + distSum);
      }
    }
  }

  // ── 3. Apply Selected Sorting / Filtering ────────────────────────────────
  const sortSelect = document.getElementById('pairSortFilter');
  let sortMode = sortSelect?.value || localStorage.getItem('tradex.pairSortFilter') || 'equidistance';
  if (sortMode === 'equidistance_asc') sortMode = 'equidistance';
  if (sortSelect && sortSelect.value !== sortMode) {
    sortSelect.value = sortMode;
  }
  localStorage.setItem('tradex.pairSortFilter', sortMode);

  let pairsToRender = candidatePairs;

  if (isCommodity) {
    pairsToRender = candidatePairs;
  } else if (sortMode === 'equidistance') {
    // 1) Equidistance: small distance to large (filter to symmetric equidistant pairs)
    const equiPairs = candidatePairs.filter(p => p.isSymmetric);
    if (equiPairs.length > 0) {
      equiPairs.sort((a, b) => a.equiDist - b.equiDist);
      pairsToRender = equiPairs;
    } else {
      candidatePairs.sort((a, b) => {
        if (a.isSymmetric && !b.isSymmetric) return -1;
        if (!a.isSymmetric && b.isSymmetric) return 1;
        if (a.isSymmetric && b.isSymmetric) return a.equiDist - b.equiDist;
        return a.avgDist - b.avgDist;
      });
      pairsToRender = candidatePairs;
    }
  } else if (sortMode === 'equidistance_desc') {
    // 2) Equidistance: large distance to small
    const equiPairs = candidatePairs.filter(p => p.isSymmetric);
    if (equiPairs.length > 0) {
      equiPairs.sort((a, b) => b.equiDist - a.equiDist);
      pairsToRender = equiPairs;
    } else {
      candidatePairs.sort((a, b) => {
        if (a.isSymmetric && !b.isSymmetric) return -1;
        if (!a.isSymmetric && b.isSymmetric) return 1;
        if (a.isSymmetric && b.isSymmetric) return b.equiDist - a.equiDist;
        return b.avgDist - a.avgDist;
      });
      pairsToRender = candidatePairs;
    }
  } else if (sortMode === 'budget_desc') {
    // 3) High budget usage to low
    candidatePairs.sort((a, b) => {
      if (b.cost !== a.cost) return b.cost - a.cost;
      return a.priority - b.priority;
    });
    pairsToRender = candidatePairs;
  } else if (sortMode === 'budget_asc') {
    // 4) Low budget usage to high
    candidatePairs.sort((a, b) => {
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.priority - b.priority;
    });
    pairsToRender = candidatePairs;
  } else {
    // Default recommended priority (0/100, -100/0, +-100..+-800, all)
    candidatePairs.sort((a, b) => a.priority - b.priority);
    pairsToRender = candidatePairs;
  }

  const out = [];

  for (const p of pairsToRender) {
    const ce = p.ce;
    const pe = p.pe;
    const cp = p.cp;
    const pp = p.pp;
    const best = p.best;
    const crow = p.crow;
    const prow = p.prow;

    const rawCu = crow?.groww_ce_url || crow?.chart_urls?.CE || makeGrowUrl(idxConfig, expiry, ce, 'CE', rows);
    const rawPu = prow?.groww_pe_url || prow?.chart_urls?.PE || makeGrowUrl(idxConfig, expiry, pe, 'PE', rows);
    const cu = fixGrowwUrl(rawCu);
    const pu = fixGrowwUrl(rawPu);
    const cs = cu ? new URL(cu).pathname.split('/').pop() : `${name}${ce}CE`;
    const ps = pu ? new URL(pu).pathname.split('/').pop() : `${name}${pe}PE`;

    const callInvest = best.cl * cp * lot;
    const putInvest = best.pl * pp * lot;

    let distHtml = '';
    if (p.isSymmetric) {
      distHtml = `
        <div style="font-size: 11px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">
          ±${p.equiDist} pts <span style="font-size: 9px; padding: 1px 5px; background: rgba(56, 189, 248, 0.15); border-radius: 3px; font-weight: 800;">EQUI</span>
        </div>`;
    } else if (p.ceDiff === 0 && p.peDiff !== 0) {
      const pSign = p.peDiff > 0 ? `+${p.peDiff}` : `${p.peDiff}`;
      distHtml = `
        <div style="font-size: 11px; font-weight: 700; color: #fbbf24; margin-bottom: 8px;">
          0 CE / ${pSign} PE
        </div>`;
    } else if (p.ceDiff !== 0 && p.peDiff === 0) {
      const cSign = p.ceDiff > 0 ? `+${p.ceDiff}` : `${p.ceDiff}`;
      distHtml = `
        <div style="font-size: 11px; font-weight: 700; color: #fbbf24; margin-bottom: 8px;">
          ${cSign} CE / 0 PE
        </div>`;
    } else {
      const cSign = p.ceDiff >= 0 ? `+${p.ceDiff}` : `${p.ceDiff}`;
      const pSign = p.peDiff >= 0 ? `+${p.peDiff}` : `${p.peDiff}`;
      distHtml = `
        <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">
          ${cSign} CE / ${pSign} PE
        </div>`;
    }

    const isSelected = window.activeSelectedPair && Number(window.activeSelectedPair.ce) === ce && Number(window.activeSelectedPair.pe) === pe;

    out.push(`
      <tr class="${isSelected ? 'pair-row-selected' : ''}"
          data-pair-key="${ce}_${pe}"
          onclick="selectPairRow(${ce}, ${pe}, this)"
          onmouseenter="highlightChainStrikes(${ce}, ${pe})"
          onmouseleave="onPairMouseLeave()"
          style="transition: all 0.15s ease; cursor: pointer;">
        <!-- 1. Call Strike / LTP & Capital & Lots (Hover highlights ONLY CE in chain) -->
        <td onmouseenter="event.stopPropagation(); highlightSingleSide('CE', ${ce})" onmouseleave="event.stopPropagation(); highlightChainStrikes(${ce}, ${pe})" style="cursor: pointer;" title="Hover to view ${ce} CE in Option Chain">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
            <span style="font-weight: 800; font-size: 15px; color: var(--success); font-family: 'JetBrains Mono', monospace;">${ce} CE</span>
            <span style="font-size: 14px; font-weight: 700; color: var(--text-main);">₹${cp.toFixed(2)}</span>
          </div>
          <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Call Capital</div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text-main); margin-bottom: 2px;">₹${formatMoney(callInvest)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${isCommodity ? `${best.cl} lot(s) · ${lot}× premium per lot` : `${best.cl} lot(s) × ${lot} u`}</div>
        </td>

        <!-- 2. Center Strike (Hover highlights both strikes) -->
        <td onmouseenter="event.stopPropagation(); highlightChainStrikes(${ce}, ${pe})" style="text-align: center; cursor: pointer;">
          <div style="font-weight: 800; color: #fbbf24; font-size: 16px; font-family: 'JetBrains Mono', monospace; margin-bottom: 2px;">${center}</div>
          ${distHtml}
          <div style="display: inline-block; padding: 3px 10px; border-radius: 4px; background: rgba(56, 189, 248, 0.12); color: var(--primary); font-size: 12px; font-weight: 700;">
            ${best.cl} : ${best.pl}
          </div>
        </td>

        <!-- 3. Put Strike / LTP & Capital & Lots (Hover highlights ONLY PE in chain) -->
        <td onmouseenter="event.stopPropagation(); highlightSingleSide('PE', ${pe})" onmouseleave="event.stopPropagation(); highlightChainStrikes(${ce}, ${pe})" style="cursor: pointer;" title="Hover to view ${pe} PE in Option Chain">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
            <span style="font-weight: 800; font-size: 15px; color: var(--danger); font-family: 'JetBrains Mono', monospace;">${pe} PE</span>
            <span style="font-size: 14px; font-weight: 700; color: var(--text-main);">₹${pp.toFixed(2)}</span>
          </div>
          <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Put Capital</div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text-main); margin-bottom: 2px;">₹${formatMoney(putInvest)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${best.pl} lot(s) × ${lot} u</div>
        </td>

        <!-- 4. Total Capital -->
        <td onmouseenter="event.stopPropagation(); highlightChainStrikes(${ce}, ${pe})">
          <div style="font-weight: 800; font-size: 16px; color: var(--primary); margin-bottom: 4px; font-family: 'JetBrains Mono', monospace;">₹${formatMoney(best.cost)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${Math.round((best.cost / budget) * 100)}% of budget</div>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">${best.cl + best.pl} lots total · <span style="color: var(--success); font-weight: 700;">Ratio 1:${best.capRatio ? best.capRatio.toFixed(2) : '1.00'}</span></div>
        </td>

        <!-- 5. Single Enter button + Zerodha Copy Buttons below -->
        <td style="text-align: center; vertical-align: middle;">
          <button class="btn pair-action-btn"
            onclick="event.stopPropagation(); executePairAction('${encodeURIComponent(cu)}', '${encodeURIComponent(pu)}', '${encodeURIComponent(cs)}', '${encodeURIComponent(ps)}')"
            style="padding: 8px 16px; font-size: 13px; font-weight: 700; width: 100%; max-width: 140px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 8px;">
          </button>
          <button type="button" class="btn btn-outline btn-sm"
            onclick="event.stopPropagation(); addPairToPnl('${encodeURIComponent(name)}', '${encodeURIComponent(expiry)}', ${ce}, ${pe}, ${cp}, ${pp}, ${best.cl}, ${best.pl}, ${lot})"
            style="margin-top:6px; width:100%; max-width:160px; border-color:rgba(56,189,248,.5); color:#7dd3fc;">
            ＋ Add to Position P&amp;L
          </button>
          <div class="zerodha-copy-container" style="display: ${currentBrokerMode === 'zerodha' ? 'flex' : 'none'}; gap: 6px; justify-content: center; margin-top: 6px;">
            <button type="button" class="btn btn-outline"
              onclick="copyContractSymbol(event, '${encodeURIComponent(cs)}')"
              title="Copy CE Contract (${cs})"
              style="padding: 3px 8px; font-size: 10px; font-weight: 700; border-color: rgba(124, 58, 237, 0.45); color: #c4b5fd; background: rgba(124, 58, 237, 0.12); border-radius: 5px; cursor: pointer; transition: all 0.15s ease;">
              📋 Copy CE
            </button>
            <button type="button" class="btn btn-outline"
              onclick="copyContractSymbol(event, '${encodeURIComponent(ps)}')"
              title="Copy PE Contract (${ps})"
              style="padding: 3px 8px; font-size: 10px; font-weight: 700; border-color: rgba(124, 58, 237, 0.45); color: #c4b5fd; background: rgba(124, 58, 237, 0.12); border-radius: 5px; cursor: pointer; transition: all 0.15s ease;">
              📋 Copy PE
            </button>
          </div>
        </td>
      </tr>
    `);
  }

  if (tbody) {
    if (out.length) {
      tbody.innerHTML = out.join('');
      _applyBrokerModeUI();
      _stampPairButtons();
    } else if (minRequiredBudget < Infinity && budget < minRequiredBudget) {
      const suggested = Math.ceil(minRequiredBudget / 5000) * 5000;
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 32px 20px;">
        <div style="color: #fbbf24; font-weight: 700; margin-bottom: 8px;">Budget ₹${budget.toLocaleString()} is below minimum required capital</div>
        <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">Minimum capital needed for 1 lot CE + 1 lot PE is <strong>₹${Math.round(minRequiredBudget).toLocaleString()}</strong>.</div>
        <button class="btn btn-primary btn-sm" onclick="setBudgetPreset(${suggested})">Set Budget to ₹${suggested.toLocaleString()}</button>
      </td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">No matching pairs found. Adjust budget or switch index above.</td></tr>`;
    }
  }
}

// Helper: Ensure Groww option URLs are valid (Groww contract tickers MUST be uppercase)
function fixGrowwUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('groww.in') && u.pathname.includes('/options/')) {
      const parts = u.pathname.split('/');
      // parts: ["", "options", "<slug>", "<contractId>"]
      if (parts.length >= 4 && parts[3]) {
        parts[2] = parts[2].toLowerCase(); // e.g. "sp-bse-sensex" or "nifty"
        parts[3] = parts[3].toUpperCase(); // MUST be uppercase on Groww (e.g. SENSEX26O2274100CE)
        u.pathname = parts.join('/');
      }
    }
    return u.toString();
  } catch (_) {
    return url;
  }
}

// ==========================================================================
// Broker Mode Toggle (Groww / Zerodha)
// ==========================================================================
let currentBrokerMode = localStorage.getItem('tradex.brokerMode') || 'groww';

function setBrokerMode(mode) {
  currentBrokerMode = mode;
  localStorage.setItem('tradex.brokerMode', mode);
  _applyBrokerModeUI();
  _stampPairButtons();
}

function _applyBrokerModeUI() {
  const btnG = document.getElementById('modeBtnGroww');
  const btnZ = document.getElementById('modeBtnZerodha');
  if (!btnG || !btnZ) return;
  const isGroww = currentBrokerMode === 'groww';
  btnG.style.background = isGroww ? 'var(--primary)' : 'transparent';
  btnG.style.color      = isGroww ? '#000' : 'var(--text-muted)';
  btnG.style.fontWeight = isGroww ? '800' : '600';
  btnZ.style.background = !isGroww ? '#7c3aed' : 'transparent';
  btnZ.style.color      = !isGroww ? '#fff' : 'var(--text-muted)';
  btnZ.style.fontWeight = !isGroww ? '800' : '600';
}

function _stampPairButtons() {
  document.querySelectorAll('.pair-action-btn').forEach(btn => {
    if (currentBrokerMode === 'groww') {
      btn.className = 'btn btn-primary pair-action-btn';
      btn.innerHTML = '<span>🚀</span> Enter';
      btn.title = 'Open both CE & PE charts in Groww';
      btn.style.boxShadow = '0 2px 10px rgba(0, 210, 144, 0.3)';
      btn.style.background = 'var(--primary)';
      btn.style.color = '#000';
      btn.style.borderColor = 'transparent';
    } else {
      btn.className = 'btn btn-outline pair-action-btn';
      btn.style.borderColor = '#7c3aed';
      btn.style.color = '#fff';
      btn.style.background = 'rgba(124, 58, 237, 0.25)';
      btn.innerHTML = '<span>🪁</span> Enter';
      btn.title = 'Open Zerodha Kite';
      btn.style.boxShadow = '0 2px 10px rgba(124, 58, 237, 0.25)';
    }
  });

  // Toggle copy buttons visibility below Enter
  document.querySelectorAll('.zerodha-copy-container').forEach(el => {
    el.style.display = currentBrokerMode === 'zerodha' ? 'flex' : 'none';
  });
}

function copyContractSymbol(event, encodedSym) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const text = decodeURIComponent(encodedSym);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied "${text}" to clipboard!`, 'success');
    }).catch(() => {
      _fallbackCopyText(text);
    });
  } else {
    _fallbackCopyText(text);
  }
}

function _fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast(`Copied "${text}" to clipboard!`, 'success');
  } catch (_) {
    showToast(`Contract: ${text}`, 'info');
  }
  document.body.removeChild(ta);
}

function executePairAction(ce_url, pe_url, ce_sym, pe_sym) {
  const cu = fixGrowwUrl(decodeURIComponent(ce_url));
  const pu = fixGrowwUrl(decodeURIComponent(pe_url));
  const cs = decodeURIComponent(ce_sym);
  const ps = decodeURIComponent(pe_sym);

  if (currentBrokerMode === 'groww') {
    const t1 = cu ? window.open(cu, '_blank') : null;
    const t2 = pu ? window.open(pu, '_blank') : null;
    if ((!t1 && cu) || (!t2 && pu)) {
      showToast('Pop-ups blocked — allow pop-ups for TradeX in your browser bar.', 'error');
    } else {
      showToast('Opened CE & PE charts in Groww.', 'success');
    }
  } else {
    // Copy exact contract tickers to clipboard so user can instantly paste into Kite search
    const symbols = `${cs} ${ps}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(symbols).catch(() => {});
    }
    window.open('https://kite.zerodha.com/', '_blank');
    showToast(`Copied "${symbols}" to clipboard! Paste into Kite search.`, 'success');
  }
}

// Keep legacy references working
function openPair(c, p) { executePairAction(c, p, c, p); }
function openZerodha(c, p) {
  const cs = decodeURIComponent(c), ps = decodeURIComponent(p);
  window.open('https://kite.zerodha.com/', '_blank');
  showToast(`Search Kite for: ${cs} and ${ps}`, 'info');
}

// Open a single contract in Groww (from Options Chain price click)
function openInGroww(url) {
  const fixed = fixGrowwUrl(url);
  if (!fixed) { showToast('Groww link not available for this contract.', 'error'); return; }
  const t = window.open(fixed, '_blank');
  if (!t) showToast('Pop-ups blocked — allow pop-ups for TradeX.', 'error');
}

// ==========================================================================
// Live Option Chain Matrix (3-Column Layout: Call (CE) | Strike | Put (PE))
// Features:
// 1. Live dotted line with centered real-time price & change:
//    ----------------[ 74,123.45 | -778.35 (-1.04%) ]-----------------
// 2. Hover synchronization: hovering any recommended pair highlights CE & PE
// 3. Unconstrained scrolling: user can scroll freely; auto-re-centers after
//    1 hour of scroll inactivity or via the [🎯 Center ATM] button.
// ==========================================================================
let lastUserScrollTime = 0;
let userHasScrolled = false;
let recenterTimer = null;
let isProgrammaticScroll = false;

function formatOi(oi) {
  const n = Number(oi);
  if (!n || isNaN(n)) return '';
  if (n >= 10000000) return (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function initChainScrollListener() {
  const container = document.getElementById('chainTableContainer');
  if (!container || container._scrollListenerAttached) return;
  container._scrollListenerAttached = true;

  container.addEventListener('scroll', () => {
    if (isProgrammaticScroll) return;

    lastUserScrollTime = Date.now();
    userHasScrolled = true;

    // Clear any previous recenter timer
    if (recenterTimer) clearTimeout(recenterTimer);

    // Re-center automatically only after 1 hour of scroll inactivity
    recenterTimer = setTimeout(() => {
      userHasScrolled = false;
      scrollToSpotLine(true);
      showToast('Live Option Chain re-centered to market price.', 'info');
    }, 60 * 60 * 1000);
  }, { passive: true });
}

function scrollToSpotLine(smooth = true) {
  const container = document.getElementById('chainTableContainer');
  const target = document.getElementById('chain-spot-line-row') || document.getElementById('chain-atm-row');
  if (container && target) {
    isProgrammaticScroll = true;
    const rowTop = target.offsetTop;
    const rowHeight = target.offsetHeight;
    const containerHeight = container.clientHeight;
    const targetScroll = Math.max(0, rowTop - (containerHeight / 2) + (rowHeight / 2));
    container.scrollTo({
      top: targetScroll,
      behavior: smooth ? 'smooth' : 'auto'
    });
    setTimeout(() => { isProgrammaticScroll = false; }, 650);
  }
}

function scrollToAtmStrike(smooth = true) {
  // Manual button click immediately resets the user scroll timer and re-centers
  userHasScrolled = false;
  lastUserScrollTime = 0;
  if (recenterTimer) clearTimeout(recenterTimer);
  scrollToSpotLine(smooth);
}

let chainScrollAnimTimer = null;
let chainHoverRecenterTimer = null;
window.activeSelectedPair = null;

function updateChainBadge(ceStrike, peStrike) {
  const badge = document.getElementById('chainPairSpanBadge');
  if (!badge) return;
  if (ceStrike && peStrike) {
    badge.textContent = `🎯 Focus: ${ceStrike} CE & ${peStrike} PE`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function scrollChainToTarget(element, smooth = true) {
  const container = document.getElementById('chainTableContainer');
  if (!container || !element) return;
  if (chainHoverRecenterTimer) clearTimeout(chainHoverRecenterTimer);
  isProgrammaticScroll = true;
  const elTop = element.offsetTop;
  const elHeight = element.offsetHeight;
  const containerHeight = container.clientHeight;
  const targetScroll = Math.max(0, elTop - (containerHeight / 2) + (elHeight / 2));
  container.scrollTo({
    top: targetScroll,
    behavior: smooth ? 'smooth' : 'auto'
  });
  if (chainScrollAnimTimer) clearTimeout(chainScrollAnimTimer);
  chainScrollAnimTimer = setTimeout(() => { isProgrammaticScroll = false; }, 350);
}

function adjustChainBoxForPair(ceStrike, peStrike, isSelection = false) {
  const container = document.getElementById('chainTableContainer');
  if (!container) return;

  clearChainStrikeHighlights();
  updateChainBadge(ceStrike, peStrike);

  const ceRow = document.querySelector(`#chainRows tr[data-strike="${ceStrike}"]`);
  const peRow = document.querySelector(`#chainRows tr[data-strike="${peStrike}"]`);

  if (ceRow) {
    const ceTd = ceRow.querySelector('td.chain-ce-cell');
    if (ceTd) ceTd.classList.add('cell-highlight-ce');
  }
  if (peRow) {
    const peTd = peRow.querySelector('td.chain-pe-cell');
    if (peTd) peTd.classList.add('cell-highlight-pe');
  }

  if (ceRow && peRow) {
    const top1 = ceRow.offsetTop;
    const top2 = peRow.offsetTop;
    const h1 = ceRow.offsetHeight;
    const h2 = peRow.offsetHeight;
    const minTop = Math.min(top1, top2);
    const maxBottom = Math.max(top1 + h1, top2 + h2);
    const spanHeight = maxBottom - minTop;

    // Dynamically increase option chain box height so BOTH CE and PE strikes fit in full view
    const neededBoxHeight = Math.min(1080, Math.max(620, Math.ceil(spanHeight + 110)));
    container.style.maxHeight = `${neededBoxHeight}px`;

    isProgrammaticScroll = true;
    const midPoint = (minTop + maxBottom) / 2;
    const targetScroll = Math.max(0, midPoint - (neededBoxHeight / 2));
    container.scrollTo({
      top: targetScroll,
      behavior: 'smooth'
    });
    if (chainScrollAnimTimer) clearTimeout(chainScrollAnimTimer);
    chainScrollAnimTimer = setTimeout(() => { isProgrammaticScroll = false; }, 350);
  } else if (ceRow || peRow) {
    const row = ceRow || peRow;
    scrollChainToTarget(row, true);
  }
}

function selectPairRow(ceStrike, peStrike, rowEl) {
  if (window.activeSelectedPair && window.activeSelectedPair.ce === ceStrike && window.activeSelectedPair.pe === peStrike) {
    // Deselect if clicking the same pair again
    window.activeSelectedPair = null;
    document.querySelectorAll('#pairRows tr.pair-row-selected').forEach(r => r.classList.remove('pair-row-selected'));
    clearChainStrikeHighlights();
    updateChainBadge(null, null);
    const container = document.getElementById('chainTableContainer');
    if (container) container.style.maxHeight = '620px';
    scrollToSpotLine(true);
    return;
  }

  window.activeSelectedPair = { ce: ceStrike, pe: peStrike };
  document.querySelectorAll('#pairRows tr.pair-row-selected').forEach(r => r.classList.remove('pair-row-selected'));
  if (rowEl) rowEl.classList.add('pair-row-selected');

  adjustChainBoxForPair(ceStrike, peStrike, true);
}

function highlightSingleSide(side, strike) {
  clearChainStrikeHighlights();
  const row = document.querySelector(`#chainRows tr[data-strike="${strike}"]`);
  if (!row) return;
  if (side === 'CE') {
    const ceTd = row.querySelector('td.chain-ce-cell');
    if (ceTd) ceTd.classList.add('cell-highlight-ce');
  } else if (side === 'PE') {
    const peTd = row.querySelector('td.chain-pe-cell');
    if (peTd) peTd.classList.add('cell-highlight-pe');
  }
  scrollChainToTarget(row, true);
}

function highlightChainStrikes(ceStrike, peStrike) {
  adjustChainBoxForPair(ceStrike, peStrike, false);
}

function clearChainStrikeHighlights() {
  document.querySelectorAll('#chainRows td.cell-highlight-ce').forEach(el => el.classList.remove('cell-highlight-ce'));
  document.querySelectorAll('#chainRows td.cell-highlight-pe').forEach(el => el.classList.remove('cell-highlight-pe'));
}

function onPairMouseLeave() {
  if (window.activeSelectedPair) {
    adjustChainBoxForPair(window.activeSelectedPair.ce, window.activeSelectedPair.pe, true);
    return;
  }
  clearChainStrikeHighlights();
  updateChainBadge(null, null);
  const container = document.getElementById('chainTableContainer');
  if (container) {
    container.style.maxHeight = '620px';
  }
  if (chainHoverRecenterTimer) clearTimeout(chainHoverRecenterTimer);
  chainHoverRecenterTimer = setTimeout(() => {
    if (!userHasScrolled && !window.activeSelectedPair) {
      scrollToSpotLine(true);
    }
  }, 1200);
}

function filterOptionChain() {
  const input = document.getElementById('chainSearch');
  currentFilterStrike = input ? input.value.trim().toLowerCase() : '';
  renderOptionsChain();
}

function renderOptionsChain() {
  const tbody = document.getElementById('chainRows');
  if (!tbody) return;

  const name = getSelectedPairIndex();
  const rows = latestState?.rows || [];
  const quote = Number(latestState?.underlying_prices?.[name] || 0);
  const details = latestState?.underlying_details?.[name] || {};

  let filtered = rows.filter(r => r.index === name);
  if (currentFilterStrike) {
    filtered = filtered.filter(r => String(r.strike).includes(currentFilterStrike));
  }

  // Sort by numeric strike ascending
  filtered.sort((a, b) => Number(a.strike) - Number(b.strike));

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--text-muted);">No option contracts found for ${esc(name)}. Fetching latest available data…</td></tr>`;
    return;
  }

  // Find nearest strike to the underlying spot quote (ATM Strike)
  let atmStrike = null;
  let minDiff = Infinity;
  for (const r of filtered) {
    const s = Number(r.strike);
    if (s > 0) {
      const diff = Math.abs(s - quote);
      if (diff < minDiff) {
        minDiff = diff;
        atmStrike = s;
      }
    }
  }

  // Only slice if rows exceed 25 contracts to avoid cutting off edge strikes
  if (atmStrike !== null && !currentFilterStrike && filtered.length > 25) {
    const atmIndex = filtered.findIndex(r => Number(r.strike) === atmStrike);
    if (atmIndex !== -1) {
      const start = Math.max(0, atmIndex - 10);
      const end = Math.min(filtered.length, atmIndex + 11);
      filtered = filtered.slice(start, end);
    }
  }

  // Fast signature check: if quotes, spot price, and contracts haven't changed, skip DOM re-render
  const chainSig = `${name}_${quote}_${details.day_change}_${filtered.map(r => `${r.strike}:${r.call}:${r.put}:${r.call_oi}:${r.put_oi}`).join(';')}`;
  if (tbody.dataset.renderedSig === chainSig) {
    return;
  }

  // Build live dotted spot price divider row
  const dayChange = Number(details.day_change || 0);
  const dayChangePerc = Number(details.day_change_perc || 0);
  const isPositive = dayChange >= 0;
  const changeClass = isPositive ? 'positive' : 'negative';
  const changeSign = isPositive ? '+' : '';
  const changeText = `${changeSign}${dayChange.toFixed(2)} (${changeSign}${dayChangePerc.toFixed(2)}%)`;
  const spotFormatted = quote.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const spotLineHtml = `
    <tr id="chain-spot-line-row" class="spot-divider-tr">
      <td colspan="3" class="spot-divider-td">
        <div class="spot-divider-wrapper">
          <div class="spot-line left ${changeClass}"></div>
          <div class="spot-price-pill ${changeClass}">
            <span class="spot-price-num">₹${spotFormatted}</span>
            <span class="spot-price-sep">|</span>
            <span class="spot-price-change">${changeText}</span>
          </div>
          <div class="spot-line right ${changeClass}"></div>
        </div>
      </td>
    </tr>
  `;

  const htmlRows = [];
  let spotLineInserted = false;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const strike = Number(r.strike);

    // Insert the live dotted line where the market spot price sits between strikes
    if (!spotLineInserted && quote > 0 && strike > quote && !currentFilterStrike) {
      htmlRows.push(spotLineHtml);
      spotLineInserted = true;
    }

    const isAtm = (strike === atmStrike);
    const callPrice = r.call ? `₹${parseFloat(r.call).toFixed(2)}` : '—';
    const putPrice = r.put ? `₹${parseFloat(r.put).toFixed(2)}` : '—';
    const callOi = r.call_oi ? `<span style="font-size: 10px; color: var(--text-dim); display: block; font-family: sans-serif;">OI: ${formatOi(r.call_oi)}</span>` : '';
    const putOi = r.put_oi ? `<span style="font-size: 10px; color: var(--text-dim); display: block; font-family: sans-serif;">OI: ${formatOi(r.put_oi)}</span>` : '';

    const ceUrl = fixGrowwUrl(r.groww_ce_url || r.chart_urls?.CE || makeGrowUrl(idxConfig, r.expiry, strike, 'CE', rows));
    const peUrl = fixGrowwUrl(r.groww_pe_url || r.chart_urls?.PE || makeGrowUrl(idxConfig, r.expiry, strike, 'PE', rows));

    htmlRows.push(`
      <tr data-strike="${strike}" class="${isAtm ? 'atm-row' : ''}" ${isAtm ? 'id="chain-atm-row"' : ''}>
        <!-- 1. Call (CE) — click price to open Groww chart -->
        <td class="chain-ce-cell" style="text-align: right; padding-right: 18px; cursor: pointer;"
            onclick="openInGroww('${ceUrl.replace(/'/g, "\\'")}')"
            title="Click to view Groww chart">
          ${r.call ? `
          <span class="call-val chain-price-link"
            style="font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', monospace; border-bottom: 1px dashed rgba(0,210,144,0.5); padding-bottom: 1px;">
            ₹${parseFloat(r.call).toFixed(2)}
          </span>` : '<span style="color: var(--text-dim);">—</span>'}
          ${callOi}
        </td>

        <!-- 2. Strike — never highlighted directly -->
        <td style="text-align: center; font-family: 'JetBrains Mono', monospace;">
          <span class="strike-val" style="font-size: 14px; font-weight: 800; ${isAtm ? 'color: #fbbf24;' : ''}">${esc(r.strike)}</span>
          ${isAtm ? '<span class="atm-badge" style="margin-left: 6px;">ATM</span>' : ''}
        </td>

        <!-- 3. Put (PE) — click price to open Groww chart -->
        <td class="chain-pe-cell" style="text-align: left; padding-left: 18px; cursor: pointer;"
            onclick="openInGroww('${peUrl.replace(/'/g, "\\'")}')"
            title="Click to view Groww chart">
          ${r.put ? `
          <span class="put-val chain-price-link"
            style="font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', monospace; border-bottom: 1px dashed rgba(255,75,75,0.5); padding-bottom: 1px;">
            ₹${parseFloat(r.put).toFixed(2)}
          </span>` : '<span style="color: var(--text-dim);">—</span>'}
          ${putOi}
        </td>
      </tr>
    `);
  }

  // If spot is above all strikes in the list, place line at the bottom
  if (!spotLineInserted && quote > 0 && !currentFilterStrike) {
    htmlRows.push(spotLineHtml);
  }

  tbody.innerHTML = htmlRows.join('');
  tbody.dataset.renderedSig = chainSig;

  // Setup scroll listener
  initChainScrollListener();

  // If a recommended pair is actively selected, keep option chain focused and sized to that pair
  if (window.activeSelectedPair) {
    requestAnimationFrame(() => {
      adjustChainBoxForPair(window.activeSelectedPair.ce, window.activeSelectedPair.pe, true);
    });
  } else {
    // Scroll to spot line on initial load or after 1-hour user scroll inactivity
    const timeSinceLastScroll = Date.now() - lastUserScrollTime;
    if (!userHasScrolled || timeSinceLastScroll >= 60 * 60 * 1000) {
      requestAnimationFrame(() => {
        scrollToSpotLine(userHasScrolled);
      });
    }
  }
}

// ==========================================================================
// PnL & Portfolio Tracker
// ==========================================================================
let pnlPositions = JSON.parse(localStorage.getItem('tradex.pnlPositions') || '[]');
let closedPnlTrades = [];
let pnlLastMarketSignature = '';
let pnlScrollRefreshTimer = null;
let pnlChainScrollPauseUntil = 0;
const pnlFullChainCache = new Map();
const pnlFullChainLoading = new Set();
const PNL_CHAIN_RECENTER_COOLDOWN_MS = 60 * 60 * 1000;

function pnlNumber(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pnlFullChainKey(position) {
  return `${String(position.index || '').toUpperCase()}|${String(position.expiry || '')}`;
}

function pnlQuoteIsLive(observedAt = '') {
  if (latestState?.enabled !== true) return false;
  const updatedAt = Date.parse(observedAt || latestState?.last_update || '');
  const maxAgeMs = Math.max(30_000, (Number(cfg?.refresh_seconds) || 5) * 3_000);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= maxAgeMs;
}

function pnlQuoteTimestamp(position, row) {
  const cache = pnlFullChainCache.get(pnlFullChainKey(position));
  if (cache?.rows?.includes(row)) return cache.lastUpdate || row.snapshot_time || '';
  return latestState?.last_update || row?.snapshot_time || '';
}

async function ensurePnlFullChain(position) {
  if (!position?.index) return;
  const key = pnlFullChainKey(position);
  const cached = pnlFullChainCache.get(key);
  const currentSnapshot = latestState?.last_update || '';
  if (cached && cached.lastUpdate === currentSnapshot) return;
  if (pnlFullChainLoading.has(key)) return;
  pnlFullChainLoading.add(key);
  try {
    const query = new URLSearchParams({ index: String(position.index), expiry: String(position.expiry || '') });
    const result = await api(`/api/option-chain?${query.toString()}`);
    pnlFullChainCache.set(key, { rows: result.rows || [], lastUpdate: result.last_update || currentSnapshot, fullChain: !!result.full_chain });
    renderPnl(false);
  } catch (error) {
    console.warn(`Could not load the full ${position.index} option chain:`, error);
  } finally {
    pnlFullChainLoading.delete(key);
  }
}

function pnlQuote(position, strike, side) {
  if (!strike || strike <= 0) return null;
  const field = side === 'CE' ? 'call' : 'put';
  const posIdx = String(position.index || '').toUpperCase();
  const fullRows = pnlFullChainCache.get(pnlFullChainKey(position))?.rows || [];
  const rows = [...fullRows, ...(latestState?.rows || [])];
  const row = rows.find(x => String(x.index || '').toUpperCase() === posIdx
    && (!position.expiry || String(x.expiry) === String(position.expiry))
    && Number(x.strike) === Number(strike)
    && pnlNumber(x[field]) > 0);
  if (row) {
    const observedAt = pnlQuoteTimestamp(position, row);
    return { price: pnlNumber(row[field]), observedAt, source: 'Option chain', live: pnlQuoteIsLive(observedAt) };
  }
  const cache = Object.values(latestState?.last_option_prices || {}).find(x => String(x.index || '').toUpperCase() === posIdx
    && (!position.expiry || String(x.expiry) === String(position.expiry))
    && Number(x.strike) === Number(strike)
    && x.side === side
    && pnlNumber(x.price) > 0);
  const observedAt = cache?.observed_at || '';
  return cache ? { price: pnlNumber(cache.price), observedAt, source: cache.source || 'Last recorded quote', live: pnlQuoteIsLive(observedAt) } : null;
}

function pnlRowQuote(position, row, side) {
  const field = side === 'CE' ? 'call' : 'put';
  const price = pnlNumber(row?.[field]);
  if (price > 0) {
    const observedAt = pnlQuoteTimestamp(position, row);
    return { price, live: pnlQuoteIsLive(observedAt), observedAt };
  }
  return pnlQuote(position, Number(row?.strike), side);
}

function pnlMarketSignature(s = latestState) {
  if (!s) return '';
  const rows = (s.rows || []).map(row => [row.index, row.expiry, row.strike, row.call, row.put]);
  const cached = Object.values(s.last_option_prices || {}).map(item => [item.index, item.expiry, item.strike, item.side, item.price, item.observed_at]);
  return JSON.stringify([s.last_update, s.underlying_prices, rows, cached]);
}

function renderPnlFromPoll() {
  if (pnlMarketSignature() === pnlLastMarketSignature) return;
  renderPnl(false);
}

// ==========================================================================
// Position Value & Trajectory Sparkline Graph
// ==========================================================================
function renderPositionSparkline(pts, invested, current, isProfit) {
  let values = (pts && pts.length >= 2) ? [...pts] : [invested, current];
  const minVal = Math.min(...values, invested);
  const maxVal = Math.max(...values, invested);
  const range = (maxVal - minVal) || (invested * 0.05) || 50;

  const w = 320;
  const h = 70;
  const padTop = 10;
  const padBottom = 16;
  const plotH = h - padTop - padBottom;

  const coords = values.map((val, idx) => {
    const x = (idx / (values.length - 1)) * (w - 24) + 12;
    const y = padTop + plotH - ((val - minVal) / range) * plotH;
    return { x, y, val };
  });

  const beY = padTop + plotH - ((invested - minVal) / range) * plotH;
  const strokeColor = isProfit ? '#00d290' : '#ff4b4b';
  const gradId = `pnlGrad_${Math.random().toString(36).substring(2, 9)}`;

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${h} L ${coords[0].x.toFixed(1)} ${h} Z`;
  const lastCoord = coords[coords.length - 1];

  return `
    <div class="pnl-sparkline-box" style="margin: 10px 0 14px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--text-dim); margin-bottom: 4px;">
        <span style="font-family: 'JetBrains Mono', monospace;">Break-even: ₹${formatMoney(invested)}</span>
        <span style="color: ${strokeColor}; font-weight: 700; font-family: 'JetBrains Mono', monospace;">Latest: ₹${formatMoney(current)}</span>
      </div>
      <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: 70px; overflow: visible; display: block;">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.35" />
            <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Break-even dashed reference line -->
        <line x1="8" y1="${beY.toFixed(1)}" x2="${w - 8}" y2="${beY.toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="3,3" stroke-width="1.2" />

        <!-- Gradient fill under curve -->
        <path d="${areaPath}" fill="url(#${gradId})" />

        <!-- Trend Line -->
        <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Pulsing endpoint dot -->
        <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="4" fill="${strokeColor}" />
        <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="7" fill="${strokeColor}" opacity="0.35">
          <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  `;
}

const pnlChainFilter = {};
function filterPnlChain(posId, val) {
  pnlChainFilter[posId] = (val || '').trim().toLowerCase();
  renderPnl();
}

function pnlLotSize(position) {
  const configured = (cfg.indices || []).find(item => String(item.name).toUpperCase() === String(position.index).toUpperCase());
  return Number(position.lot_size || position.units || latestState?.market_lot_sizes?.[position.index] || configured?.lot_size)
    || (String(position.index).toUpperCase() === 'SENSEX' ? 20 : 65);
}

function pnlLiveSpot(position) {
  const name = String(position.index || '').toUpperCase();
  const prices = latestState?.underlying_prices || {};
  const details = latestState?.underlying_details || {};
  const price = prices[position.index] ?? prices[name] ?? details[position.index]?.price ?? details[name]?.price;
  return pnlNumber(price) || Number(position.spot) || 0;
}

function pnlAtmStrike(position, rows) {
  const spot = pnlLiveSpot(position);
  if (!(spot > 0)) return Number(position.atm_strike) || 0;
  const candidates = rows.filter(row => Number(row.strike) > 0);
  if (!candidates.length) return Number(position.atm_strike) || 0;
  return Number(candidates.reduce((nearest, row) =>
    Math.abs(Number(row.strike) - spot) < Math.abs(Number(nearest.strike) - spot) ? row : nearest
  ).strike);
}

function legacyPositionAsPack(position) {
  if (position.legs?.length) return position;
  const lotSize = pnlLotSize(position);
  const legs = [
    ...(Number(position.callStrike) > 0 && Number(position.callLots) > 0 ? [{ key: 'CE', label: 'Call', strike: Number(position.callStrike), type: 'CE', moneyness: 'MANUAL', entryPrice: Number(position.callEntry), lots: Number(position.callLots) }] : []),
    ...(Number(position.putStrike) > 0 && Number(position.putLots) > 0 ? [{ key: 'PE', label: 'Put', strike: Number(position.putStrike), type: 'PE', moneyness: 'MANUAL', entryPrice: Number(position.putEntry), lots: Number(position.putLots) }] : [])
  ].map(leg => ({ ...leg, invested: leg.entryPrice * leg.lots * lotSize }));
  return { ...position, isPack: true, lot_size: lotSize, strategy: position.strategy || 'Manual Options Position', legs };
}

function copyPositionSymbol(symbol) {
  const copy = navigator.clipboard?.writeText ? navigator.clipboard.writeText(symbol) : Promise.reject();
  copy.catch(() => _fallbackCopyText(symbol));
  window.open('https://kite.zerodha.com/', '_blank');
  showToast(`Copied ${symbol} for Kite.`, 'success');
}

function openPositionGroww(id) {
  const position = pnlPositions.find(item => String(item.id) === String(id));
  const legs = position?.legs || [];
  const urls = legs.map(leg => leg.groww_url).filter(Boolean);
  if (!urls.length) return showToast('No Groww contract links are saved for this position.', 'warning');
  urls.forEach(url => window.open(fixGrowwUrl(url), '_blank'));
}

function copyPositionSymbols(id) {
  const position = pnlPositions.find(item => String(item.id) === String(id));
  if (!position) return;
  const symbols = (position.legs || []).map(leg => `${position.index} ${leg.strike} ${leg.type}`).join(', ');
  const copy = navigator.clipboard?.writeText ? navigator.clipboard.writeText(symbols) : Promise.reject();
  copy.catch(() => _fallbackCopyText(symbols));
  window.open('https://kite.zerodha.com/', '_blank');
  showToast('Copied position symbols for Kite.', 'success');
}

function renderStrategyPackPanel(p) {
  const lotSize = pnlLotSize(p);
  let packInvested = 0;
  let packCurrentVal = 0;
  let totalLots = 0;

  // 1. Calculate each leg's live PnL and aggregate pack values
  const legsData = (p.legs || []).map(leg => {
    const quote = pnlQuote(p, leg.strike, leg.type);
    const hasLiveQuote = !!(quote && quote.price > 0);
    const liveLtp = hasLiveQuote ? quote.price : leg.entryPrice;
    const legInvest = leg.invested || (leg.entryPrice * leg.lots * lotSize);
    const legVal = liveLtp * leg.lots * lotSize;
    const legPnl = legVal - legInvest;
    const legPct = legInvest > 0 ? (legPnl / legInvest * 100) : 0;

    packInvested += legInvest;
    packCurrentVal += legVal;
    totalLots += leg.lots;

    return {
      ...leg,
      liveLtp,
      hasLiveQuote,
      quoteSource: quote?.source || '',
      quoteObservedAt: quote?.observedAt || '',
      legInvest,
      legVal,
      legPnl,
      legPct
    };
  });

  // Sort legs by strike ascending so display order is −40 → −20 → +20 → +40
  legsData.sort((a, b) => Number(a.strike) - Number(b.strike));

  const overallPnl = packCurrentVal - packInvested;
  const overallPct = packInvested > 0 ? (overallPnl / packInvested * 100) : 0;

  // Maintain sparkline history
  if (!Array.isArray(p.history)) p.history = [];
  const now = Date.now();
  const lastPoint = p.history[p.history.length - 1];
  if (!lastPoint || now - lastPoint.t >= 4000 || Math.abs(lastPoint.v - packCurrentVal) > 0.5) {
    p.history.push({ t: now, v: packCurrentVal });
    if (p.history.length > 40) p.history.shift();
  }

  const hit = p.target > 0 && packCurrentVal >= p.target;
  const progressPct = p.target > 0 ? Math.min(100, Math.round((packCurrentVal / p.target) * 100)) : 0;
  const sparklineHtml = renderPositionSparkline(p.history.map(x => x.v), packInvested, packCurrentVal, overallPnl >= 0);

  const legCount = legsData.length;
  const legCountLabel = `${legCount}-Leg`;

  // 2. Build Left Side: Position Legs Breakdown
  const legsHtml = legsData.map(l => {
    const isCall = l.type === 'CE';
    const isCommodityPosition = (cfg.indices || []).find(item => String(item.name).toUpperCase() === String(p.index).toUpperCase())?.category === 'commodity';
    const kiteSym = `${p.index} ${l.strike} ${l.type}`;
    const indexConfig = (cfg.indices || []).find(item => String(item.name).toUpperCase() === String(p.index).toUpperCase());
    const baseUrl = String(indexConfig?.url || 'https://groww.in/options/nifty').split('?')[0];
    const growwUrl = l.groww_url ? fixGrowwUrl(l.groww_url) : `${baseUrl}${p.expiry ? `?expiry=${encodeURIComponent(p.expiry)}` : ''}`;

    return `
      <div style="background: rgba(18, 28, 48, 0.65); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; transition: border-color 0.2s;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 800; font-size: 14px; color: #fff;">${esc(l.label)}</span>
            <span class="${isCall ? 'call-val' : 'put-val'}" style="font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${isCall ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)'}; border: 1px solid ${isCall ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'};">
              ${l.strike} ${l.type}
            </span>
            <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">[${esc(l.moneyness || 'ATM')}]</span>
          </div>
          <div style="text-align: right;">
            <span class="${l.legPnl >= 0 ? 'call-val' : 'put-val'}" style="font-size: 15px; font-weight: 800; font-family: 'JetBrains Mono', monospace;">
              ${l.legPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(l.legPnl))}
            </span>
            <span style="font-size: 11px; font-weight: 700; color: ${l.legPnl >= 0 ? 'var(--call-light)' : 'var(--put-light)'}; margin-left: 4px;">
              (${l.legPnl >= 0 ? '+' : ''}${l.legPct.toFixed(1)}%)
            </span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
          <div>
            <span>Entry: <strong>₹${l.entryPrice.toFixed(2)}</strong></span>
            <span style="margin: 0 4px;">→</span>
            <span>${l.hasLiveQuote ? 'Live LTP' : (l.quoteSource ? 'Last known' : 'LTP unavailable')}: <strong title="${esc(l.quoteObservedAt)}" style="color: ${isCall ? 'var(--call-light)' : 'var(--put-light)'};">${l.hasLiveQuote || l.quoteSource ? `₹${l.liveLtp.toFixed(2)}` : '—'}</strong></span>
          </div>
          <div>
            <span>${l.lots} lot${l.lots > 1 ? 's' : ''} (${isCommodityPosition ? `${(l.lots * lotSize).toLocaleString()}× premium` : `${(l.lots * lotSize).toLocaleString()} units`})</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-dim); border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
          <div>Invested: <strong>₹${formatMoney(l.legInvest)}</strong> · Value: <strong style="color: #fff;">₹${formatMoney(l.legVal)}</strong></div>
          <div style="display: flex; gap: 6px;">
            <a href="${growwUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="font-size: 10px; padding: 2px 7px;">🚀 Groww</a>
            <button type="button" class="btn btn-outline btn-sm" onclick="copyPositionSymbol('${esc(kiteSym)}')" style="font-size: 10px; padding: 2px 7px;">🪁 Kite</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 3. Build Right Side: Live Option Chain Matrix reflecting invested strikes and PnL
  ensurePnlFullChain(p);
  const fullChain = pnlFullChainCache.get(pnlFullChainKey(p));
  let chainRows = (fullChain?.rows ?? (latestState?.rows || []).filter(r => String(r.index).toUpperCase() === String(p.index).toUpperCase() && (!p.expiry || String(r.expiry) === String(p.expiry)))).slice();
  const liveSpot = pnlLiveSpot(p);
  const liveAtmStrike = pnlAtmStrike(p, chainRows);
  const hasLiveChainRows = chainRows.length > 0;
  const spotDetails = latestState?.underlying_details?.[p.index]
    || latestState?.underlying_details?.[String(p.index || '').toUpperCase()] || {};
  const spotDayChange = Number(spotDetails.day_change);
  const spotIsLive = pnlQuoteIsLive(spotDetails.updated_at || '');
  const spotMoveLabel = Number.isFinite(spotDayChange) && spotDayChange !== 0
    ? `${spotDayChange > 0 ? '+' : '−'}₹${formatMoney(Math.abs(spotDayChange))}` : '₹0';
  const spotMarker = liveSpot ? '──────' : '────── (Spot quote unavailable) ──────';

  // Keep every invested strike in the matrix even when the live feed omits
  // that strike (for example during a partial refresh or on a different expiry).
  const chainStrikeSet = new Set(chainRows.map(r => Number(r.strike)));
  legsData.forEach(leg => {
    const strike = Number(leg.strike);
    if (Number.isFinite(strike) && !chainStrikeSet.has(strike)) {
      chainRows.push({ strike, call: null, put: null, call_oi: null, put_oi: null });
      chainStrikeSet.add(strike);
    }
  });
  chainRows.sort((a, b) => Number(a.strike) - Number(b.strike));

  const query = (pnlChainFilter[p.id] || '').trim().toLowerCase();

  // Position cards intentionally show every strike in the selected expiry.
  const visibleChainRows = chainRows;

  const totalChainLen = chainRows ? chainRows.length : 0;
  const shownLen = visibleChainRows.length;
  const chainViewportHeight = 520;

  const filterInput = `
    <div style="margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
      <div style="font-size: 12px; font-weight: 700; color: #38bdf8;">📊 Option Chain · ${pnlQuoteIsLive() ? '<span style="color:#10b981">LIVE</span>' : '<span style="color:#fbbf24">LAST QUOTE</span>'} · ${esc(p.expiry || 'Latest')}<small style="display:block;margin-top:3px;color:var(--text-dim);font-weight:500;">Auto-centers invested strikes once per hour · prices update while Backend scraping is on</small>${fullChain && !fullChain.fullChain ? '<small style="display:block;margin-top:3px;color:#fbbf24;font-weight:500;">Cached subset shown · turn on backend scraping to load all strikes</small>' : ''}</div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 10px; color: var(--text-dim);">${shownLen} of ${totalChainLen} strikes</span>
        <input type="text" placeholder="Filter strikes…" value="${esc(query)}"
          oninput="filterPnlChain(${p.id}, this.value)"
          class="form-control"
          style="width: 140px; font-size: 11px; padding: 3px 8px; background: var(--bg-input);">
      </div>
    </div>
  `;

  const chainScrollId = `pnl-chain-scroll-${p.id}`;
  let rowsHtml = '';
  if (visibleChainRows.length) {
    visibleChainRows.forEach(r => {
      const strike = Number(r.strike);
      const ceLeg = legsData.find(l => Number(l.strike) === strike && l.type === 'CE');
      const peLeg = legsData.find(l => Number(l.strike) === strike && l.type === 'PE');
      // Search filters the surrounding live quotes, but never hides an
      // invested leg from the chart.
      if (query && !String(strike).includes(query) && !ceLeg && !peLeg) return;
      const isAtm = (liveAtmStrike && liveAtmStrike === strike);
      const isInvested = !!(ceLeg || peLeg);

      // Call Cell
      let callCell = '';
      if (ceLeg) {
        callCell = `
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 9px; font-weight: 800; color: #fff; background: ${ceLeg.hasLiveQuote ? 'rgba(16, 185, 129, 0.45)' : 'rgba(251, 191, 36, 0.35)'}; padding: 1px 4px; border-radius: 3px; letter-spacing: 0.3px;">${ceLeg.hasLiveQuote ? '★ INVESTED · LIVE' : (ceLeg.quoteSource ? '★ INVESTED · LAST' : '★ INVESTED')}</span>
            <span title="${esc(ceLeg.quoteObservedAt)}" style="font-weight: 800; font-size: 13px; color: var(--call-light);">${ceLeg.hasLiveQuote || ceLeg.quoteSource ? `₹${ceLeg.liveLtp.toFixed(2)}` : '—'}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 3px;">
            <span style="font-size: 10px; color: var(--text-dim);">₹${ceLeg.entryPrice.toFixed(2)} · ${ceLeg.lots}L</span>
            <span style="font-size: 12px; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: ${ceLeg.legPnl >= 0 ? '#10b981' : '#f43f5e'};">
              ${ceLeg.legPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(ceLeg.legPnl))} (${ceLeg.legPnl >= 0 ? '+' : ''}${ceLeg.legPct.toFixed(1)}%)
            </span>
          </div>
        `;
      } else {
        const quote = pnlRowQuote(p, r, 'CE');
        callCell = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">${r.call_oi || '—'}</span>
            <span title="${quote?.live ? 'Latest option-chain quote' : quote ? `Last known ${quote.observedAt || ''}` : 'No quote available'}" style="font-weight: 700; color: var(--call-light); font-size: 13px;">${quote ? `₹${quote.price.toFixed(2)}${quote.live ? '' : ' · last'}` : '—'}</span>
          </div>
        `;
      }

      // Put Cell
      let putCell = '';
      if (peLeg) {
        putCell = `
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span title="${esc(peLeg.quoteObservedAt)}" style="font-weight: 800; font-size: 13px; color: var(--put-light);">${peLeg.hasLiveQuote || peLeg.quoteSource ? `₹${peLeg.liveLtp.toFixed(2)}` : '—'}</span>
            <span style="font-size: 9px; font-weight: 800; color: #fff; background: ${peLeg.hasLiveQuote ? 'rgba(244, 63, 94, 0.45)' : 'rgba(251, 191, 36, 0.35)'}; padding: 1px 4px; border-radius: 3px; letter-spacing: 0.3px;">${peLeg.hasLiveQuote ? '★ INVESTED · LIVE' : (peLeg.quoteSource ? '★ INVESTED · LAST' : '★ INVESTED')}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 3px;">
            <span style="font-size: 12px; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: ${peLeg.legPnl >= 0 ? '#10b981' : '#f43f5e'};">
              ${peLeg.legPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(peLeg.legPnl))} (${peLeg.legPnl >= 0 ? '+' : ''}${peLeg.legPct.toFixed(1)}%)
            </span>
            <span style="font-size: 10px; color: var(--text-dim);">${peLeg.lots}L · ₹${peLeg.entryPrice.toFixed(2)}</span>
          </div>
        `;
      } else {
        const quote = pnlRowQuote(p, r, 'PE');
        putCell = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span title="${quote?.live ? 'Latest option-chain quote' : quote ? `Last known ${quote.observedAt || ''}` : 'No quote available'}" style="font-weight: 700; color: var(--put-light); font-size: 13px;">${quote ? `₹${quote.price.toFixed(2)}${quote.live ? '' : ' · last'}` : '—'}</span>
            <span style="font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">${r.put_oi || '—'}</span>
          </div>
        `;
      }

      // Center Strike Cell
      const strikeTag = ceLeg ? ceLeg.label : (peLeg ? peLeg.label : (isAtm ? 'CENTER ATM' : ''));

      rowsHtml += `
        <tr ${isInvested ? 'data-invested-row="true"' : ''} style="border-bottom: 1px solid rgba(255,255,255,0.04);">
          <td class="${ceLeg ? 'chain-invested-cell-call' : ''}" style="padding: 7px 10px; font-family: 'JetBrains Mono', monospace;">
            ${callCell}
          </td>
          <td style="text-align: center; padding: 7px 6px; font-family: 'JetBrains Mono', monospace; font-weight: 800; font-size: 13px; color: #fff; background: ${(ceLeg || peLeg) ? 'rgba(56, 189, 248, 0.12)' : (isAtm ? 'rgba(251, 191, 36, 0.1)' : 'transparent')}; border-left: 1px solid var(--border-subtle); border-right: 1px solid var(--border-subtle);">
            <div>${strike}</div>
            ${strikeTag ? `<div style="font-size: 9px; font-weight: 800; color: ${isAtm ? '#fbbf24' : '#38bdf8'}; margin-top: 1px;">${strikeTag}</div>` : ''}
          </td>
          <td class="${peLeg ? 'chain-invested-cell-put' : ''}" style="padding: 7px 10px; font-family: 'JetBrains Mono', monospace;">
            ${putCell}
          </td>
        </tr>
      `;
    });
  } else {
    rowsHtml = `<tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--text-muted);">No chain quotes available for this expiry.</td></tr>`;
  }

  const chainTableHtml = `
      <div style="background: rgba(14, 22, 38, 0.5); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 12px; height: 100%;">
      <div title="${spotIsLive ? 'Live underlying price and session change' : 'Last known underlying price and session change'}" style="text-align:center;margin:0 0 10px;padding:8px 6px;border-radius:6px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.18);font:700 12px 'JetBrains Mono',monospace;color:#bae6fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${spotMarker}${liveSpot ? `<span style="color:#fff;"> ₹${formatMoney(liveSpot)} (${spotMoveLabel}) </span>${spotIsLive ? '<span style="color:#10b981;font:700 10px Inter,sans-serif;">LIVE</span>' : '<span style="color:#fbbf24;font:700 10px Inter,sans-serif;">LAST</span>'}` : ''}</div>
      ${filterInput}
      <div id="${chainScrollId}" data-has-live-rows="${hasLiveChainRows}" style="max-height: ${chainViewportHeight}px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;">
        <table class="data-table" style="width: 100%; margin: 0; font-size: 12px;">
          <thead style="position: sticky; top: 0; z-index: 2; background: #0c1527;">
            <tr>
              <th style="text-align: right; width: 40%; padding: 6px 10px; color: var(--call-light);">CALLS (CE)</th>
              <th style="text-align: center; width: 20%; padding: 6px 6px; color: #fbbf24;">STRIKE</th>
              <th style="text-align: left; width: 40%; padding: 6px 10px; color: var(--put-light);">PUTS (PE)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="font-size: 10px; color: var(--text-dim); margin-top: 8px; text-align: center;">
        🟢 Showing all available strikes for this expiry; invested strikes remain highlighted.
      </div>
    </div>
  `;

  return {
    invested: packInvested,
    currentVal: packCurrentVal,
    netPnl: overallPnl,
    hit,
    html: `
      <div class="pnl-strategy-pack-panel ${hit ? 'target-hit' : ''}">
        <!-- Header -->
        <div class="pnl-card-header" style="align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span class="pnl-badge" style="font-size: 12px; padding: 3px 10px;">${esc(p.index)}</span>
            <div style="font-weight: 800; font-size: 16px; color: #fff;">${esc(p.strategy || `${legCountLabel} Strategy Pack`)}</div>
            <div style="display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
              <span>Expiry: <strong style="color: #fbbf24;">${esc(p.expiry || 'Latest')}</strong></span>
              <span>·</span>
              <span title="${spotIsLive ? 'Live underlying quote' : 'Last known underlying quote'}">Spot: <strong style="color: #fff;">₹${liveSpot ? formatMoney(liveSpot) : '—'}</strong>${Number.isFinite(spotDayChange) && spotDayChange !== 0 ? `<strong style="color:${spotDayChange > 0 ? '#10b981' : '#f43f5e'};"> (${spotDayChange > 0 ? '+' : '−'}₹${formatMoney(Math.abs(spotDayChange))})</strong>` : ''}<small style="color:${spotIsLive ? '#10b981' : '#fbbf24'};font-weight:700;">${spotIsLive ? ' LIVE' : (liveSpot ? ' LAST' : ' OFFLINE')}</small></span>
              <span>·</span>
              <span>ATM: <strong style="color: #fbbf24;">${liveAtmStrike || '—'}</strong></span>
              <span>·</span>
              <span>${(cfg.indices || []).find(item => String(item.name).toUpperCase() === String(p.index).toUpperCase())?.category === 'commodity' ? 'Multiplier' : 'Lot'}: <strong>${lotSize}${(cfg.indices || []).find(item => String(item.name).toUpperCase() === String(p.index).toUpperCase())?.category === 'commodity' ? '×' : ' u'}</strong></span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-outline btn-sm" onclick="openPositionGroww(${p.id})" title="Open all position legs on Groww" style="font-size: 11px;">🚀 Groww All</button>
            <button class="btn btn-outline btn-sm" onclick="copyPositionSymbols(${p.id})" title="Copy symbols for Kite" style="font-size: 11px;">🪁 Copy All</button>
            <button class="btn btn-outline btn-sm" onclick="openEditPnlPosition(${p.id})">✎ Edit Entry / Lots</button>
            <button class="btn btn-sm btn-danger" onclick="exitPnlPosition(${p.id})" title="Close this paper trade and save it to trade history">↗ Exit Trade</button>
            <button class="btn btn-sm btn-danger" onclick="removePnlPosition(${p.id})">✕ Remove Strategy</button>
          </div>
        </div>

        <!-- Combined strategy PnL summary -->
        <div class="pnl-hero-box" style="border: 1.5px solid ${overallPnl >= 0 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)'};">
  <div>
            <div style="font-size: 11px; font-weight: 800; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px;">
              ⚡ OVERALL ${legCountLabel.toUpperCase()} STRATEGY P&amp;L
            </div>
            <div style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;">
              <span style="font-size: 34px; font-weight: 900; font-family: 'JetBrains Mono', monospace; color: ${overallPnl >= 0 ? '#10b981' : '#f43f5e'}; line-height: 1;">
                ${overallPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(overallPnl))}
              </span>
              <span style="font-size: 15px; font-weight: 800; padding: 3px 10px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; background: ${overallPnl >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)'}; color: ${overallPnl >= 0 ? '#10b981' : '#f43f5e'}; border: 1px solid ${overallPnl >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'};">
                ${overallPnl >= 0 ? '+' : ''}${overallPct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div style="display: flex; gap: 24px; flex-wrap: wrap; align-items: center;">
            <div>
              <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Total Invested</div>
              <div style="font-size: 18px; font-weight: 800; color: var(--text-main); font-family: 'JetBrains Mono', monospace;">₹${formatMoney(packInvested)}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Current Value</div>
              <div style="font-size: 18px; font-weight: 800; color: #38bdf8; font-family: 'JetBrains Mono', monospace;">₹${formatMoney(packCurrentVal)}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700;">Active Wings</div>
              <div style="font-size: 18px; font-weight: 800; color: #fbbf24; font-family: 'JetBrains Mono', monospace;">${p.legs.length} Legs (${totalLots} Lots)</div>
            </div>
          </div>
        </div>

        <!-- 2-Column Split: Position legs | Right Live Option Chain Matrix -->
        <div class="pnl-pack-grid">
          <!-- Left Column -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 13px; font-weight: 800; color: var(--text-main);">📦 ${legCountLabel} Position Breakdown</span>
              <span style="font-size: 11px; color: var(--text-muted);">${totalLots} Lots Combined</span>
            </div>
            ${legsHtml}

            <!-- Trajectory Sparkline Graph -->
            ${sparklineHtml}

            <!-- Profit Target Box -->
            ${p.target > 0 ? `
              <div class="pnl-target-box" style="margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                  <span style="color: var(--text-muted);">Target: ₹${formatMoney(p.target)}</span>
                  <span style="font-weight: 700; color: ${hit ? 'var(--call-green)' : 'var(--primary)'};">${progressPct}%</span>
                </div>
                <div class="pnl-progress-track">
                  <div class="pnl-progress-bar" style="width: ${progressPct}%;"></div>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Right Column -->
          <div>
            ${chainTableHtml}
          </div>
        </div>
      </div>
    `
  };
}

function renderPnl(force = true) {
  const host = document.getElementById('pnlPositionsGrid');
  if (!host) return;

  if (!host.dataset.pnlScrollListener) {
    host.addEventListener('scroll', event => {
      if (!String(event.target?.id || '').startsWith('pnl-chain-scroll-')) return;
      pnlChainScrollPauseUntil = Date.now() + 650;
      if (pnlScrollRefreshTimer) clearTimeout(pnlScrollRefreshTimer);
      pnlScrollRefreshTimer = setTimeout(() => {
        pnlScrollRefreshTimer = null;
        pnlChainScrollPauseUntil = 0;
        renderPnl(true);
      }, 700);
    }, { capture: true, passive: true });
    host.dataset.pnlScrollListener = 'true';
  }
  // Do not replace a chain's DOM while wheel/touch momentum is scrolling it.
  if (!force && Date.now() < pnlChainScrollPauseUntil) return;
  pnlLastMarketSignature = pnlMarketSignature();

  // PnL is refreshed during every state poll. Preserve each chain's scroll
  // position while replacing its markup so polling does not jump the user.
  const priorChainScroll = new Map(
    [...host.querySelectorAll('[id^="pnl-chain-scroll-"]')]
      .map(el => [el.id, el.scrollTop])
  );

  if (!pnlPositions.length) {
    host.innerHTML = `
      <div class="card" style="grid-column: 1/-1; text-align: center; padding: 48px 24px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 12px;">💼</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--text-main);">No active positions tracked</div>
        <p style="margin: 8px 0 16px;">Track live Call + Put positions, monitor combined P&amp;L, and get alerts when target is reached.</p>
        <button class="btn btn-primary" onclick="openPnlModal()">＋ Add New Position</button>
      </div>
    `;
    updatePnlSummary(0, 0, 0, 0);
    return;
  }

  let totalUnrealizedPnl = 0;
  let totalInvested = 0;
  let targetsHitCount = 0;
  let changed = false;

  const html = pnlPositions.map(p => {
    // If this position is a Multi-Leg Strategy Pack, render Complete Setup Panel!
    if (p.isPack || (p.legs && p.legs.length > 0) || Number(p.callStrike) > 0 || Number(p.putStrike) > 0) {
      const packRes = renderStrategyPackPanel(legacyPositionAsPack(p));
      totalInvested += packRes.invested;
      totalUnrealizedPnl += packRes.netPnl;
      if (packRes.hit) targetsHitCount++;
      return packRes.html;
    }

    const hasCall = p.callStrike > 0 && p.callLots > 0;
    const hasPut = p.putStrike > 0 && p.putLots > 0;
    const c = hasCall ? pnlQuote(p, p.callStrike, 'CE') : null;
    const u = hasPut ? pnlQuote(p, p.putStrike, 'PE') : null;
    const ready = (!hasCall || !!c) && (!hasPut || !!u) && (hasCall || hasPut);
    const units = p.units || Number(p.lot_size || latestState?.market_lot_sizes?.[p.index] || (cfg.indices || []).find(x => String(x.name).toUpperCase() === String(p.index).toUpperCase())?.lot_size) || (String(p.index).toUpperCase() === 'SENSEX' ? 20 : 65);

    const callInvest = hasCall ? (p.callEntry * p.callLots * units) : 0;
    const putInvest = hasPut ? (p.putEntry * p.putLots * units) : 0;
    const investedCapital = callInvest + putInvest;
    totalInvested += investedCapital;

    const callCurrentPrice = c ? c.price : (hasCall ? p.callEntry : 0);
    const putCurrentPrice = u ? u.price : (hasPut ? p.putEntry : 0);
    const callValue = hasCall ? (callCurrentPrice * p.callLots * units) : 0;
    const putValue = hasPut ? (putCurrentPrice * p.putLots * units) : 0;
    const currentVal = ready ? (callValue + putValue) : investedCapital;

    const callPnl = hasCall ? ((callCurrentPrice - p.callEntry) * p.callLots * units) : 0;
    const putPnl = hasPut ? ((putCurrentPrice - p.putEntry) * p.putLots * units) : 0;
    const netPnl = callPnl + putPnl;
    if (ready) totalUnrealizedPnl += netPnl;

    const hit = ready && p.target > 0 && currentVal >= p.target;
    if (hit) targetsHitCount++;

    // Notification handling
    if (hit && !p.alerted) {
      p.alerted = true;
      changed = true;
      showToast(`🎯 TARGET HIT: ${p.index} reached ₹${formatMoney(currentVal)}!`, 'success');
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Target Reached · ${p.index}`, {
          body: `Position value reached ₹${formatMoney(currentVal)} (Target: ₹${formatMoney(p.target)})`
        });
      }
    } else if (!hit && p.alerted) {
      p.alerted = false;
      changed = true;
    }

    const progressPct = p.target > 0 ? Math.min(100, Math.round((currentVal / p.target) * 100)) : 0;

    // Maintain value history for sparkline chart
    if (!Array.isArray(p.history)) p.history = [];
    const now = Date.now();
    const lastPoint = p.history[p.history.length - 1];
    if (!lastPoint || now - lastPoint.t >= 4000 || Math.abs(lastPoint.v - currentVal) > 0.5) {
      p.history.push({ t: now, v: currentVal });
      if (p.history.length > 40) p.history.shift();
      changed = true;
    }

    const sparklineHtml = renderPositionSparkline(p.history.map(x => x.v), investedCapital, currentVal, netPnl >= 0);

    return `
      <div class="pnl-card ${hit ? 'target-hit' : ''}">
        <div class="pnl-card-header">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="pnl-badge">${esc(p.index)}</span>
              ${p.strategy ? `<span style="font-size: 11px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 1px 6px; border-radius: 4px;">${esc(p.strategy)}</span>` : ''}
            </div>
            <div style="font-weight: 700; font-size: 15px; margin-top: 4px;">${esc(p.expiry || 'Latest Expiry')}</div>
            <div style="font-size: 11px; color: var(--text-dim);">Lot: ${units} units</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-outline" onclick="openEditPnlPosition(${p.id})">✎ Edit</button>
            <button class="btn btn-sm btn-danger" onclick="exitPnlPosition(${p.id})" title="Close this paper trade and save it to trade history">↗ Exit Trade</button>
            <button class="btn btn-sm btn-outline" onclick="removePnlPosition(${p.id})">✕ Remove</button>
          </div>
        </div>

        ${ready ? `
          <!-- Prominent Current Value in Large Text with PnL Badge -->
          <div style="margin: 12px 0 8px;">
            <div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 2px;">
              Current Value
            </div>
            <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;">
              <span style="font-size: 28px; font-weight: 800; color: var(--text-main); font-family: 'JetBrains Mono', monospace; line-height: 1.1;">
                ₹${formatMoney(currentVal)}
              </span>
              <span class="${netPnl >= 0 ? 'call-val' : 'put-val'}" style="font-size: 13px; font-weight: 800; padding: 3px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; background: ${netPnl >= 0 ? 'rgba(0, 210, 144, 0.15)' : 'rgba(255, 75, 75, 0.15)'}; border: 1px solid ${netPnl >= 0 ? 'rgba(0, 210, 144, 0.3)' : 'rgba(255, 75, 75, 0.3)'};">
                ${netPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(netPnl))} (${netPnl >= 0 ? '+' : ''}${investedCapital > 0 ? ((netPnl / investedCapital) * 100).toFixed(2) : '0.00'}%)
              </span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Invested Capital: <strong style="color: var(--text-main);">₹${formatMoney(investedCapital)}</strong>
            </div>
          </div>

          <!-- Position Value & PnL Sparkline Graph -->
          ${sparklineHtml}

          <div class="pnl-legs">
            ${hasCall ? `
            <div class="pnl-leg">
              <div class="pnl-leg-title">
                <span class="call-val">${p.callStrike} CE</span>
                <span>${p.callLots} lot${p.callLots > 1 ? 's' : ''}</span>
              </div>
              <div style="font-size: 13px; font-weight: 700;">₹${callCurrentPrice.toFixed(2)}</div>
              <div style="font-size: 10px; color: var(--text-dim);">Entry: ₹${p.callEntry.toFixed(2)}</div>
              <div class="num ${callPnl >= 0 ? 'call-val' : 'put-val'}" style="font-size: 11px; font-weight: 700; margin-top: 2px;">
                ${callPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(callPnl))}
              </div>
            </div>` : ''}

            ${hasPut ? `
            <div class="pnl-leg">
              <div class="pnl-leg-title">
                <span class="put-val">${p.putStrike} PE</span>
                <span>${p.putLots} lot${p.putLots > 1 ? 's' : ''}</span>
              </div>
              <div style="font-size: 13px; font-weight: 700;">₹${putCurrentPrice.toFixed(2)}</div>
              <div style="font-size: 10px; color: var(--text-dim);">Entry: ₹${p.putEntry.toFixed(2)}</div>
              <div class="num ${putPnl >= 0 ? 'call-val' : 'put-val'}" style="font-size: 11px; font-weight: 700; margin-top: 2px;">
                ${putPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(putPnl))}
              </div>
            </div>` : ''}
          </div>

          ${p.target > 0 ? `
            <div class="pnl-target-box">
              <div style="display: flex; justify-content: space-between; font-size: 11px;">
                <span style="color: var(--text-muted);">Target: ₹${formatMoney(p.target)}</span>
                <span style="font-weight: 700; color: ${hit ? 'var(--call-green)' : 'var(--primary)'};">${progressPct}%</span>
              </div>
              <div class="pnl-progress-track">
                <div class="pnl-progress-bar" style="width: ${progressPct}%;"></div>
              </div>
            </div>
          ` : ''}
        ` : `
          <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
            Waiting for live price update…
          </div>
        `}
      </div>
    `;
  }).join('');

  host.innerHTML = html;
  priorChainScroll.forEach((scrollTop, id) => {
    const container = document.getElementById(id);
    if (container) container.scrollTop = scrollTop;
  });
  updatePnlSummary(totalUnrealizedPnl, totalInvested, pnlPositions.length, targetsHitCount);

  // Re-center each Position PnL chain at most once an hour. Normal live
  // polling preserves the user's current position between re-centers.
  requestAnimationFrame(() => {
    setTimeout(() => {
      pnlPositions.forEach(p => {
        const hasPositionLegs = p.isPack || (p.legs && p.legs.length)
          || Number(p.callStrike) > 0 || Number(p.putStrike) > 0;
        if (!hasPositionLegs) return;
        const scrollContainer = document.getElementById(`pnl-chain-scroll-${p.id}`);
        const investedRows = scrollContainer?.querySelectorAll('[data-invested-row="true"]');
        if (investedRows?.length && scrollContainer?.dataset.hasLiveRows === 'true'
            && scrollContainer.clientHeight > 0 && scrollContainer.getClientRects().length) {
          const cooldownKey = `tradex.pnlChainRecenterAt.v3.${p.id}`;
          const lastRecenter = Number(localStorage.getItem(cooldownKey) || 0);
          if (Date.now() - lastRecenter < PNL_CHAIN_RECENTER_COOLDOWN_MS) return;

          // Center the full invested-strike span, not just its first row.
          const first = investedRows[0].getBoundingClientRect();
          const last = investedRows[investedRows.length - 1].getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();
          if (first.height <= 0 || last.height <= 0 || scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;
          const investedCenter = (first.top + last.bottom) / 2;
          const delta = investedCenter - (containerRect.top + scrollContainer.clientHeight / 2);
          const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
          const previousScrollTop = scrollContainer.scrollTop;
          const nextScrollTop = Math.max(0, Math.min(maxScroll, previousScrollTop + delta));
          if (Math.abs(nextScrollTop - previousScrollTop) >= 2) {
            scrollContainer.scrollTop = nextScrollTop;
            localStorage.setItem(cooldownKey, String(Date.now()));
          }
        }
      });
    }, 80);
  });

  if (changed) {
    localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
  }
}

function updatePnlSummary(pnl, invested, activeCount, targetsCount) {
  const pnlEl = document.getElementById('sumTotalPnl');
  if (pnlEl) {
    pnlEl.textContent = `${pnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(pnl))}`;
    pnlEl.className = `val ${pnl >= 0 ? 'call-val' : 'put-val'}`;
  }
  const invEl = document.getElementById('sumInvested');
  if (invEl) invEl.textContent = `₹${formatMoney(invested)}`;
  const countEl = document.getElementById('sumActivePositions');
  if (countEl) countEl.textContent = activeCount;
  const targetEl = document.getElementById('sumTargetsReached');
  if (targetEl) targetEl.textContent = targetsCount;
}

async function loadClosedTrades() {
  try {
    closedPnlTrades = await api('/api/trades/closed');
    renderClosedTrades();
  } catch (err) {
    console.error('Could not load closed trades:', err);
    showToast('Could not load local trade history.', 'error');
  }
}

function renderClosedTrades() {
  const host = document.getElementById('pnlClosedTrades');
  if (!host) return;
  if (!closedPnlTrades.length) {
    host.innerHTML = '<div class="card" style="padding:18px; color:var(--text-muted);">No closed trades saved yet.</div>';
    return;
  }
  host.innerHTML = `<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">
    <thead><tr><th>Closed</th><th>Symbol</th><th>Strategy</th><th>Expiry</th><th>Exit legs</th><th style="text-align:right;">Realized P&amp;L</th></tr></thead>
    <tbody>${closedPnlTrades.map(trade => {
      const pos = trade.position || {};
      const legs = trade.exit_legs || [];
      const date = trade.closed_at ? new Date(trade.closed_at).toLocaleString() : '—';
      const legsText = legs.map(leg => `${esc(leg.strike)} ${esc(leg.side)} @ ₹${formatMoney(leg.exit_price)}`).join('<br>');
      return `<tr><td>${esc(date)}</td><td>${esc(pos.index || '—')}</td><td>${esc(pos.strategy || 'Options position')}</td><td>${esc(pos.expiry || '—')}</td><td>${legsText || '—'}</td><td style="text-align:right;font-weight:800;color:${trade.realized_pnl >= 0 ? 'var(--call-light)' : 'var(--put-light)'};">${trade.realized_pnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(trade.realized_pnl))}</td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

async function exitPnlPosition(id) {
  const position = pnlPositions.find(item => String(item.id) === String(id));
  if (!position) return;
  const lotSize = Number(position.lot_size || position.units || latestState?.market_lot_sizes?.[position.index])
    || Number((cfg.indices || []).find(x => String(x.name).toUpperCase() === String(position.index).toUpperCase())?.lot_size)
    || (String(position.index).toUpperCase() === 'SENSEX' ? 20 : 65);
  const sourceLegs = position.legs?.length
    ? position.legs.map(leg => ({ side: leg.type, strike: Number(leg.strike), entry: Number(leg.entryPrice), lots: Number(leg.lots), lotSize }))
    : [
        ...(Number(position.callStrike) > 0 ? [{ side: 'CE', strike: Number(position.callStrike), entry: Number(position.callEntry), lots: Number(position.callLots), lotSize }] : []),
        ...(Number(position.putStrike) > 0 ? [{ side: 'PE', strike: Number(position.putStrike), entry: Number(position.putEntry), lots: Number(position.putLots), lotSize }] : [])
      ];
  if (!sourceLegs.length) {
    showToast('This position has no valid legs to exit.', 'error');
    return;
  }
  const exitLegs = sourceLegs.map(leg => {
    const quote = pnlQuote(position, leg.strike, leg.side);
    const exitPrice = quote?.price > 0 ? quote.price : leg.entry;
    return { ...leg, entry_price: leg.entry, exit_price: exitPrice, price_source: quote?.source || 'Entry price fallback', pnl: (exitPrice - leg.entry) * leg.lots * leg.lotSize };
  });
  const realizedPnl = exitLegs.reduce((total, leg) => total + leg.pnl, 0);
  const fallbackCount = exitLegs.filter(leg => leg.price_source === 'Entry price fallback').length;
  const note = fallbackCount ? `\n${fallbackCount} leg(s) have no live quote and will use entry price.` : '';
  if (!window.confirm(`Exit ${position.index || 'position'} as a paper trade?\nEstimated realized P&L: ${realizedPnl >= 0 ? '+' : '−'}₹${formatMoney(Math.abs(realizedPnl))}${note}`)) return;

  try {
    const result = await api('/api/trades/closed', {
      position_id: String(position.id),
      position: JSON.parse(JSON.stringify(position)),
      exit_legs: exitLegs,
      realized_pnl: realizedPnl
    });
    closedPnlTrades.unshift(result.trade);
    pnlPositions = pnlPositions.filter(item => String(item.id) !== String(id));
    localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
    renderPnl();
    renderClosedTrades();
    showToast('Paper trade exited and saved to local trade history.', 'success');
  } catch (err) {
    showToast(`Could not save exit: ${err.message}`, 'error');
  }
}

function openPnlModal() {
  document.getElementById('pnlFormError').textContent = '';
  const select = document.getElementById('pnlIndex');
  select.innerHTML = [['equity', 'Equity'], ['commodity', 'Commodity']].map(([category, label]) => {
    const entries = (cfg.indices || []).filter(item => (item.category || 'equity') === category);
    return entries.length ? `<optgroup label="${label}">${entries.map(item => `<option value="${esc(item.name)}">${esc(item.display_name || item.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  populatePnlExpiries();
  document.getElementById('pnlModal').classList.add('open');
}

function closePnlModal() {
  document.getElementById('pnlModal').classList.remove('open');
}

function populatePnlExpiries() {
  const name = document.getElementById('pnlIndex').value;
  const rows = latestState?.rows || [];
  const cache = Object.values(latestState?.last_option_prices || {});
  const expiries = [...new Set([
    ...rows.filter(x => x.index === name && x.expiry).map(x => String(x.expiry)),
    ...cache.filter(x => x.index === name && x.expiry).map(x => String(x.expiry))
  ])];
  const sel = document.getElementById('pnlExpiry');
  sel.innerHTML = expiries.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if (!expiries.length) sel.innerHTML = '<option value="">Latest available</option>';
}

function savePnlPosition() {
  const val = id => document.getElementById(id).value.trim();
  const item = {
    id: Date.now(),
    index: val('pnlIndex'),
    expiry: val('pnlExpiry'),
    isPack: true,
    strategy: 'Manual Options Position',
    lot_size: pnlLotSize({ index: val('pnlIndex') }),
    callStrike: Number(val('pnlCallStrike')),
    callEntry: Number(val('pnlCallEntry')),
    callLots: Number(val('pnlCallLots')),
    putStrike: Number(val('pnlPutStrike')),
    putEntry: Number(val('pnlPutEntry')),
    putLots: Number(val('pnlPutLots')),
    target: Number(val('pnlTarget')),
    alerted: false
  };

  if (!item.index || !(item.callStrike > 0) || !(item.putStrike > 0) || !(item.callEntry > 0) || !(item.putEntry > 0)
      || !Number.isInteger(item.callLots) || item.callLots <= 0 || !Number.isInteger(item.putLots) || item.putLots <= 0) {
    document.getElementById('pnlFormError').textContent = 'Please provide valid strikes, positive entry prices and lot sizes.';
    return;
  }

  item.legs = [
    { key: 'CE', label: 'Call', strike: item.callStrike, type: 'CE', moneyness: 'MANUAL', entryPrice: item.callEntry, lots: item.callLots },
    { key: 'PE', label: 'Put', strike: item.putStrike, type: 'PE', moneyness: 'MANUAL', entryPrice: item.putEntry, lots: item.putLots }
  ].map(leg => ({ ...leg, invested: leg.entryPrice * leg.lots * item.lot_size }));

  pnlPositions.push(item);
  localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
  closePnlModal();
  renderPnl();
  showToast('Options position saved!', 'success');
}

function addPairToPnl(encodedIndex, encodedExpiry, callStrike, putStrike, callEntry, putEntry, callLots, putLots, lotSize) {
  const index = decodeURIComponent(encodedIndex);
  const expiry = decodeURIComponent(encodedExpiry);
  const rows = latestState?.rows || [];
  const indexConfig = (cfg.indices || []).find(item => String(item.name).toUpperCase() === index.toUpperCase()) || { name: index };
  const callRow = rows.find(row => String(row.index).toUpperCase() === index.toUpperCase() && Number(row.strike) === Number(callStrike) && (!expiry || String(row.expiry) === expiry));
  const putRow = rows.find(row => String(row.index).toUpperCase() === index.toUpperCase() && Number(row.strike) === Number(putStrike) && (!expiry || String(row.expiry) === expiry));
  const position = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    isPack: true,
    index,
    expiry,
    strategy: 'Affordable Symmetric Pair',
    lot_size: Number(lotSize),
    spot: Number(latestState?.underlying_prices?.[index]) || 0,
    atm_strike: 0,
    target: 0,
    alerted: false,
    history: [],
    legs: [
      { key: 'CE', label: 'Call', strike: Number(callStrike), type: 'CE', moneyness: 'PAIR', entryPrice: Number(callEntry), lots: Number(callLots), invested: Number(callEntry) * Number(callLots) * Number(lotSize), groww_url: callRow?.chart_urls?.CE || callRow?.groww_ce_url || makeGrowUrl(indexConfig, expiry, callStrike, 'CE', rows) },
      { key: 'PE', label: 'Put', strike: Number(putStrike), type: 'PE', moneyness: 'PAIR', entryPrice: Number(putEntry), lots: Number(putLots), invested: Number(putEntry) * Number(putLots) * Number(lotSize), groww_url: putRow?.chart_urls?.PE || putRow?.groww_pe_url || makeGrowUrl(indexConfig, expiry, putStrike, 'PE', rows) }
    ]
  };
  pnlPositions.push(position);
  localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
  renderPnl();
  showPageTab('pnl');
  showToast(`Added ${index} ${callStrike} CE + ${putStrike} PE as one paper position.`, 'success');
}

let editingPnlPositionId = null;
let editingPnlLegs = [];

function openEditPnlPosition(id) {
  const position = pnlPositions.find(item => String(item.id) === String(id));
  if (!position) return;
  editingPnlPositionId = position.id;
  if (position.legs?.length) {
    editingPnlLegs = position.legs.map(leg => ({ type: leg.type, strike: leg.strike, entry: leg.entryPrice, lots: leg.lots, target: leg }));
  } else {
    editingPnlLegs = [
      ...(Number(position.callStrike) > 0 ? [{ type: 'CE', strike: position.callStrike, entry: position.callEntry, lots: position.callLots, target: position }] : []),
      ...(Number(position.putStrike) > 0 ? [{ type: 'PE', strike: position.putStrike, entry: position.putEntry, lots: position.putLots, target: position }] : [])
    ];
  }
  document.getElementById('pnlEditError').textContent = '';
  document.getElementById('pnlEditLegFields').innerHTML = editingPnlLegs.map((leg, index) => `
    <div class="form-row" style="align-items:end;">
      <div class="form-group"><label>${esc(leg.strike)} ${esc(leg.type)} Entry Price (₹)</label><input class="form-control" id="pnlEditEntry${index}" type="number" min="0.01" step="any" value="${Number(leg.entry) || 0}"></div>
      <div class="form-group"><label>${esc(leg.strike)} ${esc(leg.type)} Lots</label><input class="form-control" id="pnlEditLots${index}" type="number" min="1" step="1" value="${Number(leg.lots) || 1}"></div>
    </div>
  `).join('');
  document.getElementById('pnlEditModal').classList.add('open');
}

function closeEditPnlPosition() {
  document.getElementById('pnlEditModal').classList.remove('open');
  editingPnlPositionId = null;
  editingPnlLegs = [];
}

function saveEditedPnlPosition() {
  const position = pnlPositions.find(item => String(item.id) === String(editingPnlPositionId));
  if (!position) return closeEditPnlPosition();
  const lotSize = Number(position.lot_size || position.units || latestState?.market_lot_sizes?.[position.index]) || 1;
  const edits = editingPnlLegs.map((leg, index) => ({
    ...leg,
    entry: Number(document.getElementById(`pnlEditEntry${index}`).value),
    lots: Number(document.getElementById(`pnlEditLots${index}`).value)
  }));
  if (edits.some(leg => !(leg.entry > 0) || !Number.isInteger(leg.lots) || leg.lots < 1)) {
    document.getElementById('pnlEditError').textContent = 'Enter a positive entry price and a whole number of lots for every leg.';
    return;
  }
  edits.forEach(leg => {
    if (position.legs?.length) {
      leg.target.entryPrice = leg.entry;
      leg.target.lots = leg.lots;
      leg.target.invested = leg.entry * leg.lots * lotSize;
    } else if (leg.type === 'CE') {
      position.callEntry = leg.entry;
      position.callLots = leg.lots;
    } else {
      position.putEntry = leg.entry;
      position.putLots = leg.lots;
    }
  });
  localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
  closeEditPnlPosition();
  renderPnl();
  showToast('Position entry and lot sizes updated.', 'success');
}

function removePnlPosition(id) {
  pnlPositions = pnlPositions.filter(x => x.id !== id);
  localStorage.setItem('tradex.pnlPositions', JSON.stringify(pnlPositions));
  renderPnl();
  showToast('Position removed.', 'info');
}

// ==========================================================================
// Automation & Google Sheets Hub
// ==========================================================================
async function toggleScraping() {
  const btn = document.getElementById('scrapeBtn');
  if (btn) btn.disabled = true;

  try {
    const s = await api('/api/scraping', { enabled: !scrapingOn });
    scrapingOn = s.enabled;
    showToast(scrapingOn ? 'Webscraping engine started!' : 'Webscraping engine stopped.', scrapingOn ? 'success' : 'info');
    await poll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function triggerScanAllCharts() {
  const btn = document.getElementById('scanChartsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scanning charts…';
  }
  try {
    await api('/api/scan_all_charts', {});
    showToast('Full strike chart sweep started in background!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Sweep All Strike Charts';
    }
  }
}

function renderSheetsProgress(s) {
  const label = document.getElementById('sheetsProgressText');
  const count = document.getElementById('sheetsProgressCount');
  const bar = document.getElementById('sheetsProgressBar');
  if (!label || !bar) return;

  let pct = 0;
  if (s.sheets_error) {
    label.textContent = `Sync Error: ${s.sheets_error}`;
    if (count) count.textContent = '';
    bar.classList.remove('busy');
  } else if (s.sheets_write_started) {
    label.textContent = 'Pushing batch snapshot to Google Sheets now…';
    if (count) count.textContent = 'Writing…';
    pct = 100;
    bar.classList.add('busy');
  } else if (s.sheets_pending && s.sheets_next_write_at) {
    const remaining = Math.max(0, Math.ceil(s.sheets_next_write_at - Date.now() / 1000));
    const duration = Math.max(1, s.sheets_wait_seconds || 3);
    const elapsed = Math.max(0, duration - remaining);
    pct = Math.min(100, Math.round((elapsed / duration) * 100));
    label.textContent = remaining <= 3 ? `Writing to Sheets in ${remaining}s…` : `Next Sheets sync in ${remaining}s`;
    if (count) count.textContent = `${pct}%`;
    bar.classList.toggle('busy', remaining <= 3);
  } else if (s.sheets_last_write) {
    label.textContent = `Synced successfully · ${s.sheets_rows_written} rows written`;
    if (count) count.textContent = 'Ready';
    pct = 100;
    bar.classList.remove('busy');
  } else {
    label.textContent = s.scanning ? 'Collecting latest chart snapshots…' : 'Sheets sync idle';
    if (count) count.textContent = '';
    bar.classList.remove('busy');
  }
  bar.style.width = `${pct}%`;
}

// Configured Indices Manager
function renderIndicesList() {
  refreshIndexChooser();
  const list = document.getElementById('indicesList');
  if (!list) return;

  if (!cfg.indices?.length) {
    list.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">No market sources configured yet.</div>';
    return;
  }

  list.innerHTML = cfg.indices.map((x, i) => `
    <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
      <div>
        <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${esc(x.display_name || x.name)}</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">
          ${esc(x.category || 'equity')} · ${esc(x.url)} · ${x.category === 'commodity' ? `Multiplier: ${latestState?.market_lot_sizes?.[x.name] || x.lot_size}×` : `Lot: ${latestState?.market_lot_sizes?.[x.name] || x.lot_size || (x.name.toUpperCase() === 'SENSEX' ? 20 : 65)}`} · ${x.browser_rendered ? 'Chrome Engine' : 'Static HTML'}
        </div>
      </div>
      <div style="display: flex; gap: 6px;">
        <button class="btn btn-sm" onclick="editIndex(${i})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="removeIndex(${i})">Remove</button>
      </div>
    </div>
  `).join('');
}

function openIndexModal() {
  editingIndex = -1;
  document.getElementById('indexModalTitle').textContent = 'Add Market Source';
  ['idxName', 'idxDisplayName', 'idxUrl', 'idxExpiry', 'idxStrikes', 'idxUnderlyingSelector', 'idxRowSelector', 'selExpiry', 'selStrike', 'selCall', 'selPut'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('idxCategory').value = 'equity';
  document.getElementById('idxBrowserRendered').checked = true;
  document.getElementById('indexFormError').textContent = '';
  document.getElementById('indexModal').classList.add('open');
}

function editIndex(i) {
  const x = cfg.indices[i];
  openIndexModal();
  editingIndex = i;
  document.getElementById('indexModalTitle').textContent = `Edit Index: ${x.name}`;
  document.getElementById('idxName').value = x.name || '';
  document.getElementById('idxDisplayName').value = x.display_name || x.name || '';
  document.getElementById('idxCategory').value = x.category || 'equity';
  document.getElementById('idxUrl').value = x.url || '';
  document.getElementById('idxRowSelector').value = x.row_selector || '';
  document.getElementById('idxUnderlyingSelector').value = x.underlying_selector || '';
  document.getElementById('idxExpiry').value = x.selected_expiry || '';
  document.getElementById('idxStrikes').value = (x.strikes || []).join(', ');
  document.getElementById('idxBrowserRendered').checked = !!x.browser_rendered;
  ['expiry', 'strike', 'call', 'put'].forEach(k => {
    const el = document.getElementById('sel' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.value = x.selectors?.[k] || '';
  });
}

function closeIndexModal() {
  document.getElementById('indexModal').classList.remove('open');
}

async function saveIndexForm() {
  const val = id => document.getElementById(id)?.value.trim() || '';
  const x = {
    name: val('idxName'),
    category: document.getElementById('idxCategory').value,
    display_name: val('idxDisplayName') || val('idxName'),
    url: val('idxUrl'),
    underlying_selector: val('idxUnderlyingSelector'),
    selected_expiry: val('idxExpiry'),
    strikes: val('idxStrikes').split(',').map(s => s.trim()).filter(Boolean),
    browser_rendered: document.getElementById('idxBrowserRendered').checked,
    row_selector: val('idxRowSelector'),
    exclude_illiquid: editingIndex >= 0 ? !!cfg.indices[editingIndex].exclude_illiquid : false,
    lot_size: editingIndex >= 0 ? Number(cfg.indices[editingIndex].lot_size) || (val('idxName').toUpperCase() === 'SENSEX' ? 20 : 65) : (val('idxCategory') === 'commodity' ? (val('idxName').toUpperCase() === 'GOLDM' ? 100 : (val('idxName').toUpperCase() === 'SILVERM' ? 5 : 1)) : (val('idxName').toUpperCase() === 'SENSEX' ? 20 : 65)),
    selectors: {
      expiry: val('selExpiry'),
      strike: val('selStrike'),
      call: val('selCall'),
      put: val('selPut')
    }
  };

  try {
    if (!x.name || !x.url) throw new Error('Index Name and URL are required.');
    if (editingIndex < 0) cfg.indices.push(x);
    else cfg.indices[editingIndex] = x;
    await api('/api/config', cfg);
    renderIndicesList();
    closeIndexModal();
    showToast('Index source saved!', 'success');
    poll();
  } catch (err) {
    document.getElementById('indexFormError').textContent = err.message;
  }
}

async function removeIndex(i) {
  if (!confirm(`Are you sure you want to remove ${cfg.indices[i].name}?`)) return;
  cfg.indices.splice(i, 1);
  await api('/api/config', cfg);
  renderIndicesList();
  showToast('Index removed.', 'info');
  poll();
}

// Google Sheets Modal
function openSheetsModal() {
  fillSheetsForm();
  document.getElementById('sheetsModal').classList.add('open');
}

function closeSheetsModal() {
  document.getElementById('sheetsModal').classList.remove('open');
}

function fillSheetsForm() {
  const s = cfg.sheets || {};
  const en = document.getElementById('sheetsEnabled');
  if (en) en.checked = !!s.enabled;
  const idEl = document.getElementById('sheetId');
  if (idEl) idEl.value = s.spreadsheet_id || '';
  const wsEl = document.getElementById('sheetWorksheet');
  if (wsEl) wsEl.value = s.worksheet || 'Options';
  const credEl = document.getElementById('sheetCredentials');
  if (credEl) credEl.value = s.credentials_file || '';
}

async function saveSheetsForm() {
  cfg.sheets = {
    enabled: document.getElementById('sheetsEnabled').checked,
    spreadsheet_id: document.getElementById('sheetId').value.trim(),
    worksheet: document.getElementById('sheetWorksheet').value.trim(),
    credentials_file: document.getElementById('sheetCredentials').value.trim()
  };
  try {
    await api('/api/config', cfg);
    closeSheetsModal();
    showToast('Google Sheets settings saved!', 'success');
  } catch (err) {
    alert(err.message);
  }
}

// ==========================================================================
// Activity Logs
// ==========================================================================
function filterLogs(level) {
  currentLogLevel = level;
  document.querySelectorAll('.log-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === level);
  });
  renderLogs();
}

function renderLogs() {
  const list = document.getElementById('activityLogList');
  if (!list) return;

  const logs = latestState?.logs || [];
  let filtered = logs;
  if (currentLogLevel !== 'all') {
    filtered = logs.filter(l => l.level === currentLogLevel);
  }

  if (!filtered.length) {
    list.innerHTML = '<div style="color: var(--text-dim); padding: 14px; text-align: center;">No activity logs recorded yet.</div>';
    return;
  }

  list.innerHTML = filtered.map(l => {
    const timeStr = new Date(l.time).toLocaleTimeString();
    return `
      <div class="log-entry">
        <span class="log-time">${esc(timeStr)}</span>
        <span class="log-badge ${esc(l.level)}">${esc(l.level)}</span>
        <span class="log-msg">${esc(l.message)}</span>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// Master Polling Loop
// ==========================================================================
let lastSnapshotSaveTime = 0;

async function getFrontendState() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch('http://127.0.0.1:8767/api/state', { signal: controller.signal });
    if (!response.ok) throw new Error('Scraper app is unavailable');
    scraperAppConnected = true;
    return await response.json();
  } catch (_) {
    scraperAppConnected = false;
    return await api('/api/state');
  } finally {
    clearTimeout(timeout);
  }
}

async function poll() {
  if (pollBusy) return;
  pollBusy = true;

  try {
    const s = await getFrontendState();

    // Persistence & Fallback: Throttle localStorage saving to once every 5 seconds to eliminate synchronous storage jank
    const now = Date.now();
    if (s.rows && s.rows.length) {
      if (now - lastSnapshotSaveTime > 5000) {
        lastSnapshotSaveTime = now;
        localStorage.setItem('tradex.lastSnapshotData', JSON.stringify({
          rows: s.rows,
          underlying_prices: s.underlying_prices,
          last_update: s.last_update
        }));
      }
    } else {
      // If live rows are empty, check localStorage backup
      const backup = localStorage.getItem('tradex.lastSnapshotData');
      if (backup) {
        try {
          const parsed = JSON.parse(backup);
          if (parsed.rows?.length) {
            s.rows = parsed.rows;
            s.is_cached = true;
            if (!s.underlying_prices || !Object.keys(s.underlying_prices).length) {
              s.underlying_prices = parsed.underlying_prices || {};
            }
            if (!s.last_update) s.last_update = parsed.last_update;
          }
        } catch (_) {}
      }
    }

    latestState = s;
    window.latestState = s;

    // Update Scraping Button & Indicator
    scrapingOn = !!s.enabled;
    const scrapeBtn = document.getElementById('scrapeBtn');
    if (scrapeBtn) {
      scrapeBtn.textContent = scraperAppConnected
        ? (scrapingOn ? 'App Scraping · ON' : 'App Scraping · OFF')
        : (scrapingOn ? 'App Offline · Local Scraping ON' : 'App Offline · Local Scraping OFF');
      scrapeBtn.className = `backend-scrape-toggle ${scrapingOn ? 'is-on' : 'is-off'}`;
      scrapeBtn.setAttribute('aria-pressed', String(scrapingOn));
    }

    const dot = document.getElementById('headerStatusDot');
    const statusText = document.getElementById('headerStatusText');
    if (dot && statusText) {
      if (!scrapingOn) {
        dot.className = 'status-dot';
        statusText.textContent = 'Idle';
      } else if (s.scanning) {
        dot.className = 'status-dot active';
        statusText.textContent = s.scan_stage || 'Scraping live…';
      } else if (s.scan_stage?.startsWith('Waiting')) {
        dot.className = 'status-dot warning';
        statusText.textContent = 'Market Hours Pause';
      } else {
        dot.className = 'status-dot active';
        statusText.textContent = 'Live Streaming';
      }
    }

    // Top Bar Counts
    const contractCount = document.getElementById('topContractCount');
    if (contractCount) contractCount.textContent = `${s.rows?.length || 0} contracts (ATM ±10)`;

    const lastSyncEl = document.getElementById('topLastSync');
    if (lastSyncEl) {
      const dt = s.last_update ? new Date(s.last_update) : null;
      lastSyncEl.textContent = dt && !isNaN(dt.getTime()) ? dt.toLocaleTimeString() : (s.last_update || '—');
    }

    renderPairs();
    renderOptionsChain();
    renderPnlFromPoll();
    renderSheetsProgress(s);
    renderLogs();

    const bannerStatus = document.getElementById('scraperBannerStatus');
    if (bannerStatus) {
      bannerStatus.textContent = !s.enabled ? 'Scraper is currently paused.' : (s.scan_stage || 'Engine running');
    }
  } catch (err) {
    const dot = document.getElementById('headerStatusDot');
    const statusText = document.getElementById('headerStatusText');
    if (dot) dot.className = 'status-dot error';
    if (statusText) statusText.textContent = 'Offline';
  } finally {
    pollBusy = false;
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
