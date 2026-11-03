import {TZ,finite,dayKey,fmt,timeLabel,direction,windType,joinHours,parseTides,tideHeight,currentHour,weatherLabel,easternDayBounds,easternMidnights} from './data.js';
import {sourceUsable} from './outlook.js';
import {evaluateNearshoreAreas,renderNearshoreLeaders} from './nearshore-areas.js';
import {renderCompass} from './compass.js';
import {currentSwellComponents} from './swell-components.js';
import {rankSessionWindows} from './session-windows.js';
import {quickForecastDays,forecastTarget} from './forecast-day.js';
import {initSpectra} from './spectra-ui.js';
import {initCoastal} from './coastal-ui.js';
import {initHistory} from './history-ui.js';
import {attachTideInspector} from './tide-inspection.js';
const $=id=>document.getElementById(id);
const state={units:'imperial',sources:{},rows:[],tides:[],days:[],day:dayKey(Date.now()/1000),hour:null,table:false,loading:false,area:'pier',traffic:null,trafficLoading:false};
try{state.units=localStorage.getItem('folly-units')==='metric'?'metric':'imperial';}catch{}
const now=()=>Date.now()/1000;
let swellComponents=null,swellLoading=false;
async function loadSwellComponents(){
 if(swellLoading)return;swellLoading=true;
 try{
  const response=await fetch('/api/swell-components',{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Swell source unavailable');
  swellComponents=await response.json();
 }catch{swellComponents=null;}
 finally{swellLoading=false;renderCompassPanel();}
}
function renderCompassPanel(){
 const at=now(),target=outlookTarget(at),r=currentHour(state.rows,target),point=state.sources.nwps?.data?.points?.find(p=>p.id===state.area);
 const weatherFresh=state.sources.weather?.status==='fresh'&&sourceUsable(state.sources.weather,at,6*3600);
 const components=currentSwellComponents(swellComponents,target,at);
 $('wind-compass').innerHTML=renderCompass({wind:weatherFresh?r?.wind:null,windDir:weatherFresh?r?.windDir:null,gust:weatherFresh?r?.gust:null,swellComponents:components,swellLoading,units:state.units,area:state.area,latitude:point?.latitude,longitude:point?.longitude});
}
const height=n=>finite(n)?n*(state.units==='imperial'?3.280839895:1):null;
const tideUnit=n=>finite(n)?n*(state.units==='metric'?0.3048:1):null;
const speed=n=>finite(n)?n*(state.units==='metric'?1.609344:1):null;
const temp=n=>finite(n)?state.units==='metric'?(n-32)*5/9:n:null;
const hu=()=>state.units==='metric'?'m':'ft';
const su=()=>state.units==='metric'?'km/h':'mph';
const num=(n,d=0)=>finite(n)?n.toFixed(d):'—';
const range=(arr,convert=height,d=1)=>{const a=arr.filter(finite).map(convert);if(!a.length)return '—';const min=Math.min(...a),max=Math.max(...a);return min.toFixed(d)===max.toFixed(d)?min.toFixed(d):`${min.toFixed(d)}–${max.toFixed(d)}`;};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const windArrow=(d)=>finite(d)?`<span class="wind-arrow" aria-hidden="true" style="--angle:${d+180}deg">↑</span>`:'';
function sourceURLs(){
 const base={latitude:32.64,longitude:-79.91,forecast_days:16,timeformat:'unixtime',timezone:TZ};
 const begin=new Date(Date.now()-86400000).toISOString().slice(0,10).replaceAll('-','');
 const end=new Date(Date.now()+17*86400000).toISOString().slice(0,10).replaceAll('-','');
 return {
  marine:'https://marine-api.open-meteo.com/v1/marine?'+new URLSearchParams({...base,cell_selection:'sea',hourly:'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period'}),
  weather:'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({...base,latitude:32.655,longitude:-79.94,hourly:'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation_probability,is_day',daily:'sunrise,sunset',temperature_unit:'fahrenheit',wind_speed_unit:'mph'}),
  tides:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'+new URLSearchParams({product:'predictions',application:'FollySurf',begin_date:begin,end_date:end,datum:'MLLW',station:'8666467',time_zone:'gmt',units:'english',interval:'hilo',format:'json'})
 };
}
function valid(data,kind){
 if(data?.error)return false;
 if(kind==='tides')return parseTides(data).length>0;
 const h=data?.hourly,key=kind==='marine'?'wave_height':'wind_speed_10m';
 return Array.isArray(h?.time)&&h.time.some(finite)&&Array.isArray(h[key])&&h[key].some(finite);
}
async function getSource(kind,url,force){
 const key='folly-v2-16day-'+kind;let cached;
 try{cached=JSON.parse(localStorage.getItem(key));}catch{}
 const usable=cached&&valid(cached.data,kind)&&finite(cached.retrieved)&&Date.now()-cached.retrieved>=0&&Date.now()-cached.retrieved<6*3600000;
 if(!force&&usable&&Date.now()-cached.retrieved<20*60000&&cached.day===dayKey(now()))return {...cached,status:'fresh'};
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=await response.json();if(!valid(data,kind))throw new Error('No usable forecast returned');
  const result={data,retrieved:Date.now(),day:dayKey(now()),status:'fresh'};
  try{localStorage.setItem(key,JSON.stringify(result));}catch{}
  return result;
 }catch(error){return usable?{...cached,status:'cached',error:error.message}:{data:null,status:'unavailable',error:error.message};}
}
async function load(force=false){
 if(state.loading)return;void loadSwellComponents();state.loading=true;$('refresh').disabled=true;$('status-text').textContent='Loading the latest forecasts…';
 let bundle=null;
 try{const response=await fetch('/api/conditions',{signal:AbortSignal.timeout(60000)});if(response.ok)bundle=await response.json();}catch{}
 if(bundle?.sources){
  state.sources=Object.fromEntries(Object.entries(bundle.sources).map(([key,s])=>[key,{...s,retrieved:s.retrievedAt? s.retrievedAt*1000:null}]));
 }else{
  const urls=sourceURLs();
  await Promise.all(Object.entries(urls).map(async([kind,url])=>{const result=await getSource(kind,url,force);state.sources[kind]={...result,retrievedAt:result.retrieved?result.retrieved/1000:null};}));
  for(const key of ['nws','nwps','buoy'])state.sources[key]={status:'unavailable',data:null};
 }
 state.rows=joinHours(state.sources.marine.data,state.sources.weather.data);
 state.tides=parseTides(state.sources.tides.data);
 const today=dayKey(now());
 state.days=[...new Set(state.rows.map(r=>r.day))].filter(d=>d>=today).slice(0,16);
 if(!state.days.length)state.days=[...new Set(state.tides.map(r=>dayKey(r.t)))].filter(d=>d>=today).slice(0,16);
 if(!state.day||state.day<today)state.day=today;
 const selected=state.rows.filter(r=>r.day===state.day);
 if(!selected.some(r=>r.t===state.hour))state.hour=(currentHour(selected,now())??selected.find(r=>r.isDay===1)??selected[0])?.t??null;
 state.loading=false;$('refresh').disabled=false;render();
}
function render(){renderUnits();renderStatus();renderNow();renderDays();renderHourly();renderTides();renderWindow();renderGuidance();renderTraffic();historyUI.update();}
function renderUnits(){
 const imperial=state.units==='imperial';$('units').textContent=imperial?'°F / ft':'°C / m';$('units').setAttribute('aria-label','Change units to '+(imperial?'metric':'imperial'));
 document.querySelectorAll('.height-unit').forEach(e=>e.textContent=hu());document.querySelectorAll('.speed-unit').forEach(e=>e.textContent=su());document.querySelectorAll('.temp-unit').forEach(e=>e.textContent=imperial?'°F':'°C');
 $('local-date').textContent=fmt(now(),{weekday:'short',month:'short',day:'numeric'})+' · '+fmt(now(),{hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
function renderStatus(){
 const labels={marine:'Offshore wave',weather:'Weather',tides:'Tide',nws:'NWS surf',nwps:'Nearshore',buoy:'Buoy',buoyModel:'Buoy comparison model'};
 const entries=Object.entries(state.sources);
 const missing=entries.filter(([,s])=>['unavailable','stale'].includes(s.status)).map(([k])=>labels[k]);
 const cached=entries.filter(([,s])=>s.status==='cached').map(([k])=>labels[k]);
 const times=entries.filter(([,s])=>finite(s.retrieved)).map(([,s])=>s.retrieved);
 $('feed-status').className='feed-status '+(missing.length||cached.length?'partial':'ready');
 $('status-text').textContent=times.length?`Updated ${timeLabel(Math.min(...times)/1000)} ET${cached.length?' · Cached data':''}${missing.length?' · Some feeds unavailable':''}`:'Forecast feeds unavailable';
 $('error-panel').hidden=!missing.length&&!cached.length;
 $('error-panel').innerHTML=[missing.length?`${missing.join(' and ')} data could not be loaded. Try Refresh, or check <a href="https://www.weather.gov/beach/chs" target="_blank" rel="noopener noreferrer">NWS Charleston</a> and <a href="https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8666467" target="_blank" rel="noopener noreferrer">NOAA tides</a>.`:'',cached.length?`${cached.join(' and ')} feed unavailable: showing cached data retrieved within the last six hours.`:''].filter(Boolean).join(' ');
 $('source-status').innerHTML=entries.map(([k,s])=>`<div><strong>${labels[k]}:</strong> ${s.status==='unavailable'?'Unavailable':s.status==='stale'?'Source is stale':s.status==='cached'?'Cached fallback':'Retrieved'}${s.retrieved?' · '+escape(fmt(s.retrieved/1000,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})):''}${s.issuedAt?' · issued '+escape(fmt(s.issuedAt,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})):''}</div>`).join('');
}
function renderNow(){
 const target=outlookTarget(),r=currentHour(state.rows,target);
 $('offshore-wave').textContent=num(height(r?.wave),1);
 $('now-label').textContent='';
 $('now-direction').textContent=direction(r?.waveDir)+' waves';
 $('wind-value').textContent=num(speed(r?.wind));
 $('wind-detail').textContent=r&&finite(r.wind)?`${direction(r.windDir)} · ${windType(r.wind,r.windDir)} · gusts ${num(speed(r.gust))} ${su()}`:'Wind data unavailable';
 $('swell-value').textContent=num(height(r?.swell),1);
 $('swell-detail').textContent=r&&finite(r.swell)?`${num(r.swellPeriod,1)} s · from ${direction(r.swellDir)}`:'Swell data unavailable';
 $('air-value').textContent=num(temp(r?.temp));
 $('air-detail').textContent=r?`${weatherLabel(r.code)} · ${num(r.rain)}% rain chance`:'Weather data unavailable';
 const next=state.tides.find(e=>e.t>target);
 $('next-tide').textContent=next?`${next.type==='H'?'High':'Low'} ${timeLabel(next.t)}`:'Unavailable';
 $('next-tide-detail').textContent=next?`${num(tideUnit(next.height),1)} ${hu()} · Folly River North`:'NOAA · Folly River North';
}
function renderDays(){
 if(!state.days.length){$('forecast-title').textContent='Extended forecast';$('days').innerHTML='<div class="empty-message">The forecast is unavailable. Try refreshing.</div>';return;}
 $('forecast-title').textContent=state.days.length+'-day forecast';
 const lastWave=state.rows.filter(r=>finite(r.wave)).at(-1),lastWind=state.rows.filter(r=>finite(r.wind)).at(-1);
 $('forecast-horizon').textContent=[lastWave?'Waves through '+fmt(lastWave.t,{month:'short',day:'numeric'}):'Wave outlook unavailable',lastWind?'wind through '+fmt(lastWind.t,{month:'short',day:'numeric'}):'wind unavailable'].join(' · ');
 $('days').innerHTML=state.days.map((d,i)=>{
  const rows=state.rows.filter(r=>r.day===d),t=rows[0]?.t??state.tides.find(e=>dayKey(e.t)===d)?.t;
  const daylight=rows.filter(r=>r.isDay===1),winds=(daylight.length?daylight:rows).map(r=>r.wind).filter(finite);
  const avg=winds.length?winds.reduce((a,b)=>a+b,0)/winds.length:null;
  const waves=rows.map(r=>r.wave).filter(finite),max=waves.length?Math.max(...waves,.1):1;
  const spark=rows.filter((_,i)=>i%3===0).map(r=>`<i style="height:${finite(r.wave)?Math.max(2,r.wave/max*20):0}px"></i>`).join('');
  return `<button class="day-card ${d===state.day?'active':''}" data-day="${d}" aria-pressed="${d===state.day}" aria-label="${escape(fmt(t,{weekday:'long',month:'short',day:'numeric'}))} forecast"><span class="day-top">${d===dayKey(now())?'Today':fmt(t,{weekday:'short'})}<span aria-hidden="true">${i===0?'↗':''}</span></span><div class="day-date">${fmt(t,{month:'short',day:'numeric'})}</div><div class="day-waves">${waves.length?range(waves)+' <small>'+hu()+'</small>':'<small>Wind outlook</small>'}</div><div class="day-spark" aria-hidden="true">${spark}</div><div class="day-wind">↗ &nbsp; ${num(speed(avg))} ${su()} avg wind</div></button>`;
 }).join('');
}
function renderHourly(){
 const rows=state.rows.filter(r=>r.day===state.day);
 const anchor=rows[0]?.t??state.tides.find(e=>dayKey(e.t)===state.day)?.t;
 $('selected-date').textContent=anchor?fmt(anchor,{weekday:'long',month:'long',day:'numeric'}):'Hourly forecast';
 if(!rows.length){$('hourly-chart').innerHTML='<div class="empty-message">Hourly forecast unavailable for this day.</div>';$('hour-detail').textContent='No hourly data to display.';$('hourly-table').innerHTML='';return;}
 const chartRows=rows.filter((r,i)=>i%2===0),max=Math.max(...rows.map(r=>finite(r.wave)?r.wave:0),.3);
 $('hourly-chart').innerHTML=`<div class="hourly-bars" style="grid-template-columns:repeat(${chartRows.length},1fr)">${chartRows.map(r=>`<button class="hour-column ${r.isDay===0?'night':''} ${r.t===state.hour?'selected':''}" data-hour="${r.t}" aria-label="${escape(timeLabel(r.t))}, waves ${num(height(r.wave),1)} ${hu()}, wind ${num(speed(r.wind))} ${su()}" aria-pressed="${r.t===state.hour}"><div class="bar-area"><div class="bar" style="height:${finite(r.wave)?Math.max(2,r.wave/max*90):0}px"><span class="bar-value">${num(height(r.wave),1)}</span></div></div><span class="hour-label">${timeLabel(r.t)}</span><span class="hour-wind">${windArrow(r.windDir)}${num(speed(r.wind))}</span><span class="wind-strip" style="opacity:${finite(r.wind)?Math.min(1,.25+r.wind/30):0}"></span></button>`).join('')}</div>`;
 const r=rows.find(r=>r.t===state.hour)??rows[0];
 $('hour-detail').innerHTML=`<span class="hour-time">${timeLabel(r.t)} ET</span><span><strong>${num(height(r.wave),1)} ${hu()}</strong> waves at ${num(r.period,1)} s · ${direction(r.waveDir)}</span><span>Wind <strong>${num(speed(r.wind))} ${su()} ${direction(r.windDir)}</strong> · ${windType(r.wind,r.windDir)}</span><span>Gusts ${num(speed(r.gust))} ${su()}</span>`;
 $('hourly-table').hidden=!state.table;$('table-toggle').setAttribute('aria-expanded',state.table);
 $('table-toggle').innerHTML=state.table?'Hide hourly table <span>−</span>':'View hourly table <span>＋</span>';
 $('hourly-table').innerHTML=`<table><caption class="skip-link">Hourly forecast for ${escape($('selected-date').textContent)}, Eastern time</caption><thead><tr><th>Time (ET)</th><th>Waves (${hu()})</th><th>Wave period</th><th>Swell (${hu()})</th><th>Swell period</th><th>Wind (${su()})</th><th>Gust (${su()})</th><th>Rain chance</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${timeLabel(r.t)}</td><td>${num(height(r.wave),1)} ${direction(r.waveDir)}</td><td>${num(r.period,1)} s</td><td>${num(height(r.swell),1)} ${direction(r.swellDir)}</td><td>${num(r.swellPeriod,1)} s</td><td>${num(speed(r.wind))} ${direction(r.windDir)}</td><td>${num(speed(r.gust))}</td><td>${num(r.rain)}%</td></tr>`).join('')}</tbody></table>`;
}
function tideTimeMarkers(start,end,x,bottom,daily){
 const boundaries=easternMidnights(start,end).map(t=>{
  const label=escape(fmt(t,{weekday:'short',month:'short',day:'numeric'})+' · midnight ET');
  return `<g role="img" aria-label="${label}"><title>${label}</title><line x1="${x(t)}" x2="${x(t)}" y1="1" y2="${bottom}" stroke="#91a697" stroke-width="1" stroke-dasharray="3 4"/></g>`;
 }).join('');
 const solar=[];
 for(const [kind,values] of [['Sunrise',daily?.sunrise],['Sunset',daily?.sunset]]){
  for(const t of new Set(values??[]))if(finite(t)&&t>=start&&t<=end){
   const label=escape(kind+' '+timeLabel(t)+' ET · '+fmt(t,{weekday:'short',month:'short',day:'numeric'}));
   const icon=kind==='Sunrise'?'<circle cx="0" cy="0" r="3"/><path d="M0-7V-5M0 5V7M-7 0H-5M5 0H7M-5-5L-3.6-3.6M3.6 3.6L5 5M-5 5L-3.6 3.6M3.6-3.6L5-5"/>':'<path d="M3.4-5.4A6.2 6.2 0 1 0 3.4 5.4A5.7 5.7 0 0 1 3.4-5.4Z"/>';
   solar.push(`<g transform="translate(${x(t)} 9)" role="img" aria-label="${label}" fill="${kind==='Sunrise'?'#fff3c4':'#e5e9ef'}" stroke="${kind==='Sunrise'?'#b18b36':'#71809c'}" stroke-width="1.2" stroke-linecap="round"><title>${label}</title>${icon}</g>`);
  }
 }
 return boundaries+solar.join('');
}
function renderTides(){
 const events=state.tides.filter(e=>dayKey(e.t)===state.day);
 $('tide-day-label').textContent=events[0]?fmt(events[0].t,{weekday:'long',month:'short',day:'numeric'})+' · Eastern time':'Tides for your selected day';
 if(!events.length){$('tide-chart').innerHTML='<div class="empty-message">Tide predictions unavailable for this day.</div>';$('tide-events').innerHTML='';return;}
 const {start,end}=easternDayBounds(state.day);
 const w=540,h=145,left=27,right=12,top=29,bottom=25;
 const samples=[];for(let t=start;t<=end;t+=600){const v=tideHeight(state.tides,t);if(finite(v))samples.push({t,v:tideUnit(v)});}
 const all=[...samples.map(p=>p.v),...events.map(p=>tideUnit(p.height))];
 const low=Math.min(0,...all)-.15,high=Math.max(1,...all)+.3;
 const x=t=>left+(t-start)/(end-start)*(w-left-right),y=v=>h-bottom-(v-low)/(high-low)*(h-top-bottom);
 const points=samples.map(p=>`${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`);
 const line=points.length?'M'+points.join(' L'):'';
 const area=points.length?`${line} L${x(samples.at(-1).t)},${h-bottom} L${x(samples[0].t)},${h-bottom}Z`:'';
 const current=now(),cv=tideHeight(state.tides,current);
 const currentMark=dayKey(current)===state.day&&finite(cv)?`<line x1="${x(current)}" y1="12" x2="${x(current)}" y2="${h-bottom}" stroke="#dc714d" stroke-opacity=".55"/><circle cx="${x(current)}" cy="${y(tideUnit(cv))}" r="4" fill="#dc714d" stroke="#fffefa" stroke-width="2"/>`:'';
 const ticks=[0,.25,.5,.75,1].map(f=>{const t=start+f*(end-start);return `<text x="${x(t)}" y="${h-5}" text-anchor="${f===0?'start':f===1?'end':'middle'}" fill="#647474" font-size="9">${timeLabel(t)}</text>`;}).join('');
 $('tide-chart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Tide curve. Sun marks sunrise; moon marks sunset. Dashed lines mark Eastern midnight. Exact high and low times appear below."><defs><linearGradient id="tide-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b4d1bd" stop-opacity=".5"/><stop offset="1" stop-color="#b4d1bd" stop-opacity=".06"/></linearGradient></defs><line x1="${left}" y1="${h-bottom}" x2="${w-right}" y2="${h-bottom}" stroke="#dfe3d6"/><path d="${area}" fill="url(#tide-fill)"/><path d="${line}" fill="none" stroke="#6c967e" stroke-width="2"/>${events.map(e=>`<circle cx="${x(e.t)}" cy="${y(tideUnit(e.height))}" r="3" fill="#6c967e"/><text x="${x(e.t)}" y="${y(tideUnit(e.height))-9}" text-anchor="middle" fill="#647474" font-size="9">${num(tideUnit(e.height),1)} ${hu()}</text>`).join('')}${currentMark}${tideTimeMarkers(start,end,x,h-bottom,state.sources.weather?.data?.daily)}${ticks}</svg>`;
 $('tide-events').innerHTML=events.map(e=>`<div class="tide-event"><span>${e.type==='H'?'↟ HIGH':'↡ LOW'}</span><strong>${timeLabel(e.t)}</strong><span>${num(tideUnit(e.height),1)} ${hu()}</span></div>`).join('');
 attachTideInspector($('tide-chart'),{points:samples.map(p=>({t:p.t,value:p.v})),plot:{left,right:w-right,top,bottom:h-bottom,width:w,height:h,timeStart:start,timeEnd:end,valueMin:low,valueMax:high},units:hu()});
}
function surfRange(period){
 if(!period||!finite(period.surfMaxFt))return '—';
 const convert=n=>state.units==='metric'?n*.3048:n;
 const digits=state.units==='metric'?1:0;
 if(period.surfQualifier==='less-than')return '< '+num(convert(period.surfMaxFt),digits);
 if(period.surfQualifier==='at-most')return '≤ '+num(convert(period.surfMaxFt),digits);
 const value=range([period.surfMinFt,period.surfMaxFt],convert,digits);
 return period.surfQualifier==='around'?'~ '+value:value;
}
function regionalPeriods(day){
 return sourceUsable(state.sources.nws,now(),24*3600)?state.sources.nws.data.periods.filter(p=>p.day===day):[];
}
function renderRegionalDay(){
 const periods=regionalPeriods(state.day);
 $('regional-day').textContent=periods.length?'NWS regional surf · '+periods.map(p=>`${p.label.toLowerCase()}: ${surfRange(p)} ${hu()}`).join(' · '):'NWS regional surf range unavailable for this day.';
}
function lineChart(rows,{value,width=400,height:chartHeight=110,label,unit='',colour='#63886d',tideMarkers=false,onPlot}={}){
 const values=rows.map(r=>value(r)).filter(finite);
 if(rows.length<2||!values.length)return '<div class="chart-empty">Guidance unavailable</div>';
 const lo=Math.min(0,...values),hi=Math.max(...values,lo+.5),left=10,right=width-10,top=tideMarkers?22:15,bottom=chartHeight-22;
 const first=rows[0].t,last=rows.at(-1).t;
 const x=t=>left+(t-first)/Math.max(1,last-first)*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 let path='',connected=false;
 for(const r of rows){const v=value(r);if(!finite(v)){connected=false;continue;}path+=`${connected?'L':'M'}${x(r.t).toFixed(2)},${y(v).toFixed(2)} `;connected=true;}
 const ticks=[rows[0],rows[Math.floor(rows.length/2)],rows.at(-1)];
 onPlot?.({points:rows.map(r=>({t:r.t,value:value(r)})),plot:{left,right,top,bottom,width,height:chartHeight,timeStart:first,timeEnd:last,valueMin:lo,valueMax:hi}});
 return `<svg viewBox="0 0 ${width} ${chartHeight}" role="img" aria-label="${escape(label)}: ${num(Math.min(...values),1)} to ${num(Math.max(...values),1)} ${unit}, ${escape(timeLabel(first))} to ${escape(timeLabel(last))} Eastern"><line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="#d9e0d4"/><path d="${path}" stroke="${colour}" stroke-width="2.5" fill="none"/>${tideMarkers?tideTimeMarkers(first,last,x,bottom,state.sources.weather?.data?.daily):''}${tideMarkers?'':`<text x="${right}" y="11" text-anchor="end" fill="#526a68" font-size="10">${num(hi,1)} ${unit}</text>`}${ticks.map((r,i)=>`<text x="${x(r.t)}" y="${chartHeight-4}" text-anchor="${i===0?'start':i===2?'end':'middle'}" font-size="10" fill="#526a68">${timeLabel(r.t)}</text>`).join('')}</svg>`;
}
function renderGuidance(){
 if(state.day<dayKey(now()))state.day=dayKey(now());
 const at=now(),target=outlookTarget(at),future=state.day!==dayKey(at),r=currentHour(state.rows,target);
 renderOutlookDays(at,target);
 renderTodayWindow(at);
 const periods=regionalPeriods(state.day);
 const early=Number(fmt(at,{hour:'numeric',hourCycle:'h23'}))<12;
 let surf=null;
 if(future||r?.isDay===1)surf=periods.find(p=>p.timeOfDay==='day')??periods.find(p=>p.timeOfDay==='day-and-night')??null;
 if(!future&&r?.isDay===0){
  const nightPeriods=early?regionalPeriods(dayKey(at-12*3600)):periods;
  surf=nightPeriods.find(p=>p.timeOfDay==='night'||p.timeOfDay==='day-and-night')??null;
 }
 // Show a dated upcoming period when NWS publishes no overnight guidance.
 const upcoming=!future&&sourceUsable(state.sources.nws,at,24*3600)?state.sources.nws.data.periods.find(p=>(p.day>dayKey(at)||(p.day===dayKey(at)&&r?.isDay===0&&early&&['day','day-and-night'].includes(p.timeOfDay)))&&finite(p.surfMaxFt)):null;
 const displayedSurf=surf??upcoming;
 $('now-wave').textContent=surfRange(displayedSurf);
 const surfBounds=[displayedSurf?.surfMinFt,displayedSurf?.surfMaxFt].filter(value=>finite(value)&&value>=0);
 const surfMark=$('surf-mark');
 surfMark.toggleAttribute('hidden',!surfBounds.length);
 if(surfBounds.length){
  const representativeFt=surfBounds.reduce((sum,value)=>sum+value,0)/surfBounds.length;
  const amplitude=Math.min(35,Math.max(0,representativeFt*3.5));
  const crest=46-amplitude;
  surfMark.innerHTML=`<path d="M4 46 C18 46 24 ${crest} 40 ${crest} S62 46 86 46 M4 56 C23 53 29 53 44 56 S70 59 86 56"/>`;
 }else surfMark.innerHTML='';
 $('surf-scope').textContent='NWS · Charleston County beaches, including Folly';
 const nws=state.sources.nws;
 $('surf-issued').textContent=nws?.issuedAt?`Issued ${fmt(nws.issuedAt,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} ET${nws.status==='fresh'?'':' · '+nws.status}`:'Regional surf forecast unavailable';
 $('now-label').textContent=displayedSurf?`${displayedSurf.label} · ${surf?'NWS forecast':'next forecast'}`:'NWS forecast unavailable';
 $('rip-risk').textContent=`Rip current risk (NWS): ${displayedSurf?.ripRisk??'Unavailable'}`;
 const nwps=state.sources.nwps,usable=sourceUsable(nwps,at,18*3600);
 const point=usable?nwps.data.points.find(p=>p.id===state.area):null;
 const bounds=easternDayBounds(state.day),chartStart=future?bounds.start:Math.floor(at/3600)*3600,chartEnd=future?bounds.end:at+24*3600;
 const near=currentHour(point?.rows??[],target),chartRows=(point?.rows??[]).filter(p=>p.t>=chartStart&&p.t<chartEnd);
 const areas=evaluateNearshoreAreas(state.sources,state.rows,target,at);
 const outlook=areas.find(area=>area.id===state.area).outlook;
 renderNearshoreLeaders($('nearshore-areas'),areas,{future});
 $('outlook-rating').textContent=outlook.label;$('outlook-meter').dataset.level=outlook.level;
 const scoreRange=outlook.scoreRange;
 $('outlook-score').textContent=finite(outlook.score)?outlook.score:scoreRange?`${scoreRange.min}–${scoreRange.max}`:'—';
 $('outlook-score').dataset.range=String(!!scoreRange);
 const cached=state.sources.weather?.status==='cached'||(near&&nwps?.status==='cached');
 $('outlook-confidence').textContent=[outlook.confidence==='Model outlook'?'':outlook.confidence,cached?'Cached forecast':''].filter(Boolean).join(' · ');
 $('outlook-reason').textContent=outlook.reason;

 $('nearshore-wave').textContent=num(height(near?.waveM),1);
 $('nearshore-period').textContent=num(near?.peakPeriodS,1)+' s peak period';
 $('nearshore-time-label').textContent=future?outlookDayName(at)+' · ET':'Next 24 hours · ET';
 $('nearshore-chart').innerHTML=lineChart(chartRows,{value:p=>height(p.waveM),width:Math.max(160,$('nearshore-chart').clientWidth||400),label:'Nearshore significant wave height · '+$('nearshore-time-label').textContent,unit:hu()});
 $('nearshore-point').textContent=point?'NOAA · '+point.label:'NOAA nearshore forecast';
 $('nearshore-source').textContent=nwps?.issuedAt?`Cycle ${fmt(nwps.issuedAt,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} ET · ${nwps.status}`:'Nearshore model unavailable';
 renderCompassPanel();
 const tideRows=[];for(let t=future?bounds.start:at-3*3600;t<=(future?bounds.end:at+21*3600);t+=900)tideRows.push({t,v:tideUnit(tideHeight(state.tides,t))});
 let miniInspection;
 $('mini-tide-chart').innerHTML=lineChart(tideRows,{value:p=>p.v,width:Math.max(120,$('mini-tide-chart').clientWidth||300),height:68,label:'Folly River tide curve. Sun marks sunrise; moon marks sunset. Dashed lines mark midnight',unit:hu(),tideMarkers:true,onPlot:plot=>{miniInspection=plot;}});
 attachTideInspector($('mini-tide-chart'),{...miniInspection,units:hu()});
 const buoy=state.sources.buoy?.data,wave=buoy?.latestWave,water=buoy?.latestWater;
 const waveFresh=wave&&at-wave.t>=0&&at-wave.t<=3*3600;
 const waterFresh=water&&at-water.t>=0&&at-water.t<=3*3600;
 $('buoy-wave').textContent=num(height(waveFresh?wave.waveM:null),1);
 $('buoy-period').textContent=num(waveFresh?wave.dominantPeriodS:null,1)+' s';
 const observedPeriod=waveFresh&&finite(wave.dominantPeriodS)&&wave.dominantPeriodS>0?wave.dominantPeriodS:null;
 $('observed-wave-period').textContent=num(observedPeriod,1);
 $('observed-wave-period-time').textContent=observedPeriod!==null?'Measured '+timeLabel(wave.t)+' ET':'No recent period measurement';
 $('buoy-direction').textContent=direction(waveFresh?wave.waveDirectionDeg:null);
 $('buoy-observed').textContent=wave?`Measured ${fmt(wave.t,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} ET`:'No recent wave measurement';
 $('buoy-status').textContent=waveFresh?'Observed offshore':wave?'Stale · hidden':'Unavailable';
 $('buoy-water').textContent=num(waterFresh?(state.units==='metric'?water.waterC:water.waterC*9/5+32):null);
 $('buoy-water-time').textContent=waterFresh?'Measured '+timeLabel(water.t)+' ET · offshore':'No recent water-temperature observation';
 document.querySelectorAll('[data-current-observation]').forEach(element=>element.hidden=future);
 document.querySelector('.conditions-details').classList.toggle('forecast-details',future);
 renderRegionalDay();
}
async function loadTraffic(){
 if(state.trafficLoading)return;
 if(document.hidden)return;
 const destination=$('traffic-destination').value;
 const old=state.traffic;
 if(old?.destination===destination&&Date.now()<Date.parse(old.expiresAt)-30000)return;
 state.trafficLoading=true;
 try{
  const r=await fetch('/api/traffic?'+new URLSearchParams({destination}),{cache:'no-store',signal:AbortSignal.timeout(35000)});
  if(!r.ok)throw Error('Unavailable');
  const data=await r.json();if(destination===$('traffic-destination').value)state.traffic=data;
 }catch{if(destination===$('traffic-destination').value)state.traffic={status:'unavailable',destination};}
 finally{state.trafficLoading=false;renderTraffic();if(destination!==$('traffic-destination').value)loadTraffic();}
}
function renderTraffic(){
 const payload=state.traffic,at=Date.now();
 const fresh=['ready','partial'].includes(payload?.status)&&at>=Date.parse(payload.retrievedAt)-30000&&at<Date.parse(payload.expiresAt);
 document.querySelectorAll('[data-route]').forEach(card=>{
  const route=fresh?payload.routes?.find(r=>r.id===card.dataset.route&&r.status==='ready'):null;
  card.dataset.congestion=route?.congestion??'unknown';
  card.querySelector('.traffic-duration').textContent=route?.etaMinutes?`${route.etaMinutes.low}–${route.etaMinutes.high} minutes`:'— minutes';
  const labels={green:'Typical traffic',yellow:'Some delays',red:'Heavy delays',unknown:'Baseline unavailable'};
  card.querySelector('.traffic-delay').textContent=route?labels[route.congestion]+(finite(route.delaySeconds)?` · +${Math.round(route.delaySeconds/60)} min`:''):'Live estimate unavailable';
  card.querySelector('.traffic-updated').textContent=route?'Updated '+timeLabel(Date.parse(payload.retrievedAt)/1000)+' ET':state.trafficLoading?'Updating…':payload?.status==='not_configured'?'Provider not connected':'Awaiting current traffic';
 });
 $('traffic-status').textContent=fresh?'Live traffic · updates every 10 minutes':payload?.status==='not_configured'?'Live traffic estimates are unavailable.':'Live traffic estimates are unavailable. Directions links still work.';
 $('traffic-updated').textContent='';
 $('traffic-baseline').textContent='Colours show delays against travel without traffic.';
 $('traffic-provider').textContent=payload?.attribution??'Traffic provider not connected';
}
function sessionForDay(day,at){
 const nearshoreFresh=sourceUsable(state.sources.nwps,at,18*3600);
 const point=nearshoreFresh?state.sources.nwps.data.points.find(p=>p.id===state.area):null;
 return rankSessionWindows({rows:state.rows,nearshoreRows:point?.rows??[],daily:state.sources.weather?.data?.daily,now:at,day,weatherFresh:sourceUsable(state.sources.weather,at,6*3600),nearshoreFresh,tides:state.tides});
}
function outlookTarget(at=now()){
 const day=state.day??dayKey(at);
 return forecastTarget(day,at,state.rows,day===dayKey(at)?null:sessionForDay(day,at).best?.start);
}
function outlookDayName(at=now()){
 const days=quickForecastDays(at);
 return state.day===days.today?'Today':state.day===days.tomorrow?'Tomorrow':fmt(easternDayBounds(state.day).start,{weekday:'short',month:'short',day:'numeric'});
}
function renderOutlookDays(at,target){
 const days=quickForecastDays(at);
 document.querySelectorAll('[data-outlook-day]').forEach(button=>button.setAttribute('aria-pressed',String(state.day===days[button.dataset.outlookDay])));
 const label=outlookDayName(at),hasHour=!!currentHour(state.rows,target);
 $('outlook-day-context').textContent=label+' · '+(state.day===days.today?'current forecast':hasHour?timeLabel(target)+' ET forecast':'hourly forecast unavailable');
}
function selectForecastDay(day){
 state.day=day;
 const rows=state.rows.filter(r=>r.day===day);
 state.hour=(currentHour(rows,outlookTarget())??rows[0])?.t??null;
 renderNow();renderGuidance();renderDays();renderHourly();renderTides();renderWindow();
}
function renderTodayWindow(at){
 const today=dayKey(at),day=state.day??today,ranked=sessionForDay(day,at),best=ranked.best;
 const label=outlookDayName(at);
 $('today-window-label').textContent=label.toUpperCase()+'’S BEST WINDOW';
 const basis=$('today-window-basis');
 basis.dataset.level=String(best?.level??0);
 if(!best){
  const sunset=state.sources.weather?.data?.daily?.sunset?.find(t=>finite(t)&&dayKey(t)===day);
  $('today-window-time').textContent=day===today&&finite(sunset)&&at>=sunset?'No daylight window remains today.':'No complete window available '+(day===today?'today':label==='Tomorrow'?'tomorrow':'for this day')+'.';
  basis.textContent='';return;
 }
 $('today-window-time').textContent=timeLabel(best.start)+'–'+timeLabel(best.end)+' ET';
 basis.textContent=ranked.status==='rated'?best.score+'/100 · '+best.label:'Lightest winds · '+num(speed(best.avgWind))+' '+su()+' avg';
}
function renderWindow(){
 const at=now();
 const daily=state.sources.weather?.data?.daily;
 const rise=daily?.sunrise?.find(t=>finite(t)&&dayKey(t)===state.day),set=daily?.sunset?.find(t=>finite(t)&&dayKey(t)===state.day);
 const ranked=sessionForDay(state.day,at);
 const dayBounds=easternDayBounds(state.day);
 $('window-date').textContent=dayBounds?fmt(dayBounds.start,{weekday:'long',month:'short',day:'numeric'})+' · Eastern time':state.day;
 const window=ranked.best;
 $('sunrise').textContent='Sunrise '+(finite(rise)?timeLabel(rise):'—');$('sunset').textContent='Sunset '+(finite(set)?timeLabel(set):'—');
 $('window-title').textContent=ranked.status==='wind-only'?'Lightest daylight winds':'Best session window';
 if(!window){$('window-time').textContent='No window ahead';$('window-stats').innerHTML='';$('window-description').textContent=ranked.reason;return;}
 $('window-time').textContent=timeLabel(window.start)+'–'+timeLabel(window.end);
 const stats=[`<span>${num(speed(window.avgWind))} ${su()} avg wind</span>`];
 if(ranked.status==='rated'){
  stats.unshift(`<span class="window-rating" data-level="${window.level}">${window.score}/100 · ${escape(window.label)}</span>`);
  stats.push(`<span>${range([window.waveRangeM.min,window.waveRangeM.max])} ${hu()} nearshore</span>`);
  const periods=[window.periodRangeS.min,window.periodRangeS.max].map(p=>num(p,1));
  stats.push(`<span>${periods[0]===periods[1]?periods[0]:periods.join('–')} s peak period</span>`);
 }
 if(finite(window.maxGust))stats.push(`<span>Gusts ${num(speed(window.maxGust))} ${su()}</span>`);
 $('window-stats').innerHTML=stats.join('');
 $('window-description').textContent=[window.outlookReason,window.explanation,ranked.reason].filter(Boolean).join(' ');
}
$('verify-button').addEventListener('click',async()=>{
 $('verify-button').disabled=true;$('verification-status').textContent='Checking archived forecasts…';
 try{const response=await fetch('/api/verification',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Unavailable');const result=await response.json();
 $('verification-status').innerHTML=result.bins?.some(b=>b.count)?result.bins.filter(b=>b.count).map(b=>`<div><strong>${escape(b.label)}:</strong> ${b.count} matched hours · mean absolute error ${num(height(b.meanAbsoluteErrorM),1)} ${hu()} · bias ${num(height(b.meanBiasM),1)} ${hu()}</div>`).join('')+'<p>Edisto buoy comparison · lead time from forecast retrieval.</p>':'No matched forecast history yet. Forecasts must be saved before the matching buoy observation exists. '+(result.archive?.message??'');
 }catch{$('verification-status').textContent='The forecast archive is temporarily unavailable. Try again shortly.';}finally{$('verify-button').disabled=false;}
});
document.querySelectorAll('[data-nearshore-area]').forEach(button=>button.addEventListener('click',()=>{
 state.area=button.dataset.nearshoreArea;
 document.querySelectorAll('[data-nearshore-area]').forEach(area=>area.setAttribute('aria-pressed',String(area===button)));
 renderNow();
 renderGuidance();
 renderWindow();
}));
$('traffic-destination').addEventListener('change',()=>{
 state.traffic=null;renderTraffic();loadTraffic();
 const destination=$('traffic-destination').value==='washout'?'1563 E Ashley Avenue, Folly Beach, SC 29439':'101 E Arctic Avenue, Folly Beach, SC 29439';
 document.querySelectorAll('[data-route]').forEach(link=>{
  link.href='https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',origin:link.dataset.origin,destination,travelmode:'driving'});
 });
});
$('units').addEventListener('click' ,()=>{state.units=state.units==='imperial'?'metric':'imperial';try{localStorage.setItem('folly-units',state.units);}catch{}render();});
$('refresh').addEventListener('click',()=>{load(true);state.traffic=null;loadTraffic();});
$('outlook-days').addEventListener('click',event=>{const button=event.target.closest('[data-outlook-day]');if(button)selectForecastDay(quickForecastDays(now())[button.dataset.outlookDay]);});
$('days').addEventListener('click',event=>{const button=event.target.closest('[data-day]');if(button)selectForecastDay(button.dataset.day);});
$('hourly-chart').addEventListener('click',event=>{const button=event.target.closest('[data-hour]');if(!button)return;state.hour=Number(button.dataset.hour);const scroll=$('hourly-chart').scrollLeft;renderHourly();$('hourly-chart').scrollLeft=scroll;$('hourly-chart').querySelector(`[data-hour="${state.hour}"]`)?.focus({preventScroll:true});});
$('table-toggle').addEventListener('click',()=>{state.table=!state.table;renderHourly();});
const dialog=$('method-dialog');document.querySelectorAll('[data-open-method]').forEach(b=>b.addEventListener('click',()=>dialog.showModal()));$('close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
setInterval(()=>{if(!document.hidden){load();loadTraffic();}},20*60*1000);
setInterval(()=>{if(!document.hidden)loadTraffic();},10*60*1000);
setInterval(()=>{renderUnits();renderNow();renderGuidance();renderWindow();renderTraffic();},60000);
window.addEventListener('resize',()=>renderGuidance());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){load();loadTraffic();}});
const historyUI=initHistory({getRows:()=>state.rows,getUnits:()=>state.units,getRetrievedAt:()=>state.sources.marine?.retrievedAt});
renderUnits();load();loadTraffic();initSpectra();initCoastal();

