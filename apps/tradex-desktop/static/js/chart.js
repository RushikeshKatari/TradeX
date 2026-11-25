/** Persistent, multi-timeframe price-action chart for the TradeX analyzer tab. */
(() => {
  const state = {
    data: null, symbol: 'XAUUSDT', timeframe: '15m', loading: false,
    viewEnd: null, visibleBars: 100, dragX: null, dragEnd: null,
    width: 0, height: 0, dpr: 1, plot: null, priceMin: 0, priceMax: 1,
    hover: null, timer: null, liveQuoteTimer: null, liveQuoteLoading: false,
    livePrice: null, livePriceSamples: [], intelligence: null, initialized: false
  };
  const canvas = () => document.getElementById('taCanvas');
  const layers = Object.fromEntries(['support','resistance','trendlines','fvg','supply','demand','structure','historical','mtf','options'].map(k => [k, k !== 'options']));
  const number = value => Number(value || 0);
  const money = value => Number(value).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const timeframeMs = tf => ({'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[tf] || 900000);

  async function loadTechnicalMarket(force = false) {
    const symbolControl = document.getElementById('taSymbol');
    const timeframeControl = document.getElementById('taTimeframe');
    if (!canvas() || state.loading) return;
    const nextSymbol = symbolControl?.value || state.symbol;
    const nextTimeframe = timeframeControl?.value || state.timeframe;
    const changed = nextSymbol !== state.symbol || nextTimeframe !== state.timeframe;
    const symbolChanged = nextSymbol !== state.symbol;
    state.symbol = nextSymbol;
    state.timeframe = nextTimeframe;
    if (symbolChanged) { state.livePriceSamples = []; state.livePrice = null; }
    if (changed) state.viewEnd = null;
    state.loading = true;
    const refresh = document.getElementById('taRefresh');
    const notice = document.getElementById('taNotice');
    if (refresh) { refresh.disabled = true; refresh.textContent = 'Analyzing…'; }
    try {
      const mode = document.getElementById('taAnalysisMode')?.value || 'complete';
      const q = new URLSearchParams({symbol: state.symbol, timeframe: state.timeframe, mode, _: force ? String(Date.now()) : ''});
      const query = q.toString();
      let response;
      try {
        response = await fetch(`http://127.0.0.1:8767/api/ta/market?${query}`);
      } catch (_) {
        response = await fetch(`/api/ta/market?${query}`);
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Market analysis failed');
      const wasFollowing = !state.data || state.viewEnd === null || state.viewEnd >= state.data.candles.length;
      state.data = result;
      state.intelligence = result.intelligence || {};
      if (state.livePrice === null || symbolChanged) state.livePrice = Number(result.current_price) || null;
      if (wasFollowing || changed) state.viewEnd = result.candles.length;
      if (notice) {
        notice.hidden = !result.warning;
        notice.textContent = result.warning || '';
      }
      renderSummary(result);
      renderLevelList(result.levels || []);
      renderEvents(result.market_structure || {});
      renderTimeframeReadiness(result.timeframes_ready || []);
      renderIntelligence(result.intelligence || {});
      draw();
    } catch (error) {
      if (notice) { notice.hidden = false; notice.textContent = error.message; }
      const trend = document.getElementById('taTrend');
      if (trend) trend.textContent = 'Feed unavailable';
    } finally {
      state.loading = false;
      if (refresh) { refresh.disabled = false; refresh.textContent = '↻ Refresh analysis'; }
    }
  }
  window.loadTechnicalMarket = loadTechnicalMarket;

  function renderSummary(data) {
    const set = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    set('taPrice', `${data.symbol === 'BTCUSDT' || data.symbol === 'ETHUSDT' ? '$' : '$'}${money(data.current_price)}`);
    const trend = data.market_structure?.trend || 'neutral';
    const daily = data.timeframe_biases?.['1d'];
    const fourHour = data.timeframe_biases?.['4h'];
    const higher = daily || fourHour;
    set('taTrend', higher && higher !== trend ? `${trend.toUpperCase()} · HTF ${higher.toUpperCase()}` : trend.toUpperCase());
    set('taCurrentTimeframe', data.timeframe);
    set('taUpdated', new Date(data.updated_at).toLocaleTimeString());
  }

  function renderLevelList(levels) {
    const host = document.getElementById('taLevels');
    if (!host) return;
    if (!levels.length) { host.innerHTML = '<div class="ta-empty">No historical levels detected yet. More closed candles will build the level memory.</div>'; return; }
    host.innerHTML = levels.map(level => {
      const support = level.kind === 'support';
      const dist = state.data?.current_price ? (100 * level.distance / state.data.current_price).toFixed(2) : '—';
      const origin = (level.confluence_timeframes || [level.timeframe]).join(' + ');
      return `<div class="ta-level-row"><div class="ta-level-name ${support ? 'ta-support' : 'ta-resistance'}">${support ? 'SUPPORT' : 'RESISTANCE'} · $${money(level.price)}</div><div class="ta-level-score">${Math.round(level.strength)}/100</div><div class="ta-level-meta">${escapeHtml(origin)} · ${level.touches} touches · ${level.successful_rejections} rejections · ${escapeHtml(level.status)} · ${dist}% away · since ${new Date(level.first_detected).toLocaleDateString()}</div></div>`;
    }).join('');
  }

  function renderEvents(market) {
    const summary = document.getElementById('taStructureSummary');
    const host = document.getElementById('taEvents');
    if (summary) summary.innerHTML = `<strong>${escapeHtml((market.trend || 'neutral').toUpperCase())}</strong> market structure · confirmed ${state.timeframe} candles`;
    const validation=document.getElementById('taHistoricalStats');
    const evaluation=state.data?.historical_evaluation||{};
    if(validation) validation.innerHTML=evaluation.tests
      ? `<strong>Historical reaction sample:</strong> ${evaluation.successful_reactions}/${evaluation.tests} confirmed reactions (${evaluation.success_rate}%); average favorable move $${money(evaluation.average_rejection)}.`
      : '<strong>Historical reaction sample:</strong> collecting confirmed level retests; no scored samples yet.';
    if (!host) return;
    const events = (market.events || []).slice(-12).reverse();
    host.innerHTML = events.length ? events.map(e => `<div class="ta-event"><span><strong>${escapeHtml(e.label)}</strong> · $${money(e.price)}</span><time>${new Date(e.time).toLocaleString()}</time></div>`).join('') : '<div class="ta-empty">Waiting for confirmed swing structure.</div>';
  }

  function renderTimeframeReadiness(ready) {
    const host=document.getElementById('taTimeframeConfluence');if(!host)return;
    const all=['1m','5m','15m','1h','4h','1d'];
    host.innerHTML=`Timeframe memory: ${all.map(tf=>`<span class="ta-timeframe-chip ${ready.includes(tf)?'ready':''}">${tf} ${ready.includes(tf)?'✓':'…'}</span>`).join('')}`;
  }

  function renderIntelligence(intelligence) {
    const commentary=intelligence.commentary||{};
    const title=document.getElementById('taCommentaryTitle');
    const body=document.getElementById('taCommentaryText');
    const badge=document.getElementById('taEventBadge');
    const meta=document.getElementById('taCommentaryMeta');
    const disclaimer=document.getElementById('taAnalysisDisclaimer');
    if(title)title.textContent=commentary.title||'No clear direction';
    if(body)body.textContent=commentary.commentary||'Waiting for confirmed market data.';
    if(badge)badge.textContent=commentary.event_type?.replaceAll('_',' ').toUpperCase()||'ANALYZING';
    if(meta)meta.textContent=`${state.symbol} · ${state.timeframe} · price $${money(intelligence.commentary?.price||state.data?.current_price||0)} · ${commentary.timestamp?new Date(commentary.timestamp).toLocaleTimeString():''}`;
    if(disclaimer)disclaimer.textContent=intelligence.disclaimer||'Conditional analysis. Evidence scores are not probabilities.';
    renderDirectionMeters(intelligence);
    const history=intelligence.historical_context||state.data?.historical_context||{};
    const historyHost=document.getElementById('taLongHistoryContext');
    if(historyHost){
      const coverage=Number(history.coverage_years||0);
      const bias=String(history.trend_bias||'unavailable').toUpperCase();
      historyHost.textContent=history.candle_count
        ? `Long-term context: ${coverage.toFixed(1)} years of daily ${state.symbol} data available (10 years requested) · ${bias} daily bias · range $${money(history.ten_year_low)}–$${money(history.ten_year_high)} · ${history.start_date||'—'} to ${history.end_date||'—'}${history.backfill_in_progress?' · downloading older candles':history.coverage_complete?'':' · the contract has less than ten years of available history'}`
        : 'Long-term context is being downloaded. The meter currently uses live structure and timeframe evidence.';
    }
    const levelPanels=document.getElementById('taLevelPanels');
    const support=intelligence.support,resistance=intelligence.resistance;
    if(levelPanels)levelPanels.innerHTML=[['SUPPORT',support,'ta-support','below'],['RESISTANCE',resistance,'ta-resistance','above']].map(([label,level,className,side])=>{
      if(!level)return `<article class="ta-level-panel ${className}"><span>${label}</span><strong>No stored level nearby</strong><small>Waiting for confirmed historical reactions.</small></article>`;
      const confirm=side==='below'?level.zone_low:level.zone_high;
      return `<article class="ta-level-panel ${className}"><span>NEAREST ${label}</span><strong>$${money(level.price)} · ${Math.round(level.strength)}/100</strong><small>${escapeHtml(level.confluence_timeframes?.join(' + ')||level.timeframe)} · ${level.touches} touches · ${((level.distance/(state.data?.current_price||1))*100).toFixed(2)}% away</small><small>${side==='below'?'Break':'Breakout'} condition: confirmed close ${side} $${money(confirm)}</small></article>`;
    }).join('');
    const cards=document.getElementById('taScenarioCards');
    if(cards)cards.innerHTML=(intelligence.scenarios||[]).map(s=>{
      const direction=s.direction;
      const targets=(s.targets||[]).map(t=>`<div class="ta-target-row"><strong>T${t.rank} · $${money(t.price)}</strong><span>${escapeHtml(t.method)} · ${money(t.distance)} away</span></div>`).join('')||'<div class="ta-empty">No structural target available.</div>';
      const evidence=(s.evidence||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
      return `<article class="ta-scenario-card ${direction}"><div class="ta-scenario-head"><strong>${direction.toUpperCase()} SCENARIO</strong><span>${s.confirmed?'CONFIRMED CLOSE':'CONDITIONAL'}</span></div><p>A confirmed ${state.timeframe} close ${direction==='bearish'?'below':'above'} <strong>$${money(s.confirmation_level)}</strong> (${escapeHtml(s.trigger_source)}) is required before treating this setup as active.</p><div class="ta-target-list">${targets}</div><div class="ta-invalidation">Invalidation: confirmed close ${direction==='bearish'?'above':'below'} $${money(s.invalidation)}.</div><details><summary>Evidence · ${s.evidence_score}/100 (${escapeHtml(s.evidence_grade)}; not a probability)</summary><ul>${evidence}</ul></details></article>`;
    }).join('')||'<div class="ta-empty">No scenario is available in the selected analysis mode.</div>';
    const feed=document.getElementById('taCommentaryFeed');
    if(feed){
      const events=(intelligence.commentary_events||[]).map(event=>({time:event.occurred_at,html:`<article class="ta-feed-event"><div><strong>${escapeHtml(event.title)}</strong><time>${new Date(event.occurred_at).toLocaleString()} · ${escapeHtml(event.timeframe)}</time></div><p>${escapeHtml(event.commentary)}</p></article>`}));
      const predictions=(intelligence.predictions||[]).map(item=>({time:item.created_at,html:`<article class="ta-feed-prediction ${escapeHtml(item.direction)}"><div><strong>${item.direction.toUpperCase()} SETUP · ${escapeHtml(item.outcome)}</strong><time>${new Date(item.created_at).toLocaleString()} · ${escapeHtml(item.timeframe)}</time></div><p>Confirmation $${money(item.confirmation_level)} · invalidation $${money(item.invalidation)} · first target $${money(item.targets?.[0]?.price||0)}${item.outcome_price?` · resolved at $${money(item.outcome_price)}`:''}</p></article>`}));
      feed.innerHTML=[...events,...predictions].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).slice(0,16).map(x=>x.html).join('')||'<div class="ta-empty">Waiting for the first market event or saved scenario.</div>';
    }
  }

  function renderDirectionMeters(intelligence=state.intelligence||{}) {
    const directions=intelligence.all_scenarios||intelligence.scenarios||[];
    const host=document.getElementById('taDirectionMeters');if(!host)return;
    const price=Number(state.livePrice||state.data?.current_price||0);
    const atr=Math.max(Number(state.data?.atr)||0,price*.001,1e-9);
    const samples=state.livePriceSamples;
    const move=samples.length>1?samples[samples.length-1].price-samples[0].price:0;
    const momentum=Math.max(-12,Math.min(12,(move/atr)*20));
    ['bullish','bearish'].forEach(direction=>{
      const scenario=directions.find(item=>item.direction===direction);
      if(!scenario)return;
      const confirmation=Number(scenario.confirmation_level)||price;
      const invalidation=Number(scenario.invalidation)||price;
      const gap=direction==='bullish'?confirmation-price:price-confirmation;
      const approach=Math.max(0,1-Math.max(0,gap)/(atr*2));
      const signedMomentum=direction==='bullish'?momentum:-momentum;
      const beyondConfirmation=(direction==='bullish'?price>=confirmation:price<=confirmation)?8:0;
      const throughInvalidation=(direction==='bullish'?price<=invalidation:price>=invalidation)?-12:0;
      const score=Math.max(0,Math.min(100,Math.round(Number(scenario.evidence_score||0)+signedMomentum+approach*8+beyondConfirmation+throughInvalidation)));
      let card=host.querySelector(`[data-direction="${direction}"]`);
      if(!card){
        const color=direction==='bullish'?'#4ade80':'#fb7185';
        host.insertAdjacentHTML('beforeend',`<article class="ta-speedometer ${direction}" data-direction="${direction}"><div class="ta-speedometer-title">${direction.toUpperCase()} PRESSURE</div><svg viewBox="0 0 120 78" role="img"><path d="M12 62 A48 48 0 0 1 108 62" class="ta-gauge-track"/><path d="M12 62 A48 48 0 0 1 108 62" class="ta-gauge-value"/><line x1="60" y1="62" x2="60" y2="24" stroke="${color}" class="ta-gauge-needle"/><circle cx="60" cy="62" r="4" fill="${color}"/><text x="60" y="55" class="ta-gauge-score">0</text><text x="60" y="75" class="ta-gauge-caption">LIVE PRESSURE / 100</text></svg><div class="ta-speedometer-grade"></div></article>`);
        card=host.querySelector(`[data-direction="${direction}"]`);
      }
      const angle=Math.PI+(score/100)*Math.PI;
      const needle=card.querySelector('.ta-gauge-needle');
      const arc=card.querySelector('.ta-gauge-value');
      const value=card.querySelector('.ta-gauge-score');
      const grade=card.querySelector('.ta-speedometer-grade');
      const x=60+38*Math.cos(angle),y=62+38*Math.sin(angle);
      needle?.setAttribute('x2',x.toFixed(1));needle?.setAttribute('y2',y.toFixed(1));
      arc?.setAttribute('stroke-dasharray',`${(score/100*150.8).toFixed(1)} 150.8`);
      value?.setAttribute('stroke',direction==='bullish'?'#4ade80':'#fb7185');
      if(value)value.textContent=String(score);
      if(grade)grade.textContent=`${scenario.evidence_grade||'Evidence'} · live ${price?'$'+money(price):'price waiting'} · ${scenario.confirmed?'close confirmed':'conditional'}`;
      card.setAttribute('aria-label',`${direction} live directional pressure ${score} out of 100`);
    });
  }

  async function refreshLiveQuote() {
    if(state.liveQuoteLoading||!state.symbol)return;
    state.liveQuoteLoading=true;
    try {
      let response;
      try { response=await fetch(`http://127.0.0.1:8767/api/ta/price?symbol=${encodeURIComponent(state.symbol)}`,{cache:'no-store'}); }
      catch(_) { response=await fetch(`/api/ta/price?symbol=${encodeURIComponent(state.symbol)}`,{cache:'no-store'}); }
      if(!response.ok)return;
      const quote=await response.json(),price=Number(quote.price);
      if(!(price>0)||quote.symbol!==state.symbol)return;
      state.livePrice=price;
      if(state.data)state.data.current_price=price;
      const now=Date.now();
      state.livePriceSamples.push({time:now,price});
      state.livePriceSamples=state.livePriceSamples.filter(point=>now-point.time<=30000).slice(-16);
      const priceNode=document.getElementById('taPrice');
      if(priceNode)priceNode.textContent=`$${money(price)}`;
      renderDirectionMeters();
    } catch(_) {}
    finally { state.liveQuoteLoading=false; }
  }

  function draw() {
    const c = canvas();
    const data = state.data;
    if (!c || !data || !data.candles?.length) return;
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    state.dpr = Math.max(1, window.devicePixelRatio || 1);
    state.width = rect.width; state.height = rect.height;
    c.width = Math.round(rect.width * state.dpr); c.height = Math.round(rect.height * state.dpr);
    const ctx = c.getContext('2d'); ctx.setTransform(state.dpr,0,0,state.dpr,0,0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0,0,w,h); ctx.fillStyle = '#080e19'; ctx.fillRect(0,0,w,h);
    const plot = state.plot = {left:72, right:w-82, top:20, bottom:h-78};
    const candles = data.candles;
    const span = Math.max(24, Math.min(state.visibleBars, 600));
    state.visibleBars = span;
    const end = Math.max(1, Math.min(candles.length, state.viewEnd ?? candles.length));
    const start = Math.max(0, end - span);
    const visible = candles.slice(start, end);
    if (!visible.length) return;
    const selectedStructures = data.structures || [];
    const levelLines = data.levels || [];
    let min = Math.min(...visible.map(c => c.low));
    let max = Math.max(...visible.map(c => c.high));
    const margin = Math.max((max-min)*0.09, data.atr || max*0.002);
    min -= margin; max += margin;
    state.priceMin=min; state.priceMax=max;
    const priceY = p => plot.bottom - (p-min)/(max-min)*(plot.bottom-plot.top);
    const step = (plot.right-plot.left)/Math.max(1, span);
    const timeX = t => {
      const idx = lowerBound(candles, t);
      return plot.left + (idx - start + .5) * step;
    };
    ctx.font='10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline='middle';
    for (let i=0;i<=5;i++) {
      const y=plot.top+(plot.bottom-plot.top)*i/5;
      const price=max-(max-min)*i/5;
      ctx.strokeStyle='rgba(100,116,139,.19)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(plot.left,y);ctx.lineTo(plot.right,y);ctx.stroke();
      ctx.fillStyle='#94a3b8';ctx.textAlign='right';ctx.fillText(money(price),w-8,y);
    }
    const timeLabelStride=Math.max(1,Math.floor(visible.length/6));
    visible.forEach((candle,i)=>{
      if(i%timeLabelStride!==0 && i!==visible.length-1) return;
      const x=plot.left+(i+(start===0?0:0)+.5)*step;
      const d=new Date(candle.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      ctx.fillStyle='#64748b';ctx.textAlign='center';ctx.fillText(d,x,h-13);
    });

    // FVGs and supply/demand regions sit behind candles and extend right.
    for (const item of selectedStructures) {
      if (item.type==='fvg' && layers.fvg) {
        const x1=Math.max(plot.left,timeX(item.start_time)); const x2=plot.right;
        const y1=priceY(item.upper),y2=priceY(item.lower);
        if (x2>=plot.left && y2>=plot.top && y1<=plot.bottom) {
          const bull=item.direction==='bullish';ctx.fillStyle=bull?'rgba(34,197,94,.12)':'rgba(244,63,94,.12)';ctx.fillRect(x1,Math.max(plot.top,y1),Math.max(3,x2-x1),Math.min(plot.bottom,y2)-Math.max(plot.top,y1));
          ctx.strokeStyle=bull?'rgba(74,222,128,.38)':'rgba(251,113,133,.38)';ctx.setLineDash([4,4]);ctx.strokeRect(x1,Math.max(plot.top,y1),Math.max(3,x2-x1),Math.min(plot.bottom,y2)-Math.max(plot.top,y1));ctx.setLineDash([]);
          if (item.status==='FRESH / UNTOUCHED') {ctx.fillStyle=bull?'#86efac':'#fda4af';ctx.textAlign='left';ctx.fillText(`${bull?'Bull':'Bear'} FVG ${item.score}`,x1+4,Math.max(plot.top,y1)+10);}
        }
      } else if (item.type==='zone' && (item.direction==='supply'?layers.supply:layers.demand)) {
        const x1=Math.max(plot.left,timeX(item.start_time)),y1=priceY(item.upper),y2=priceY(item.lower);
        if(y2>=plot.top&&y1<=plot.bottom){const demand=item.direction==='demand';ctx.fillStyle=demand?'rgba(34,197,94,.09)':'rgba(244,63,94,.09)';ctx.fillRect(x1,Math.max(plot.top,y1),plot.right-x1,Math.min(plot.bottom,y2)-Math.max(plot.top,y1));ctx.strokeStyle=demand?'rgba(74,222,128,.3)':'rgba(251,113,133,.3)';ctx.strokeRect(x1,Math.max(plot.top,y1),plot.right-x1,Math.min(plot.bottom,y2)-Math.max(plot.top,y1));}
      } else if (item.type==='channel' && layers.trendlines) {
        const x1=Math.max(plot.left,timeX(item.start_time)),x2=plot.right;
        const ya1=priceY(item.upper_start),ya2=priceY(item.upper_end),yb1=priceY(item.lower_start),yb2=priceY(item.lower_end);
        ctx.fillStyle=item.direction==='bullish'?'rgba(34,197,94,.035)':'rgba(244,63,94,.035)';
        ctx.beginPath();ctx.moveTo(x1,ya1);ctx.lineTo(x2,ya2);ctx.lineTo(x2,yb2);ctx.lineTo(x1,yb1);ctx.closePath();ctx.fill();
      }
    }

    // An unfinished third candle can form a provisional gap; keep it dashed
    // until the candle closes and the backend confirms it.
    const confirmedBars=candles.filter(c=>c.closed), forming=data.forming_candle;
    if(layers.fvg&&forming&&confirmedBars.length>=2){
      const first=confirmedBars[confirmedBars.length-2],third=forming;
      const gap=third.low>first.high?{lower:first.high,upper:third.low,direction:'bullish'}:third.high<first.low?{lower:third.high,upper:first.low,direction:'bearish'}:null;
      if(gap){const y1=priceY(gap.upper),y2=priceY(gap.lower),x1=Math.max(plot.left,timeX(first.time)),top=Math.max(plot.top,y1),bottom=Math.min(plot.bottom,y2);if(bottom>top){ctx.fillStyle=gap.direction==='bullish'?'rgba(34,197,94,.07)':'rgba(244,63,94,.07)';ctx.fillRect(x1,top,plot.right-x1,bottom-top);ctx.strokeStyle=gap.direction==='bullish'?'#4ade80':'#fb7185';ctx.setLineDash([2,4]);ctx.strokeRect(x1,top,plot.right-x1,bottom-top);ctx.setLineDash([]);ctx.fillStyle=gap.direction==='bullish'?'#86efac':'#fda4af';ctx.textAlign='left';ctx.fillText(`PROVISIONAL ${gap.direction.toUpperCase()} FVG`,x1+4,top+10);}}
    }

    // Price candles. Forming bar is muted and never contributes a confirmed swing.
    visible.forEach((candle,i)=>{
      const x=plot.left+(i+.5)*step;const up=candle.close>=candle.open;const color=up?'#34d399':'#fb7185';
      ctx.strokeStyle=color;ctx.fillStyle=candle.closed?color:(up?'rgba(52,211,153,.45)':'rgba(251,113,133,.45)');ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,priceY(candle.high));ctx.lineTo(x,priceY(candle.low));ctx.stroke();
      const y1=priceY(Math.max(candle.open,candle.close)),y2=priceY(Math.min(candle.open,candle.close));
      ctx.fillRect(x-Math.max(1,step*.31),y1,Math.max(2,step*.62),Math.max(1,y2-y1));
    });
    const volumeTop=h-58, volumeBase=h-30, maxVolume=Math.max(1,...visible.map(c=>c.volume));
    visible.forEach((candle,i)=>{const x=plot.left+(i+.5)*step,barH=(candle.volume/maxVolume)*(volumeBase-volumeTop);ctx.fillStyle=candle.close>=candle.open?'rgba(52,211,153,.42)':'rgba(251,113,133,.42)';ctx.fillRect(x-Math.max(1,step*.31),volumeBase-barH,Math.max(2,step*.62),barH);});
    ctx.fillStyle='#64748b';ctx.textAlign='left';ctx.fillText('VOLUME',plot.left+3,volumeTop-7);

    // Persistent S/R memory lines, including flipped and historical levels.
    for (const level of levelLines) {
      const historical=['HISTORICAL','BROKEN','FLIPPED'].includes(level.status);
      const isSupport=level.kind==='support';
      const otherFrames=(level.confluence_timeframes||[level.timeframe]).filter(tf=>tf!==data.timeframe);
      if ((isSupport&&!layers.support)||(!isSupport&&!layers.resistance)||(historical&&!layers.historical)||(layers.mtf===false&&otherFrames.length)) continue;
      const y=priceY(level.price);if(y<plot.top||y>plot.bottom) continue;
      ctx.strokeStyle=historical?'rgba(148,163,184,.5)':isSupport?'rgba(74,222,128,.82)':'rgba(251,113,133,.82)';ctx.lineWidth=level.strength>=75?1.7:1;ctx.setLineDash(historical||otherFrames.length?[5,4]:[]);ctx.beginPath();ctx.moveTo(plot.left,y);ctx.lineTo(plot.right,y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=historical?'#94a3b8':isSupport?'#86efac':'#fda4af';ctx.textAlign='left';ctx.fillText(`${isSupport?'S':'R'} ${money(level.price)} · ${Math.round(level.strength)}`,plot.right+5,y);
    }

    if(layers.trendlines) for(const line of selectedStructures.filter(x=>x.type==='trendline')){
      const x1=timeX(line.start_time),x2=plot.right,y1=priceY(line.start_price),y2=priceY(line.end_price);
      ctx.strokeStyle=line.direction==='bullish'?'#4ade80':'#fb7185';ctx.lineWidth=1.5;ctx.setLineDash(line.status==='BROKEN'?[6,5]:[]);ctx.beginPath();ctx.moveTo(Math.max(plot.left,x1),y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
    }
    if(layers.trendlines) for(const channel of selectedStructures.filter(x=>x.type==='channel')){
      const x1=Math.max(plot.left,timeX(channel.start_time)),x2=plot.right;
      const color=channel.direction==='bullish'?'#4ade80':'#fb7185';ctx.strokeStyle=color;ctx.lineWidth=1.1;ctx.setLineDash(channel.status==='BROKEN'?[5,5]:[3,4]);
      ctx.beginPath();ctx.moveTo(x1,priceY(channel.upper_start));ctx.lineTo(x2,priceY(channel.upper_end));ctx.moveTo(x1,priceY(channel.lower_start));ctx.lineTo(x2,priceY(channel.lower_end));ctx.stroke();ctx.setLineDash([]);
    }

    // Current price and forming status.
    const last=data.current_price;const ly=priceY(last);
    if(ly>=plot.top&&ly<=plot.bottom){ctx.strokeStyle='#38bdf8';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(plot.left,ly);ctx.lineTo(plot.right,ly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#0ea5e9';ctx.fillRect(plot.right,ly-9,78,18);ctx.fillStyle='white';ctx.textAlign='center';ctx.fillText(money(last),plot.right+39,ly);}
    if(layers.structure){for(const e of data.market_structure?.events||[]){if(!['BOS','CHOCH','HH','HL','LH','LL'].includes(e.label))continue;const x=timeX(e.time),y=priceY(e.price);if(x<plot.left||x>plot.right||y<plot.top||y>plot.bottom)continue;ctx.fillStyle=e.label==='LL'||e.label==='LH'?'#fb7185':e.label==='HH'||e.label==='HL'?'#4ade80':'#fbbf24';ctx.textAlign='center';ctx.font='bold 9px -apple-system, sans-serif';ctx.fillText(e.label,x,y+(e.label==='HH'||e.label==='LH'?-9:12));}}
    state.renderMap={start,end,step,plot,priceY,timeX};
    drawHover(ctx);
  }

  function drawHover(ctx) {
    if (!state.hover || !state.plot) return;
    const {x,y}=state.hover,p=state.plot;
    if(x<p.left||x>p.right||y<p.top||y>p.bottom)return;
    ctx.strokeStyle='rgba(203,213,225,.42)';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,p.top);ctx.lineTo(x,p.bottom);ctx.moveTo(p.left,y);ctx.lineTo(p.right,y);ctx.stroke();ctx.setLineDash([]);
    const price=state.priceMax-(y-p.top)/(p.bottom-p.top)*(state.priceMax-state.priceMin);ctx.fillStyle='#1e293b';ctx.fillRect(p.left,y-9,70,18);ctx.fillStyle='#e2e8f0';ctx.textAlign='left';ctx.fillText(money(price),p.left+4,y);
  }

  function lowerBound(candles,time) {
    let lo=0,hi=candles.length;while(lo<hi){const mid=(lo+hi)>>1;if(candles[mid].time<time)lo=mid+1;else hi=mid;}return Math.min(candles.length-1,lo);
  }

  function pointerMove(event) {
    const c=canvas(),rect=c.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    if(state.dragX!==null){const dx=x-state.dragX;const step=Math.max(1,(state.plot.right-state.plot.left)/state.visibleBars);const shift=Math.round(dx/step);state.viewEnd=Math.max(1,Math.min(state.data.candles.length,state.dragEnd-shift));state.dragX=x;state.dragEnd=state.viewEnd;draw();return;}
    state.hover={x,y};draw();showHoverCard(x,y);
  }
  function showHoverCard(x,y) {
    const card=document.getElementById('taHoverCard');if(!card||!state.data||!state.renderMap)return;
    const {start,end,step,plot}=state.renderMap;let html='';
    const priceAtY=state.priceMax-(y-plot.top)/(plot.bottom-plot.top)*(state.priceMax-state.priceMin);
    const level=(state.data.levels||[]).find(l=>Math.abs(priceAtY-l.price)<=Math.max((state.priceMax-state.priceMin)*.009,1));
    const timeAtX=state.data.candles[Math.max(0,Math.min(state.data.candles.length-1,Math.floor(start+(x-plot.left)/step)))]?.time||0;
    const structure=(state.data.structures||[]).find(s=>{
      if(s.type==='fvg'||s.type==='zone') return timeAtX>=s.start_time && priceAtY>=s.lower && priceAtY<=s.upper;
      if(s.type==='channel') {const progress=Math.max(0,Math.min(1,(timeAtX-s.start_time)/Math.max(1,s.end_time-s.start_time)));const low=s.lower_start+(s.lower_end-s.lower_start)*progress,high=s.upper_start+(s.upper_end-s.upper_start)*progress;return priceAtY>=low&&priceAtY<=high;}
      if(s.type==='trendline'){const progress=Math.max(0,Math.min(1,(timeAtX-s.start_time)/Math.max(1,s.end_time-s.start_time)));const line=s.start_price+(s.end_price-s.start_price)*progress;return Math.abs(priceAtY-line)<=Math.max((state.priceMax-state.priceMin)*.006,1);}
      return false;
    });
    if(level) html=`<strong>${level.kind.toUpperCase()} · $${money(level.price)}</strong><br>Strength ${level.strength}/100 · ${escapeHtml((level.confluence_timeframes||[level.timeframe]).join(' + '))}<br>${level.touches} touches · ${level.successful_rejections} successful reactions<br>Status ${escapeHtml(level.status)} · ${((level.distance/state.data.current_price)*100).toFixed(2)}% from price`;
    else if(structure?.type==='fvg') html=`<strong>${structure.direction.toUpperCase()} FVG · ${structure.timeframe}</strong><br>Upper $${money(structure.upper)} · Lower $${money(structure.lower)}<br>${escapeHtml(structure.status)} · ${structure.mitigation}% mitigated · strength ${structure.score}/100<br>Formed ${new Date(structure.formation_time).toLocaleString()}`;
    else if(structure?.type==='zone') html=`<strong>${structure.direction.toUpperCase()} ZONE · ${structure.timeframe}</strong><br>Upper $${money(structure.upper)} · Lower $${money(structure.lower)}<br>${escapeHtml(structure.status)} · strength ${structure.score}/100`;
    else if(structure?.type==='trendline'||structure?.type==='channel') html=`<strong>${structure.type.toUpperCase()} · ${structure.direction.toUpperCase()}</strong><br>${structure.timeframe} · ${structure.touches} touches<br>${escapeHtml(structure.status)} · strength ${structure.score}/100`;
    else {
      const idx=Math.floor(start+(x-plot.left)/step);const c=state.data.candles[Math.max(0,Math.min(state.data.candles.length-1,idx))];
      if(c) html=`<strong>${new Date(c.time).toLocaleString()}</strong><br>O ${money(c.open)} · H ${money(c.high)}<br>L ${money(c.low)} · C ${money(c.close)} · V ${money(c.volume)}<br>${c.closed?'Confirmed candle':'Forming candle'}`;
    }
    if(!html){card.hidden=true;return;}card.innerHTML=html;card.style.left=`${Math.min(x+12,state.width-295)}px`;card.style.top=`${Math.max(6,Math.min(y+10,state.height-100))}px`;card.hidden=false;
  }

  function initTechnicalChart() {
    if(state.initialized)return;state.initialized=true;
    document.getElementById('taSymbol')?.addEventListener('change',()=>loadTechnicalMarket(true));
    document.getElementById('taTimeframe')?.addEventListener('change',()=>loadTechnicalMarket(true));
    document.getElementById('taRefresh')?.addEventListener('click',()=>loadTechnicalMarket(true));
    document.getElementById('taAnalysisMode')?.addEventListener('change',()=>loadTechnicalMarket(true));
    document.getElementById('taResetView')?.addEventListener('click',()=>{if(state.data){state.visibleBars=100;state.viewEnd=state.data.candles.length;draw();}});
    document.querySelectorAll('.ta-toolbar button[data-layer]').forEach(el=>el.addEventListener('click',()=>{if(el.disabled)return;const key=el.dataset.layer;layers[key]=!layers[key];el.classList.toggle('is-on',layers[key]);el.classList.toggle('is-off',!layers[key]);el.setAttribute('aria-pressed',String(layers[key]));draw();}));
    const c=canvas();
    if(c){c.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=c.getBoundingClientRect();state.dragX=e.clientX-r.left;state.dragEnd=state.viewEnd; c.setPointerCapture(e.pointerId);});c.addEventListener('pointermove',pointerMove);c.addEventListener('pointerup',()=>{state.dragX=null;});c.addEventListener('pointercancel',()=>{state.dragX=null;});c.addEventListener('pointerleave',()=>{if(state.dragX===null){state.hover=null;const card=document.getElementById('taHoverCard');if(card)card.hidden=true;draw();}});c.addEventListener('wheel',e=>{e.preventDefault();const old=state.visibleBars;state.visibleBars=Math.max(30,Math.min(500,old+(e.deltaY>0?Math.ceil(old*.12):-Math.ceil(old*.12))));draw();},{passive:false});}
    window.addEventListener('resize',draw);
    if(window.ResizeObserver&&c)new ResizeObserver(draw).observe(c.parentElement);
    state.timer=setInterval(()=>{if(document.getElementById('panel-chart')?.classList.contains('active'))loadTechnicalMarket();},30000);
    state.liveQuoteTimer=setInterval(()=>{if(document.getElementById('panel-chart')?.classList.contains('active'))refreshLiveQuote();},2500);
    if(document.getElementById('panel-chart')?.classList.contains('active'))loadTechnicalMarket();
    if(document.getElementById('panel-chart')?.classList.contains('active'))refreshLiveQuote();
  }
  document.addEventListener('DOMContentLoaded',initTechnicalChart);
})();
