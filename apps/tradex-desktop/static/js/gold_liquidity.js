/* GoldLiquidity: public exchange candles, IST grouping, and client-side analytics. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TZ = 'Asia/Kolkata';
  const TROY_OUNCE_GRAMS = 31.1034768;
  const TF_MS = { '1m':60000, '5m':300000, '15m':900000, '30m':1800000, '1h':3600000, '4h':14400000, '6h':21600000, '12h':43200000, '1d':86400000 };
  const TF_ORDER = Object.keys(TF_MS);
  const state = { source: [], candles: [], daily: [], sessions: {}, exchange: 'bybit', timeframe: '1m', currency: 'USD', rate: 0, indiaAdjustment: 14.1225, multiplier: 0, ticker: null, info: null, activeView: 'overview', sessionFilter: 'All Sessions', csvName: '', loading: false, queuedGenerate: false, liveMode: false, liveLoading: false, workloadEnabled: false, mcxSyncLoading: false };
  const istDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' });
  const istTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
  const fmt = (n, digits=2) => Number(n).toLocaleString(state.currency === 'INR' ? 'en-IN' : 'en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits});
  const displayed = n => Number(n || 0) * (state.currency === 'INR' ? state.multiplier : 1);
  const money = n => `${state.currency === 'INR' ? '₹' : '$'}${fmt(displayed(n))}`;
  const plain = n => fmt(displayed(n));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function istParts(ts) {
    const parts = Object.fromEntries(istDateFmt.formatToParts(new Date(ts)).map(p => [p.type, p.value]));
    return { year:parts.year, month:parts.month, day:parts.day, date:`${parts.year}-${parts.month}-${parts.day}` };
  }
  function istDateLabel(ts) { const p=istParts(ts); return `${p.day}-${p.month}-${p.year}`; }
  function istDateTime(ts) { return `${istDateLabel(ts)} ${istTimeFmt.format(new Date(ts))} IST`; }
  function dateNowIST() { return istParts(Date.now()).date; }
  function shiftDate(iso, days) { const d=new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
  function setStatus(text, kind='info') { const el=$('glStatus'); if(el){ el.textContent=text; el.dataset.kind=kind; } }
  function setCurrency(unit) {
    state.currency=unit;
    localStorage.setItem('tradex.goldLiquidity.currency', unit);
    document.querySelectorAll('[data-gl-currency]').forEach(b=>b.classList.toggle('active',b.dataset.glCurrency===unit));
    renderAll();
  }
  function updateMultiplier() {
    state.rate=Number($('glFxRate')?.value)||0;
    const adjustmentInput=Number($('glIndiaAdjustment')?.value);
    state.indiaAdjustment=Number.isFinite(adjustmentInput)?adjustmentInput:0;
    state.multiplier=state.rate*10/TROY_OUNCE_GRAMS*(1+state.indiaAdjustment/100);
    const el=$('glMultiplier');
    if(el) el.textContent=`INR/10g per $/oz × ${state.multiplier ? state.multiplier.toFixed(6) : '—'}`;
    const unit=$('glUnitBadge');
    if(unit) unit.textContent=state.currency==='INR'?'INR / 10g':'USD / troy oz';
    localStorage.setItem('tradex.goldLiquidity.rate', String(state.rate||''));
    localStorage.setItem('tradex.goldLiquidity.indiaAdjustment', String(state.indiaAdjustment));
  }
  function setLiveMode(enabled) {
    state.liveMode=!!enabled&&state.workloadEnabled&&$('glExchange').value!=='csv';
    localStorage.setItem('tradex.goldLiquidity.liveMode',String(state.liveMode));
    const button=$('glLiveToggle');
    if(button){button.classList.toggle('active',state.liveMode);button.setAttribute('aria-pressed',String(state.liveMode));button.textContent=state.liveMode?'● Live mode · ON':'● Live mode · OFF';}
    $('glHistoryControls')?.classList.toggle('is-hidden',state.liveMode);
    // Timeframe selection remains available in Live mode so users can change
    // the live candle interval without leaving the chart.
    $('glTimeframeControls')?.classList.remove('is-hidden');
    if(enabled&&!state.workloadEnabled){setStatus('Gold Liquidity is paused. Turn it on in Data Workloads before requesting live prices.','warning');return;}
    if(enabled&&!state.liveMode){setStatus('Live Mode needs an exchange source. Select Bybit, OKX, Binance, or Gate.io; uploaded CSV data has no live feed.','warning');return;}
    if(state.liveMode){setStatus('Live Mode is on. Current exchange candles and ticker will refresh while this tab is open.','success');if(!state.candles.length&&!state.loading)generate();else refreshLive();}
    else setStatus('Live Mode is off. The loaded historical analysis remains available.','info');
  }
  async function refreshFx() {
    if(!state.workloadEnabled)return;
    const b=$('glFxRefresh'); if(b) b.disabled=true;
    try {
      const response=await fetch('/api/gold-liquidity/fx',{cache:'no-store'}); const data=await response.json();
      if(!response.ok) throw new Error(data.error||'FX rate unavailable');
      $('glFxRate').value=Number(data.rate).toFixed(4); updateMultiplier();
      renderAll();
      setStatus(`USD/INR auto rate refreshed from ${data.source} · ${data.updated_at||'latest'}. You can edit the rate manually.`, 'success');
    } catch(e) { setStatus(`FX auto-refresh unavailable: ${e.message}. Enter a USD/INR rate manually to use INR mode.`, 'warning'); }
    finally { if(b) b.disabled=false; }
  }
  async function refreshIndiaAdjustment() {
    if(!state.workloadEnabled||state.mcxSyncLoading)return;
    const button=$('glMcxSync'),status=$('glIndiaAdjustmentStatus');
    state.mcxSyncLoading=true;if(button)button.disabled=true;
    if(status)status.textContent='Syncing Groww MCX Gold Mini…';
    try {
      const response=await fetch('/api/gold-liquidity/india-adjustment',{cache:'no-store'});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'MCX adjustment sync failed');
      const adjustment=Number(data.adjustment_percent),rate=Number(data.fx?.rate);
      if(!Number.isFinite(adjustment)||!Number.isFinite(rate)||rate<=0)throw new Error('Groww, XAUUSD, or USD/INR returned an invalid quote');
      $('glIndiaAdjustment').value=adjustment.toFixed(4);$('glFxRate').value=rate.toFixed(4);
      updateMultiplier();renderAll();
      const growwPrice=Number(data.groww.price).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const spotPrice=Number(data.spot.price).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      const age=data.groww.updated_at?` · Groww quote ${istDateTime(new Date(data.groww.updated_at).getTime())}`:'';
      if(status)status.textContent=`Groww MCX ₹${growwPrice}/10g · XAU $${spotPrice}/oz · USD/INR ${rate.toFixed(4)} · adjustment ${adjustment>=0?'+':''}${adjustment.toFixed(4)}%${age}`;
      if(status)status.title=`${data.groww.contract||'MCX Gold Mini'} · fair converted value ₹${Number(data.fair_inr_per_10g).toLocaleString('en-IN',{maximumFractionDigits:2})}/10g · Source: Groww, Bybit XAUUSDT, ${data.fx.source}`;
    } catch(error) {
      if(status)status.textContent=`MCX sync unavailable · using saved adjustment${state.indiaAdjustment>=0?'+':''}${state.indiaAdjustment.toFixed(4)}%`;
      if(status)status.title=error.message;
    } finally {state.mcxSyncLoading=false;if(button)button.disabled=false;}
  }
  function showView(name) {
    state.activeView=name;
    document.querySelectorAll('[data-gl-view]').forEach(b=>b.classList.toggle('active',b.dataset.glView===name));
    document.querySelectorAll('.gl-view').forEach(v=>v.classList.toggle('active',v.id===`glView-${name}`));
    if(name==='compare') renderComparison();
  }
  function timeframeBars(source, targetTf) {
    const targetMs=TF_MS[targetTf], baseMs=TF_MS[state.info?.timeframe||state.timeframe];
    if(targetMs < baseMs) return null;
    if(targetTf==='1d') {
      const groups=new Map();
      source.forEach(c=>{ const k=istParts(c.time).date; const a=groups.get(k)||[]; a.push(c); groups.set(k,a); });
      return [...groups.entries()].map(([date,group])=>{const[y,m,d]=date.split('-').map(Number);const istMidnightUtc=Date.UTC(y,m-1,d)-330*60_000;return aggregateGroup(group,targetMs,istMidnightUtc);}).sort((a,b)=>a.time-b.time);
    }
    const groups=new Map();
    source.forEach(c=>{ const start=Math.floor(c.time/targetMs)*targetMs; const a=groups.get(start)||[]; a.push(c); groups.set(start,a); });
    return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([start,group])=>aggregateGroup(group,targetMs,start));
  }
  function aggregateGroup(group, targetMs, explicitTime=null) {
    return {time:explicitTime ?? group[0].time, close_time:(explicitTime ?? group[0].time)+targetMs-1,
      open:group[0].open, high:Math.max(...group.map(c=>c.high)), low:Math.min(...group.map(c=>c.low)),
      close:group[group.length-1].close, volume:group.reduce((s,c)=>s+Number(c.volume||0),0)};
  }
  function decorate(candles) {
    let prev=null;
    return candles.map(c=>{ const delta=prev===null?0:c.close-prev; prev=c.close; return {...c,delta}; });
  }
  function summarizeDaily(candles) {
    const groups=new Map();
    candles.forEach(c=>{ const k=istParts(c.time).date; const a=groups.get(k)||[]; a.push(c); groups.set(k,a); });
    return [...groups.entries()].map(([date,rows])=>({date,label:istDateLabel(rows[0].time),rows,
      open:rows[0].open,high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low)),close:rows.at(-1).close,
      range:Math.max(...rows.map(x=>x.high))-Math.min(...rows.map(x=>x.low)),net:rows.at(-1).close-rows[0].open,
      abs:rows.reduce((s,x)=>s+Math.abs(x.delta),0),maxUp:Math.max(0,...rows.map(x=>x.delta)),maxDown:Math.min(0,...rows.map(x=>x.delta))}));
  }
  function stats(candles) {
    const ds=candles.map(c=>c.delta||0), movements=ds.slice(1), sum=movements.reduce((a,b)=>a+b,0), pos=movements.filter(x=>x>0), neg=movements.filter(x=>x<0);
    let high=-Infinity,low=Infinity,highCandle=candles[0],lowCandle=candles[0];
    candles.forEach(c=>{if(c.high>high){high=c.high;highCandle=c;}if(c.low<low){low=c.low;lowCandle=c;}});
    return {count:candles.length, high,low,
      range:high-low,net:candles.at(-1).close-candles[0].open,
      avgAbs:movements.reduce((s,x)=>s+Math.abs(x),0)/Math.max(1,movements.length),avgSigned:sum/Math.max(1,movements.length),
      positive:pos.length,negative:neg.length,maxUp:Math.max(0,...ds),maxDown:Math.min(0,...ds),
      highCandle,lowCandle};
  }
  function localMinute(ts,tz) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).map(p=>[p.type,p.value]));
    return Number(parts.hour)*60+Number(parts.minute);
  }
  function dstRegime() {
    const shortName=zone=>Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'';
    const uk=/BST/.test(shortName('Europe/London')),us=/EDT/.test(shortName('America/New_York'));
    return uk===us?(uk?'summer':'winter'):'transition';
  }
  function inWindow(minute,start,end) { return start<end ? minute>=start&&minute<end : minute>=start||minute<end; }
  function sessionFlags(ts) {
    const mode=$('glDstMode')?.value||'auto';
    const ist=localMinute(ts,TZ);
    const asian=inWindow(ist,330,870);
    let london, ny;
    if(mode==='auto') {
      london=inWindow(localMinute(ts,'Europe/London'),480,1020);
      ny=inWindow(localMinute(ts,'America/New_York'),480,1020);
    } else {
      const summer=mode==='summer';
      london=inWindow(ist,summer?750:810,summer?1290:1350);
      ny=inWindow(ist,summer?1050:1110,summer?150:210);
    }
    return {Asian:asian,London:london,'New York':ny,'Golden Hours':london&&ny};
  }
  function sessionSummary(candles) {
    const out={Asian:[],London:[],'New York':[],'Golden Hours':[]};
    candles.forEach(c=>{const flags=sessionFlags(c.time); for(const k of Object.keys(out)) if(flags[k]) out[k].push(c);});
    return Object.fromEntries(Object.entries(out).map(([name,rows])=>{
      if(!rows.length)return[name,{name,rows,count:0}];
      const moves=rows.map(c=>c.delta||0);
      return[name,{name,rows,count:rows.length,open:rows[0].open,close:rows.at(-1).close,
        high:Math.max(...rows.map(c=>c.high)),low:Math.min(...rows.map(c=>c.low)),
        range:Math.max(...rows.map(c=>c.high))-Math.min(...rows.map(c=>c.low)),net:rows.at(-1).close-rows[0].open,
        avgAbs:moves.reduce((s,x)=>s+Math.abs(x),0)/rows.length,avgSigned:moves.reduce((s,x)=>s+x,0)/rows.length,
        maxUp:Math.max(0,...moves),maxDown:Math.min(0,...moves)}];
    }));
  }
  function renderKpis(candles) {
    const s=stats(candles); const host=$('glKpis'); if(!host)return;
    const closes=candles.slice(-72).map(c=>c.close),closeMin=Math.min(...closes),closeMax=Math.max(...closes),closeSpan=closeMax-closeMin||1;
    const spark=closes.map((v,i)=>`${i?'L':'M'} ${(4+i/(closes.length-1||1)*112).toFixed(1)} ${(28-(v-closeMin)/closeSpan*22).toFixed(1)}`).join(' ');
    const directionalTotal=Math.max(1,s.positive+s.negative),upPct=s.positive/directionalTotal*100,downPct=s.negative/directionalTotal*100;
    const peakTotal=Math.max(1,s.maxUp,Math.abs(s.maxDown));
    const items=[
      ['Period high / low',`${money(s.high)} / ${money(s.low)}`,`High ${istDateTime(s.highCandle.time)} · Low ${istDateTime(s.lowCandle.time)}`,`<div class="gl-range-meter"><i style="left:0;width:100%"></i></div>`],
      ['Total period range',money(s.range),`${candles.length.toLocaleString()} source candles`,`<svg class="gl-kpi-spark" viewBox="0 0 120 32" aria-label="Recent price sparkline"><path d="${spark}" fill="none" stroke="#f59e0b" stroke-width="2"/></svg>`],
      ['Net price movement',`${s.net>=0?'+':'−'}${money(Math.abs(s.net))}`,`${s.net>=0?'Bullish':'Bearish'} from first open to last close`,`<div class="gl-kpi-bias ${s.net>=0?'bull':'bear'}"><i style="width:${s.net>=0?'100%':'0%'}"></i></div>`],
      ['Avg. absolute movement',money(s.avgAbs),'Typical close-to-close movement',`<div class="gl-range-meter"><i style="left:0;width:${Math.min(100,s.avgAbs/Math.max(s.range,0.01)*100)}%"></i></div>`],
      ['Avg. signed movement',`${s.avgSigned>=0?'+':'−'}${money(Math.abs(s.avgSigned))}`,`${s.positive} up · ${s.negative} down candles`,`<div class="gl-kpi-direction"><i class="up" style="width:${upPct}%"></i><i class="down" style="width:${downPct}%"></i></div>`],
      ['Peak single-candle move',`+${money(s.maxUp)} / −${money(Math.abs(s.maxDown))}`,'Strongest rise / fall',`<div class="gl-kpi-peaks"><i style="width:${s.maxUp/peakTotal*100}%"></i><b style="width:${Math.abs(s.maxDown)/peakTotal*100}%"></b></div>`]
    ];
    host.innerHTML=items.map(([title,value,note,viz])=>`<article class="gl-kpi"><span>${title}</span><strong>${value}</strong><small>${note}</small>${viz}</article>`).join('');
  }
  function renderDailyTable() {
    $('glDailyTable').innerHTML=state.daily.map(d=>`<tr><td>${d.label}</td><td>${money(d.open)}</td><td>${money(d.high)}</td><td>${money(d.low)}</td><td>${money(d.close)}</td><td>${money(d.range)}</td><td class="${d.net>=0?'gl-up':'gl-down'}">${d.net>=0?'+':'−'}${money(Math.abs(d.net))}</td><td>${money(d.abs)}</td><td class="gl-up">+${money(d.maxUp)}</td><td class="gl-down">−${money(Math.abs(d.maxDown))}</td></tr>`).join('');
  }
  function renderHeatmap() {
    const host=$('glHeatmap'); if(!host)return;
    if(!state.candles.length){host.innerHTML='';return;}
    const dates=[...new Set(state.candles.map(c=>istParts(c.time).date))];
    const grid=new Map();
    state.candles.forEach(c=>{ if(!c.delta) return; const hour=Number(istTimeFmt.format(new Date(c.time)).slice(0,2)); const key=`${hour}|${istParts(c.time).date}`; const v=grid.get(key)||{sum:0,count:0};v.sum+=Math.abs(c.delta);v.count++;grid.set(key,v); });
    const max=Math.max(1,...[...grid.values()].map(v=>v.sum/v.count));
    const today=dateNowIST(),weekDates=dates.slice(-7);
    const mean=keys=>{const values=keys.map(k=>grid.get(k)).filter(Boolean);return values.length?values.reduce((s,v)=>s+v.sum/v.count,0)/values.length:null;};
    const weekly=Array.from({length:24},(_,h)=>mean(weekDates.map(d=>`${h}|${d}`))),daily=Array.from({length:24},(_,h)=>mean([`${h}|${today}`]));
    const scale=Math.max(1,...weekly.filter(Number.isFinite),...daily.filter(Number.isFinite));
    const bars=(values,kind)=>`<div class="gl-hour-rail gl-${kind}-rail"><strong>${kind==='week'?'Last 7 days':'Today'}</strong>${values.map((v,h)=>`<div class="gl-hour-bar-row" title="${String(h).padStart(2,'0')}:00 IST · ${v===null?'No candles':money(v)}"><i style="--bar:${v===null?0:Math.max(2,v/scale*100)}%"></i></div>`).join('')}</div>`;
    host.innerHTML=`<div class="gl-heatmap-layout">${bars(weekly,'week')}<div class="gl-heatmap-scroll"><div class="gl-heatmap-grid" style="--gl-columns:${dates.length}"><div class="gl-heatmap-corner">IST</div>${dates.map(d=>`<div class="gl-heatmap-date">${d.slice(5)}</div>`).join('')}${Array.from({length:24},(_,hour)=>`<div class="gl-heatmap-hour">${String(hour).padStart(2,'0')}:00</div>${dates.map(date=>{const v=grid.get(`${hour}|${date}`);const ratio=v?Math.min(1,(v.sum/v.count)/max):0;return `<div class="gl-heat-cell" title="${date} ${String(hour).padStart(2,'0')}:00 IST · ${v?money(v.sum/v.count):'No candles'}" style="--heat:${v?0.1+ratio*.9:0}"></div>`;}).join('')}`).join('')}</div></div>${bars(daily,'today')}</div><div class="gl-heat-legend"><span>Quiet</span><i></i><i></i><i></i><i></i><i></i><span>High movement · bar width uses same scale</span></div>`;
  }
  function renderClockVolatility() {
    const host=$('glClockVolatility');if(!host)return;
    const buckets=Array.from({length:24},()=>({sum:0,count:0}));
    state.candles.forEach(c=>{if(!c.delta)return;const h=Number(istTimeFmt.format(new Date(c.time)).slice(0,2)),b=buckets[h];b.sum+=Math.abs(c.delta);b.count++;});
    const max=Math.max(1,...buckets.map(b=>b.count?b.sum/b.count:0));
    host.innerHTML=`<div class="gl-clock-vol-bars">${buckets.map((b,h)=>{const avg=b.count?b.sum/b.count:null;return `<div class="gl-clock-vol-col" title="${String(h).padStart(2,'0')}:00–${String(h).padStart(2,'0')}:59 IST · ${avg===null?'No candles':money(avg)} average absolute move"><i style="--bar:${avg===null?0:Math.max(2,avg/max*100)}%"></i><span>${String(h).padStart(2,'0')}</span></div>`;}).join('')}</div><div class="gl-clock-vol-axis"><span>00:00 IST</span><span>12:00</span><span>24:00</span></div>`;
  }
  function renderDirection() {
    const host=$('glDirectionMix');if(!host)return;
    const deltas=state.candles.slice(1).map(c=>c.delta);const up=deltas.filter(x=>x>0).length,down=deltas.filter(x=>x<0).length,flat=Math.max(0,deltas.length-up-down),total=Math.max(1,deltas.length);
    host.innerHTML=`<div class="gl-mix-legend"><span class="gl-up">Bullish ${up} · ${(up/total*100).toFixed(1)}%</span><span>Flat ${flat}</span><span class="gl-down">Bearish ${down} · ${(down/total*100).toFixed(1)}%</span></div><div class="gl-mix-track"><i class="gl-up-fill" style="width:${up/total*100}%"></i><i class="gl-flat-fill" style="width:${flat/total*100}%"></i><i class="gl-down-fill" style="width:${down/total*100}%"></i></div>`;
  }
  function sampleRows(rows,max=1400) { if(rows.length<=max)return rows.map((r,i)=>({r,i}));const stride=(rows.length-1)/(max-1);return Array.from({length:max},(_,i)=>({r:rows[Math.round(i*stride)],i:Math.round(i*stride)})); }
  function attachChartHover(canvas,tip,getPoint,formatter) {
    if(canvas.dataset.hoverBound)return;canvas.dataset.hoverBound='1';
    const redraw=()=>{if(canvas.id==='glDailyChart')drawDailyChart();if(canvas.id==='glDeltaChart')drawDeltaChart();};
    canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left;const hit=getPoint(x,rect.width);if(!hit){tip.hidden=true;return;}tip.innerHTML=formatter(hit);tip.hidden=false;const left=Math.min(Math.max(8,x+14),rect.width-tip.offsetWidth-8);tip.style.left=`${left}px`;tip.style.top=`${Math.max(8,e.clientY-rect.top-20)}px`;canvas.dataset.hoverX=String(x);redraw();});
    canvas.addEventListener('pointerleave',()=>{tip.hidden=true;canvas.dataset.hoverX='';redraw();});
  }
  function canvasSize(canvas,height) { const rect=canvas.getBoundingClientRect();if(!rect.width)return null;const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(height*dpr);canvas.style.height=`${height}px`;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:rect.width,h:height}; }
  function drawDailyChart() {
    const canvas=$('glDailyChart');if(!canvas||!state.daily.length)return;const size=canvasSize(canvas,300);if(!size)return;const{ctx,w,h}=size;const rows=state.daily;const pad={l:72,r:16,t:18,b:38};const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;const min=Math.min(...rows.map(d=>d.low)),max=Math.max(...rows.map(d=>d.high)),range=max-min||1;
    ctx.clearRect(0,0,w,h);ctx.font='10px Inter, sans-serif';ctx.fillStyle='#94a3b8';ctx.strokeStyle='rgba(148,163,184,.16)';
    for(let i=0;i<=4;i++){const y=pad.t+plotH*i/4;const val=max-range*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(money(val),4,y+3);}
    const step=plotW/rows.length,bw=Math.min(12,step*.45);const scale=v=>pad.t+(max-v)/range*plotH;
    rows.forEach((d,i)=>{const x=pad.l+step*(i+.5);ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,scale(d.high));ctx.lineTo(x,scale(d.low));ctx.stroke();const top=Math.min(scale(d.open),scale(d.close)),body=Math.max(2,Math.abs(scale(d.close)-scale(d.open)));ctx.fillStyle=d.close>=d.open?'#10b981':'#ef4444';ctx.fillRect(x-bw/2,top,bw,body);ctx.fillStyle='#94a3b8';if(i%Math.max(1,Math.ceil(rows.length/8))===0)ctx.fillText(d.label.slice(0,5),x-18,h-13);});
    const hover=canvas.dataset.hoverX;if(hover){ctx.strokeStyle='#f8fafc';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Number(hover),pad.t);ctx.lineTo(Number(hover),h-pad.b);ctx.stroke();}
    attachChartHover(canvas,$('glDailyTooltip'),(x,width)=>{const idx=Math.floor((x-pad.l)/(plotW/rows.length));return idx>=0&&idx<rows.length?rows[idx]:null;},d=>`<b>${d.label}</b><br>Open ${money(d.open)} · High ${money(d.high)}<br>Low ${money(d.low)} · Close ${money(d.close)}<br>Range ${money(d.range)} · Net ${d.net>=0?'+':''}${money(d.net)}`);
  }
  function drawDeltaChart() {
    const canvas=$('glDeltaChart');if(!canvas||!state.candles.length)return;const size=canvasSize(canvas,380);if(!size)return;const{ctx,w,h}=size;const pad={l:70,r:14,t:20,b:30};const plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;const rows=state.candles;const sampled=sampleRows(rows,1500),maxRaw=Math.max(1,...sampled.map(x=>Math.abs(x.r.delta||0))),maxDisplayed=Math.max(1,displayed(maxRaw));const mid=pad.t+plotH/2,unit=plotH/2/maxDisplayed,step=plotW/sampled.length,bw=Math.max(1,Math.min(9,step*.7));
    ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(148,163,184,.2)';ctx.beginPath();ctx.moveTo(pad.l,mid);ctx.lineTo(w-pad.r,mid);ctx.stroke();ctx.fillStyle='#94a3b8';ctx.font='10px Inter, sans-serif';ctx.fillText(`+${money(maxRaw)}`,6,pad.t+10);ctx.fillText(`−${money(maxRaw)}`,6,h-pad.b);sampled.forEach(({r},i)=>{const v=displayed(r.delta||0),x=pad.l+step*(i+.5),bar=Math.abs(v)*unit;ctx.fillStyle=v>=0?'#10b981':'#ef4444';ctx.fillRect(x-bw/2,v>=0?mid-bar:mid,bw,Math.max(1,bar));});
    const hover=canvas.dataset.hoverX;if(hover){ctx.strokeStyle='#f8fafc';ctx.beginPath();ctx.moveTo(Number(hover),pad.t);ctx.lineTo(Number(hover),h-pad.b);ctx.stroke();}
    attachChartHover(canvas,$('glDeltaTooltip'),x=>{const idx=Math.floor((x-pad.l)/(plotW/sampled.length));return idx>=0&&idx<sampled.length?sampled[idx].r:null;},c=>`${istDateTime(c.time)}<br>Close ${money(c.close)}<br>Movement ${c.delta>=0?'+':'−'}${money(Math.abs(c.delta))}`);
  }
  function renderHeatmapDaily() { renderHeatmap(); }
  function renderSessions() {
    const rows=sessionSummary(state.candles);state.sessions=rows;
    const order=['Asian','London','New York','Golden Hours'];
    $('glSessionTable').innerHTML=order.map(k=>{const s=rows[k];return `<tr><td>${k}</td><td>${s.count||0}</td><td>${s.count?money(s.open):'—'}</td><td>${s.count?money(s.close):'—'}</td><td>${s.count?money(s.high):'—'}</td><td>${s.count?money(s.low):'—'}</td><td>${s.count?money(s.range):'—'}</td><td class="${s.net>=0?'gl-up':'gl-down'}">${s.count?(s.net>=0?'+':'−')+money(Math.abs(s.net)):'—'}</td><td>${s.count?money(s.avgAbs):'—'}</td><td>${s.count?money(s.avgSigned):'—'}</td><td>${s.count?`+${money(s.maxUp)} / −${money(Math.abs(s.maxDown))}`:'—'}</td></tr>`;}).join('');
    const mx=Math.max(1,...order.map(k=>rows[k].range||0));$('glSessionBars').innerHTML=order.map(k=>{const s=rows[k];return `<div class="gl-session-bar"><span>${k}</span><i><b style="width:${s.count?(s.range/mx*100):0}%"></b></i><strong>${s.count?money(s.range):'—'}</strong><small>${s.count?(s.net>=0?'+':'−')+money(Math.abs(s.net)):'No candles'}</small></div>`;}).join('');
    const regime=$('glDstMode').value==='auto'?dstRegime():$('glDstMode').value;
    const summer=regime==='summer';
    $('glKeyTimes').innerHTML=`<span>Gold market rollover <b>Check exchange schedule</b></span><span>London gold PM fix <b>${summer?'07:30 PM':'08:30 PM'} IST${regime==='transition'?' · confirm UK calendar':''}</b></span><span>US CPI / NFP / PCE releases <b>${summer?'06:00 PM':'07:00 PM'} IST${regime==='transition'?' · confirm US calendar':''}</b></span><span>NYSE open <b>${summer?'07:00 PM':'08:00 PM'} IST${regime==='transition'?' · confirm US calendar':''}</b></span><span>FOMC decisions <b>${summer?'11:30 PM':'12:30 AM'} IST${regime==='transition'?' · confirm US calendar':''}</b></span>`;
    renderSessionLog();
    renderTimeline();
  }
  function renderTimeline() {
    const host=$('glSessionTimeline');if(!host)return;const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));const today=`${parts.year}-${parts.month}-${parts.day}`;const cells=Array.from({length:48},(_,i)=>{const hh=Math.floor(i/2),mm=i%2*30;const ts=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),hh,mm)-330*60000;const f=sessionFlags(ts);return {i,f};});
    const groups=[];cells.forEach(c=>{const label=c.f['Golden Hours']?'Golden Hours':c.f['New York']?'New York':c.f.London?'London':c.f.Asian?'Asian':'Quiet';const prev=groups.at(-1);if(prev&&prev.label===label)prev.end=c.i+1;else groups.push({label,start:c.i,end:c.i+1});});const minute=localMinute(Date.now(),TZ);const nowLeft=minute/1440*100;
    const rings=[['Asian',57,'#64748b'],['London',47,'#f59e0b'],['New York',37,'#38bdf8'],['Golden Hours',27,'#fcd34d']];
    const arcs=[];
    rings.forEach(([name,r,color])=>{let start=null;cells.forEach((cell,i)=>{const active=!!cell.f[name];if(active&&start===null)start=i;if((!active||i===cells.length-1)&&start!==null){const end=active&&i===cells.length-1?i+1:i;const length=2*Math.PI*r,offset=length*start/48,dash=length*(end-start)/48;arcs.push(`<circle cx="80" cy="80" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-dasharray="${dash} ${length-dash}" stroke-dashoffset="-${offset}" transform="rotate(-90 80 80)"/>`);start=null;}});});
    const clockMinute=localMinute(Date.now(),TZ),angle=clockMinute/1440*Math.PI*2-Math.PI/2,x=80+Math.cos(angle)*68,y=80+Math.sin(angle)*68;
    host.innerHTML=`<div class="gl-clock-layout"><svg class="gl-radial-clock" viewBox="0 0 160 160" role="img" aria-label="Circular session clock in IST"><circle cx="80" cy="80" r="67" fill="#0b0f17" stroke="#263244"/>${arcs.join('')}<line x1="80" y1="80" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#fff" stroke-width="1.5"/><circle cx="80" cy="80" r="3" fill="#fff"/><text x="80" y="76" text-anchor="middle" fill="#f8fafc" font-size="8">IST</text><text x="80" y="88" text-anchor="middle" fill="#fbbf24" font-size="7">${istTimeFmt.format(now)}</text><text x="80" y="12" text-anchor="middle" fill="#94a3b8" font-size="7">00</text><text x="148" y="83" text-anchor="middle" fill="#94a3b8" font-size="7">06</text><text x="80" y="156" text-anchor="middle" fill="#94a3b8" font-size="7">12</text><text x="12" y="83" text-anchor="middle" fill="#94a3b8" font-size="7">18</text></svg><div class="gl-timeline-main"><div class="gl-timeline">${groups.map(g=>`<div class="gl-time-seg gl-${g.label.toLowerCase().replace(' ','-')}" style="left:${g.start/48*100}%;width:${(g.end-g.start)/48*100}%" title="${g.label} · ${String(Math.floor(g.start/2)).padStart(2,'0')}:${g.start%2?'30':'00'}–${String(Math.floor(g.end/2)).padStart(2,'0')}:${g.end%2?'30':'00'} IST">${(g.end-g.start)>2?g.label:''}</div>`).join('')}<i style="left:${nowLeft}%"></i></div><div class="gl-timeline-axis">${Array.from({length:7},(_,i)=>`<span style="left:${i/6*100}%">${String(i*4).padStart(2,'0')}:00</span>`).join('')}</div></div></div>`;
    $('glNowIst').textContent=`NOW ${istTimeFmt.format(now)} IST`;
  }
  function renderTimeframes() {
    const rows=TF_ORDER.map(tf=>{const candles=timeframeBars(state.source,tf);if(!candles?.length)return{tf,available:false};const ds=decorate(candles).map(c=>c.delta);const valid=ds.slice(1);const pos=valid.filter(x=>x>0),neg=valid.filter(x=>x<0);return{tf,available:true,count:candles.length,abs:valid.reduce((s,x)=>s+Math.abs(x),0)/Math.max(1,valid.length),signed:valid.reduce((s,x)=>s+x,0)/Math.max(1,valid.length),pos:pos.reduce((s,x)=>s+x,0)/Math.max(1,pos.length),neg:neg.reduce((s,x)=>s+x,0)/Math.max(1,neg.length)};});
    $('glTimeframeTable').innerHTML=rows.map(r=>`<tr><td>${r.tf}${r.tf===state.timeframe?' · source':''}</td><td>${r.available?r.count.toLocaleString():'—'}</td><td>${r.available?money(r.abs):'Not present in source interval'}</td><td>${r.available?money(r.signed):'—'}</td><td>${r.available?money(r.pos):'—'}</td><td>${r.available?money(r.neg):'—'}</td></tr>`).join('');
    const avail=rows.filter(r=>r.available),max=Math.max(1,...avail.map(r=>r.abs));$('glTimeframeChart').innerHTML=avail.map(r=>`<div class="gl-tf-row"><span>${r.tf}</span><i><b style="width:${r.abs/max*100}%"></b></i><strong>${money(r.abs)}</strong><small>signed ${money(r.signed)}</small></div>`).join('');
  }
  function renderLiveStrip() {
    const host=$('glLiveStrip');if(!host)return;const t=state.ticker;const exchange=state.info?.source||'Custom CSV';let dst='';try{const l=Intl.DateTimeFormat('en',{timeZone:'Europe/London',timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value;const n=Intl.DateTimeFormat('en',{timeZone:'America/New_York',timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value;dst=`${l||'UK'} / ${n||'US'}`;}catch{}
    const regime=$('glDstMode')?.value==='auto'?dstRegime():$('glDstMode')?.value;
    const updated=t?.updated_at||state.info?.updated_at;
    host.innerHTML=`<div><span>Current ${t?'live price':'loaded close'}</span><strong>${money(t?.last ?? state.candles.at(-1)?.close ?? 0)}</strong></div><div><span>24h high ${t?'':'(no live ticker)'}</span><strong>${t?money(t.high_24h):'—'}</strong></div><div><span>24h low</span><strong>${t?money(t.low_24h):'—'}</strong></div><div><span>Exchange / contract</span><strong>${esc(exchange)} · ${esc(t?.symbol||state.info?.symbol||'CSV')}</strong></div><div><span>DST · last update</span><strong>${regime} · ${updated?istDateTime(new Date(updated).getTime()):'—'}</strong></div>`;
  }
  function renderTimelineClock() { if(state.candles.length)renderTimeline(); }
  function buildMovementTable(items, withSession=false) {
    const max=state.movementMax||1;
    const rows=items.map(item=>{const c=withSession?item.c:item;const time=istTimeFmt.format(new Date(c.close_time||c.time+TF_MS[state.timeframe]-1));return `<tr><td>${time}</td>${withSession?`<td>${item.primary}</td>`:''}<td>${money(c.open??c.close)}</td><td>${money(c.high??c.close)}</td><td>${money(c.low??c.close)}</td><td>${money(c.close)}</td>${withSession?'':`<td>${Number(c.volume||0).toLocaleString('en-US',{maximumFractionDigits:4})}</td>`}<td class="${c.delta>=0?'gl-up':'gl-down'}">${c.delta>=0?'+':'−'}${money(Math.abs(c.delta))}</td><td><i class="gl-mini-move ${c.delta>=0?'up':'down'}" style="width:${Math.max(3,Math.abs(c.delta)/max*100)}%"></i></td></tr>`;}).join('');
    return `<div class="table-responsive gl-candle-log"><table class="data-table"><thead><tr><th>Close time (IST)</th>${withSession?'<th>Session</th>':''}<th>Open</th><th>High</th><th>Low</th><th>Close</th>${withSession?'':'<th>Volume</th>'}<th>Movement</th><th>Mini move</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function renderCandleTable() {
    state.movementMax=Math.max(1,...state.candles.map(c=>Math.abs(c.delta||0)));
    const groups=new Map();state.candles.forEach(c=>{const key=istParts(c.time).date;const a=groups.get(key)||[];a.push(c);groups.set(key,a);});state.candleDateGroups=groups;
    $('glCandleGroups').innerHTML=[...groups.entries()].reverse().map(([date,rows])=>`<details class="gl-date-card gl-candle-date" data-date="${date}"><summary>${istDateLabel(rows[0].time)} · ${rows.length.toLocaleString()} candles · ${money(Math.min(...rows.map(c=>c.low)))}–${money(Math.max(...rows.map(c=>c.high)))}</summary><div class="gl-date-content"></div></details>`).join('');
    $('glCandleGroups').querySelectorAll('.gl-candle-date').forEach(card=>card.addEventListener('toggle',()=>{if(!card.open||card.dataset.loaded)return;const rows=state.candleDateGroups.get(card.dataset.date)||[];card.querySelector('.gl-date-content').innerHTML=buildMovementTable(rows);card.dataset.loaded='1';}));
  }
  function renderSessionLog() {
    const host=$('glSessionLog'),filters=$('glSessionFilters');if(!host||!filters)return;
    const names=['All Sessions','Asian','London','New York','Golden Hours'];
    filters.innerHTML=names.map(name=>`<button type="button" class="${state.sessionFilter===name?'active':''}" data-session-filter="${name}">${name}</button>`).join('');
    filters.querySelectorAll('[data-session-filter]').forEach(b=>b.addEventListener('click',()=>{state.sessionFilter=b.dataset.sessionFilter;renderSessionLog();}));
    const groups=new Map();state.candles.forEach(c=>{const flags=sessionFlags(c.time);const list=names.slice(1).filter(n=>flags[n]);const primary=flags['Golden Hours']?'Golden Hours':flags['New York']?'New York':flags.London?'London':flags.Asian?'Asian':'Quiet';const match=state.sessionFilter==='All Sessions'||(state.sessionFilter==='Golden Hours'?flags['Golden Hours']:flags[state.sessionFilter]);if(!match)return;const date=istParts(c.time).date;const rows=groups.get(date)||[];rows.push({c,primary});groups.set(date,rows);});
    const max=Math.max(1,...state.candles.map(c=>Math.abs(c.delta||0)));
    state.sessionDateGroups=groups;
    host.innerHTML=[...groups.entries()].reverse().map(([date,items])=>`<details class="gl-date-card gl-session-date" data-date="${date}"><summary>${istDateLabel(items[0].c.time)} · ${items.length.toLocaleString()} candles${state.sessionFilter==='All Sessions'?' · overlap counted once':''}</summary><div class="gl-date-content"></div></details>`).join('');
    host.querySelectorAll('.gl-session-date').forEach(card=>card.addEventListener('toggle',()=>{if(!card.open||card.dataset.loaded)return;const items=state.sessionDateGroups.get(card.dataset.date)||[];card.querySelector('.gl-date-content').innerHTML=buildMovementTable(items,true);card.dataset.loaded='1';}));
  }
  function renderDaily() { state.daily=summarizeDaily(state.candles);renderDailyTable();renderHeatmapDaily();renderDirection();drawDailyChart(); }
  function renderAll() {
    updateMultiplier();
    if(!state.candles.length)return;
    renderKpis(state.candles);renderLiveStrip();renderDaily();renderClockVolatility();renderCandleTable();renderSessions();renderTimeframes();renderComparison();
    requestAnimationFrame(()=>{drawDailyChart();drawDeltaChart();});
  }
  function detectGaps(source,tf) { const ms=TF_MS[tf];let gaps=0;for(let i=1;i<source.length;i++)if(source[i].time-source[i-1].time>ms)gaps+=Math.max(1,Math.round((source[i].time-source[i-1].time)/ms)-1);return gaps; }
  async function generate() {
    if(!state.workloadEnabled){setStatus('Gold Liquidity is paused. Turn it on in Data Workloads before generating analysis.','warning');return;}
    if(state.loading){state.queuedGenerate=true;return;}const ex=$('glExchange').value;state.exchange=ex;state.timeframe=$('glTimeframe').value;
    const start=$('glStartDate').value,end=$('glEndDate').value;if(!start||!end||end<start){setStatus('Choose a valid start and end date. Dates are interpreted in IST.','error');return;}
    if(ex==='csv') {if(!state.source.length){setStatus('Choose a CSV file with timestamp, open, high, low, close, and optional volume columns.','warning');return;}const sourceTf=state.info?.timeframe||state.timeframe;const filtered=state.source.filter(c=>{const d=istParts(c.time).date;return d>=start&&d<=end;});state.info={exchange:'csv',symbol:'CSV',timeframe:sourceTf,source:state.csvName||'Uploaded CSV',updated_at:new Date().toISOString()};state.candles=decorate(timeframeBars(filtered,state.timeframe)||[]);renderAll();setStatus(`${state.candles.length.toLocaleString()} candles loaded from ${state.csvName} (${sourceTf} source interval). Dates grouped in IST; no missing prices were filled.`, state.candles.length?'success':'warning');return;}
    state.loading=true;$('glGenerate').disabled=true;setStatus(`Loading actual ${state.timeframe} candles from ${ex}…`, 'info');
    try {
      const query=new URLSearchParams({exchange:ex,timeframe:state.timeframe,start,end});const response=await fetch(`/api/gold-liquidity/candles?${query}`);const data=await response.json();if(!response.ok)throw new Error(data.error||'Historical candles unavailable');
      const receivedCandles=Array.isArray(data.candles)?data.candles:[];
      if(!receivedCandles.length){setStatus(data.error||`No ${state.timeframe} candles were returned by ${ex} for ${start} to ${end}. Try another exchange, timeframe, or date range.`, 'warning');return;}
      state.source=receivedCandles;state.info=data;state.candles=decorate(state.source);state.ticker=null;
      const gaps=detectGaps(state.source,state.timeframe),startGap=state.source[0].time,endGap=state.source.at(-1).time;
      const requestedStart=Date.parse(`${start}T00:00:00+05:30`),requestedEnd=Date.parse(`${end}T00:00:00+05:30`)+86400000;
      const partialStart=startGap-requestedStart>TF_MS[state.timeframe]*1.5;
      const expectedEnd=Math.min(requestedEnd,Date.now());
      const partialEnd=expectedEnd-(endGap+TF_MS[state.timeframe])>TF_MS[state.timeframe]*2;
      const coverage=partialStart||partialEnd?` Requested ${istDateLabel(requestedStart)}–${istDateLabel(requestedEnd-1)}; returned coverage is ${istDateLabel(startGap)}–${istDateLabel(endGap)}${partialStart?' (start of requested history is unavailable)':''}${partialEnd?' (end of requested history is unavailable)':''}.`:'';
      setStatus(`${data.count.toLocaleString()} real ${state.timeframe} candles from ${data.source} · ${istDateTime(startGap)} to ${istDateTime(endGap)}.${coverage}${gaps?` Source gaps: ${gaps.toLocaleString()} missing candles; none were interpolated.`:' No internal gaps detected at this interval.'}`,gaps||partialStart||partialEnd?'warning':'success');
      renderAll();if(state.liveMode)refreshLive();
    } catch(e) {state.source=[];state.candles=[];state.info=null;state.ticker=null;renderAll();setStatus(e.message,'error');}
    finally {state.loading=false;$('glGenerate').disabled=false;if(state.queuedGenerate){state.queuedGenerate=false;queueMicrotask(generate);}}
  }
  async function fetchTicker(exchange) {
    if(!state.workloadEnabled||exchange==='csv')return;
    try {const r=await fetch(`/api/gold-liquidity/ticker?exchange=${encodeURIComponent(exchange)}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ticker unavailable');state.ticker=d;renderLiveStrip();}
    catch(e){state.ticker=null;renderLiveStrip();setStatus(`${$('glStatus').textContent} Live ticker unavailable: ${e.message}. Historical candles remain available.`, 'warning');}
  }
  async function refreshLive() {
    if(!state.workloadEnabled||!state.liveMode||state.liveLoading||state.exchange==='csv'||!state.candles.length)return;
    state.liveLoading=true;
    try {
      const query=new URLSearchParams({exchange:state.exchange,timeframe:state.timeframe});
      const response=await fetch(`/api/gold-liquidity/live?${query}`,{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Live candle refresh failed');
      const start=$('glStartDate').value,end=$('glEndDate').value,merged=new Map(state.source.map(c=>[Number(c.time),c]));let inRange=0;
      (data.candles||[]).forEach(c=>{const date=istParts(Number(c.time)).date;if(date>=start&&date<=end){merged.set(Number(c.time),c);inRange++;}});
      state.source=[...merged.values()].sort((a,b)=>a.time-b.time);
      state.ticker=data.ticker||null;
      state.info={...state.info,updated_at:data.updated_at};
      state.candles=decorate(state.source);
      renderAll();
      const label=inRange?`Live candles${data.ticker?' and ticker':''} refreshed · ${istTimeFmt.format(new Date(data.updated_at))} IST.`:`Live ticker refreshed. Current candles are outside the selected dates; set End date to today to include live bars.`;
      setStatus(label,data.ticker?'success':'warning');
    } catch(error) {
      setStatus(`Live Mode is on, but the exchange refresh failed: ${error.message}. Existing candles are retained and will be retried.`, 'warning');
    } finally {state.liveLoading=false;}
  }
  function csvRows(text) {
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)throw new Error('CSV needs a header row and candle rows.');
    const split=line=>line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map(x=>x.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"'))||line.split(',');
    const head=split(lines[0]).map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]/g,''));
    const col=(aliases,required=true)=>{const i=head.findIndex(h=>aliases.includes(h));if(i<0&&required)throw new Error(`CSV is missing a ${aliases[0]} column.`);return i;};
    const ix={time:col(['timestamp','time','datetime','date']),open:col(['open','o']),high:col(['high','h']),low:col(['low','l']),close:col(['close','c']),volume:col(['volume','vol','v'],false)};
    const rows=[];for(const line of lines.slice(1)){const a=split(line);let raw=a[ix.time]?.trim();let ts;
      if(/^\d+(\.\d+)?$/.test(raw)){const n=Number(raw);ts=Math.round(n<1e12?n*1000:n);}else if(/^\d{4}-\d\d-\d\d$/.test(raw)){ts=Date.parse(`${raw}T00:00:00+05:30`);}else if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(raw)){const fixed=raw.replace(' ','T');ts=Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(fixed)?fixed:`${fixed}+05:30`);}else ts=Date.parse(raw);
      const c={time:ts,open:Number(a[ix.open]),high:Number(a[ix.high]),low:Number(a[ix.low]),close:Number(a[ix.close]),volume:ix.volume<0?0:Number(a[ix.volume]||0)};
      if(!Number.isFinite(c.time)||![c.open,c.high,c.low,c.close].every(Number.isFinite))continue;rows.push(c);}
    rows.sort((a,b)=>a.time-b.time);if(!rows.length)throw new Error('No valid OHLC rows were found in the CSV.');return [...new Map(rows.map(c=>[c.time,c])).values()];
  }
  function inferCsvTimeframe(rows) {const ordered=rows.slice(0,Math.min(rows.length,5000));const diffs=[];for(let i=1;i<ordered.length;i++){const d=ordered[i].time-ordered[i-1].time;if(d>0)diffs.push(d);}if(!diffs.length)return '1m';diffs.sort((a,b)=>a-b);const median=diffs[Math.floor(diffs.length/2)];return TF_ORDER.reduce((best,tf)=>Math.abs(TF_MS[tf]-median)<Math.abs(TF_MS[best]-median)?tf:best,'1m');}
  function renderTimelineTicker(){renderTimeline();}
  function sessionPreset(days) {const end=dateNowIST();$('glEndDate').value=end;$('glStartDate').value=shiftDate(end,-(days-1));if(days===1){$('glStartDate').value=end;}}
  function currentRangeCandles(start,end) {return state.candles.filter(c=>{const d=istParts(c.time).date;return d>=start&&d<=end;});}
  function compareStats(rows) {if(!rows.length)return null;const data=decorate(rows),s=stats(data);const ss=sessionSummary(data);return{range:s.range,net:s.net,abs:s.avgAbs,session:Object.values(ss).filter(v=>v.count).reduce((m,v)=>Math.max(m,v.avgAbs),0),rows:data};}
  function renderComparison() {
    const body=$('glCompareTable');if(!body)return;
    const aStart=$('glAStart')?.value,aEnd=$('glAEnd')?.value,bStart=$('glBStart')?.value,bEnd=$('glBEnd')?.value;
    if(!aStart||!aEnd||!bStart||!bEnd||!state.candles.length){body.innerHTML='';return;}
    const a=compareStats(currentRangeCandles(aStart,aEnd)),b=compareStats(currentRangeCandles(bStart,bEnd));if(!a||!b){body.innerHTML='<tr><td colspan="4">Select periods containing loaded candles.</td></tr>';return;}
    const metrics=[['Total range','range'],['Net movement','net'],['Average absolute move','abs'],['Peak session average move','session']];
    body.innerHTML=metrics.map(([label,key])=>`<tr><td>${label}</td><td>${money(a[key])}</td><td>${money(b[key])}</td><td class="${b[key]-a[key]>=0?'gl-up':'gl-down'}">${b[key]-a[key]>=0?'+':'−'}${money(Math.abs(b[key]-a[key]))}</td></tr>`).join('');
    const valuesA=a.rows.map(c=>100*(c.close/a.rows[0].close-1)),valuesB=b.rows.map(c=>100*(c.close/b.rows[0].close-1)),pathMax=Math.max(0.01,...valuesA.map(Math.abs),...valuesB.map(Math.abs));
    const path=values=>values.map((v,i)=>`${i?'L':'M'} ${(10+i/(values.length-1||1)*480).toFixed(1)} ${(190-v/pathMax*45).toFixed(1)}`).join(' ');
    const barMetrics=[['Range','range'],['Net','net'],['Avg abs','abs'],['Session vol.','session']];
    const bars=barMetrics.map(([label,key],i)=>{const x=80+i*105,max=Math.max(1,Math.abs(a[key]),Math.abs(b[key])),ha=Math.abs(a[key])/max*30,hb=Math.abs(b[key])/max*30;const ya=a[key]>=0?75-ha:75,yb=b[key]>=0?75-hb:75;return `<g><rect x="${x}" y="${ya}" width="24" height="${Math.max(1,ha)}" fill="#f59e0b"><title>Period A ${label}: ${money(a[key])}</title></rect><rect x="${x+28}" y="${yb}" width="24" height="${Math.max(1,hb)}" fill="#38bdf8"><title>Period B ${label}: ${money(b[key])}</title></rect><text x="${x}" y="116" fill="#94a3b8" font-size="9">${label}</text></g>`;}).join('');
    $('glCompareChart').innerHTML=`<svg viewBox="0 0 500 250" role="img" aria-label="Grouped period metric bars and normalized cumulative movement overlay"><text x="10" y="14" fill="#f59e0b" font-size="9">Period A · ${esc(aStart)}–${esc(aEnd)}</text><text x="270" y="14" fill="#38bdf8" font-size="9">Period B · ${esc(bStart)}–${esc(bEnd)}</text>${bars}<line x1="8" x2="492" y1="75" y2="75" stroke="#64748b" stroke-dasharray="3 3"/><text x="8" y="132" fill="#94a3b8" font-size="9">Normalized cumulative close movement (%)</text><line x1="8" x2="492" y1="190" y2="190" stroke="#64748b" stroke-dasharray="3 3"/><path d="${path(valuesA)}" fill="none" stroke="#f59e0b" stroke-width="2"/><path d="${path(valuesB)}" fill="none" stroke="#38bdf8" stroke-width="2"/></svg>`;
  }
  function download(name,content,type='text/csv;charset=utf-8') {const blob=new Blob(['\ufeff',content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  function csvCell(x) {return `"${String(x??'').replaceAll('"','""')}"`;}
  function exportCandles() {const rows=[['IST close time','Open','High','Low','Close','Volume','Movement',`Currency ${state.currency}`,`Price unit ${state.currency==='INR'?'INR/10g':'USD/troy oz'}`,`USD/INR ${state.rate}`,`India adjustment percent ${state.indiaAdjustment}`],...state.candles.map(c=>[istDateTime(c.close_time||c.time+TF_MS[state.timeframe]-1),displayed(c.open),displayed(c.high),displayed(c.low),displayed(c.close),c.volume,displayed(c.delta),state.currency,state.currency==='INR'?'INR per 10g':'USD per troy oz',state.rate,state.indiaAdjustment])];download('gold-liquidity-candles.csv',rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));}
  function exportSessions() {const rows=[['Session','Count',`Range (${state.currency})`,`Net (${state.currency})`,`Average absolute move (${state.currency})`,`Average signed move (${state.currency})`,`Displayed unit`,`USD/INR rate`,`India adjustment percent`],...Object.values(state.sessions).map(s=>[s.name,s.count,...[s.range,s.net,s.avgAbs,s.avgSigned].map(displayed),state.currency==='INR'?'INR per 10g':'USD per troy oz',state.rate,state.indiaAdjustment])];download('gold-liquidity-sessions.csv',rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));}
  function exportWorkbook() {
    const sheets=[['Daily', [['Date','Open','High','Low','Close','Range','Net','Abs movement'],...state.daily.map(d=>[d.label,...[d.open,d.high,d.low,d.close,d.range,d.net,d.abs].map(displayed)])]],
      ['Candles',[['IST close','Open','High','Low','Close','Volume','Movement'],...state.candles.map(c=>[istDateTime(c.close_time||c.time+TF_MS[state.timeframe]-1),...['open','high','low','close'].map(k=>displayed(c[k])),c.volume,displayed(c.delta)])]],
      ['Sessions',[['Name','Candles','Range','Net','Avg absolute','Avg signed'],...Object.values(state.sessions).map(s=>[s.name,s.count,displayed(s.range),displayed(s.net),displayed(s.avgAbs),displayed(s.avgSigned)])]],
      ['Settings',[['Currency mode',state.currency],['Displayed unit',state.currency==='INR'?'INR per 10g':'USD per troy oz'],['USD to INR rate',state.rate],['India market adjustment percent',state.indiaAdjustment],['Troy ounce grams',TROY_OUNCE_GRAMS],['INR multiplier (per 10g per USD/oz)',state.multiplier],['Exchange',state.info?.source||'CSV'],['Symbol',state.info?.symbol||'CSV'],['Timeframe',state.timeframe],['Start date IST',$('glStartDate').value],['End date IST',$('glEndDate').value]]]];
    const escXml=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(([name,rows])=>`<Worksheet ss:Name="${name}"><Table>${rows.map(row=>`<Row>${row.map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${escXml(v)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`).join('')}</Workbook>`;
    download('gold-liquidity-report.xls',xml,'application/vnd.ms-excel;charset=utf-8');
  }
  function savePreset(load=false) {
    const key='tradex.goldLiquidity.preset';
    if(load){const v=JSON.parse(localStorage.getItem(key)||'null');if(!v){setStatus('No saved GoldLiquidity preset yet.','warning');return;}for(const [id,val] of Object.entries(v))if($(id))$(id).value=val;state.currency=v.currency||'USD';document.querySelectorAll('[data-gl-currency]').forEach(b=>b.classList.toggle('active',b.dataset.glCurrency===state.currency));updateMultiplier();generate();return;}
    const v={glExchange:$('glExchange').value,glTimeframe:$('glTimeframe').value,glStartDate:$('glStartDate').value,glEndDate:$('glEndDate').value,glDstMode:$('glDstMode').value,glFxRate:$('glFxRate').value,glIndiaAdjustment:$('glIndiaAdjustment').value,currency:state.currency};localStorage.setItem(key,JSON.stringify(v));setStatus('GoldLiquidity preset saved on this device.','success');
  }
  function renderTimeframeButtons() {
    const host=$('glTimeframeButtons');if(!host)return;
    host.innerHTML=TF_ORDER.map(tf=>`<button type="button" data-gl-timeframe="${tf}" class="${tf===state.timeframe?'active':''}">${tf.toUpperCase()}</button>`).join('');
    host.querySelectorAll('[data-gl-timeframe]').forEach(button=>button.addEventListener('click',()=>{
      state.timeframe=button.dataset.glTimeframe;$('glTimeframe').value=state.timeframe;
      host.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));
      generate();
    }));
  }
  window.setGoldLiquidityWorkload = enabled => {
    const wasEnabled=state.workloadEnabled;state.workloadEnabled=!!enabled;
    if(!state.workloadEnabled){
      if(state.liveMode)setLiveMode(false);
      setStatus('Gold Liquidity is paused. Turn it on in Data Workloads to request exchange data.','warning');
      return;
    }
    refreshIndiaAdjustment();
    if(!wasEnabled){
      if(localStorage.getItem('tradex.goldLiquidity.liveMode')==='true')setLiveMode(true);
      else if(!state.candles.length&&!state.loading)generate();
    }
  };
  async function init() {
    if(!$('panel-gold-liquidity'))return;
    const end=dateNowIST();$('glEndDate').value=end;$('glStartDate').value=shiftDate(end,-6);
    const savedRate=Number(localStorage.getItem('tradex.goldLiquidity.rate'));if(savedRate>0)$('glFxRate').value=String(savedRate);
    const savedAdjustment=localStorage.getItem('tradex.goldLiquidity.indiaAdjustment');if(savedAdjustment!==null)$('glIndiaAdjustment').value=savedAdjustment;
    setCurrency(localStorage.getItem('tradex.goldLiquidity.currency')||'USD');updateMultiplier();
    document.querySelectorAll('[data-gl-currency]').forEach(b=>b.addEventListener('click',()=>setCurrency(b.dataset.glCurrency)));
    document.querySelectorAll('[data-gl-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.glView)));
    document.querySelectorAll('[data-gl-preset]').forEach(b=>b.addEventListener('click',()=>{sessionPreset(b.dataset.glPreset==='today'?1:Number(b.dataset.glPreset));generate();}));
    $('glLiveToggle').addEventListener('click',()=>setLiveMode(!state.liveMode));
    setLiveMode(false);
    renderTimeframeButtons();
    $('glGenerate').addEventListener('click',generate);$('glFxRate').addEventListener('input',()=>{updateMultiplier();renderAll();});$('glIndiaAdjustment').addEventListener('input',()=>{updateMultiplier();renderAll();});$('glFxRefresh').addEventListener('click',refreshFx);$('glMcxSync').addEventListener('click',refreshIndiaAdjustment);$('glDstMode').addEventListener('change',()=>{renderSessions();renderLiveStrip();});
    $('glCsvFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{state.source=csvRows(await file.text());state.csvName=file.name;$('glExchange').value='csv';state.exchange='csv';const sourceTf=inferCsvTimeframe(state.source);state.info={exchange:'csv',symbol:'CSV',timeframe:sourceTf,source:file.name,updated_at:new Date().toISOString()};setStatus(`${state.source.length.toLocaleString()} timestamped CSV rows loaded. Detected ${sourceTf} source interval; choose the output timeframe and date range, then Generate analysis. Naive timestamps are treated as IST.`, 'success');}catch(err){setStatus(err.message,'error');}});
    $('glExchange').addEventListener('change',()=>{if($('glExchange').value==='csv'&&state.liveMode)setLiveMode(false);if($('glExchange').value==='csv'&&state.source.length)generate();});
    $('glCompare').addEventListener('click',renderComparison);$('glExportCandles').addEventListener('click',exportCandles);$('glExportSessions').addEventListener('click',exportSessions);$('glExportWorkbook').addEventListener('click',exportWorkbook);$('glSavePreset').addEventListener('click',()=>savePreset(false));$('glLoadPreset').addEventListener('click',()=>savePreset(true));
    setInterval(renderTimelineTicker,30_000);
    setInterval(()=>{if(state.workloadEnabled&&document.querySelector('.nav-tab.active')?.dataset.tab==='gold-liquidity')refreshIndiaAdjustment();},60_000);
    setInterval(()=>{if(state.workloadEnabled&&state.liveMode&&state.candles.length&&document.querySelector('.nav-tab.active')?.dataset.tab==='gold-liquidity')refreshLive();},5_000);
  }
  window.loadGoldLiquidity=()=>{if(!state.workloadEnabled){setStatus('Gold Liquidity is paused. Turn it on in Data Workloads first.','warning');return;}if(!state.candles.length&&!state.loading)generate();else requestAnimationFrame(renderAll);};
  document.addEventListener('DOMContentLoaded',init);
})();
