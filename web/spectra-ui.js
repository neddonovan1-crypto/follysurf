import {finite,fmt,direction} from './data.js';
import {summarizeSpectralEnergy} from './spectral-energy.js';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(value,digits=2)=>finite(value)?value.toFixed(digits):'—';
function spectrumChart(bins){
 const valid=bins.filter(b=>finite(b.frequencyHz)&&b.frequencyHz>0);
 const measured=valid.filter(b=>finite(b.densityM2PerHz)&&b.densityM2PerHz>=0);
 if(!measured.length)return '<p class="spectral-empty">Wave measurements are unavailable.</p>';
 const width=760,height=220,left=20,right=20,top=42,bottom=48;
 const low=Math.min(...valid.map(b=>b.frequencyHz)),high=Math.max(...valid.map(b=>b.frequencyHz));
 const max=Math.max(...measured.map(b=>b.densityM2PerHz),.01)*1.08;
 const x=f=>left+(f-low)/Math.max(high-low,.001)*(width-left-right),y=d=>height-bottom-d/max*(height-top-bottom);
 const peak=measured.reduce((best,b)=>b.densityM2PerHz>0&&(!best||b.densityM2PerHz>best.densityM2PerHz)?b:best,null);
 let path='',connected=false;
 for(const bin of valid){if(!finite(bin.densityM2PerHz)||bin.densityM2PerHz<0){connected=false;continue;}path+=`${connected?'L':'M'}${x(bin.frequencyHz).toFixed(2)},${y(bin.densityM2PerHz).toFixed(2)} `;connected=true;}
 const levels=[0,.5,1].map(r=>`<line x1="${left}" x2="${width-right}" y1="${y(max*r)}" y2="${y(max*r)}" class="spectral-grid"/>`).join('');
 const ticks=[20,10,6,4,3,2.5].filter(period=>1/period>=low&&1/period<=high).map(period=>`<text x="${x(1/period)}" y="${height-27}" text-anchor="middle" class="spectral-period-tick">${period} sec</text>`).join('');
 const points=measured.map(b=>`<circle cx="${x(b.frequencyHz)}" cy="${y(b.densityM2PerHz)}" r="1.8"><title>${number(1/b.frequencyHz,1)} seconds between waves · ${number(b.densityM2PerHz,3)} m²/Hz${finite(b.meanDirectionDeg)?' · from '+direction(b.meanDirectionDeg):''}</title></circle>`).join('');
 const marker=peak?`<line class="spectral-peak-guide" x1="${x(peak.frequencyHz)}" x2="${x(peak.frequencyHz)}" y1="27" y2="${height-bottom}"/><circle class="spectral-peak" cx="${x(peak.frequencyHz)}" cy="${y(peak.densityM2PerHz)}" r="5"/><text x="${Math.max(125,Math.min(width-125,x(peak.frequencyHz)))}" y="18" text-anchor="middle" class="spectral-peak-label">Strongest: ${number(1/peak.frequencyHz,1)} sec</text>`:'';
 return `<svg viewBox="0 0 ${width} ${height}" tabindex="0" data-spectral-plot role="img" aria-label="Waves measured at Edisto buoy. The highlighted peak shows the strongest period. Longer gaps between waves are on the left, shorter gaps on the right. A higher line means more energy at that frequency.">${levels}${ticks}<path d="${path}" class="spectral-line"/>${points}${marker}<g class="spectral-cursor" hidden><line y1="${top}" y2="${height-bottom}"/><circle r="5"/></g><text x="${left}" y="${height-5}" class="spectral-axis-title">Longer gaps between waves</text><text x="${width-right}" y="${height-5}" text-anchor="end" class="spectral-axis-title">Shorter gaps between waves</text></svg>`;
}
function bindSpectrumExplorer(content,bins){
 const svg=content.querySelector('[data-spectral-plot]'),tooltip=content.querySelector('.spectral-tooltip');
 if(!svg||!tooltip)return;
 const valid=bins.filter(b=>finite(b.frequencyHz)&&b.frequencyHz>0);
 const measured=valid.filter(b=>finite(b.densityM2PerHz)&&b.densityM2PerHz>=0);
 if(!measured.length)return;
 const low=Math.min(...valid.map(b=>b.frequencyHz)),high=Math.max(...valid.map(b=>b.frequencyHz));
 const max=Math.max(...measured.map(b=>b.densityM2PerHz),.01)*1.08;
 const x=f=>20+(f-low)/Math.max(high-low,.001)*720,y=d=>172-d/max*130;
 const cursor=svg.querySelector('.spectral-cursor');let selected=-1;
 function show(index){
  selected=Math.max(0,Math.min(measured.length-1,index));const bin=measured[selected],px=x(bin.frequencyHz),py=y(bin.densityM2PerHz);
  cursor.removeAttribute('hidden');const line=cursor.querySelector('line'),dot=cursor.querySelector('circle');
  line.setAttribute('x1',px);line.setAttribute('x2',px);dot.setAttribute('cx',px);dot.setAttribute('cy',py);
  tooltip.hidden=false;tooltip.innerHTML=`<strong>Waves ~${number(1/bin.frequencyHz,1)} sec apart</strong><span>${finite(bin.meanDirectionDeg)?'From '+escape(direction(bin.meanDirectionDeg))+' · ':''}${number(bin.densityM2PerHz,3)} m²/Hz</span>`;
 }
 function point(event){
  const matrix=svg.getScreenCTM();if(!matrix)return;
  const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const local=p.matrixTransform(matrix.inverse());
  let nearest=0;for(let i=1;i<measured.length;i++)if(Math.abs(x(measured[i].frequencyHz)-local.x)<Math.abs(x(measured[nearest].frequencyHz)-local.x))nearest=i;
  show(nearest);
 }
 svg.addEventListener('pointermove',point);svg.addEventListener('pointerdown',point);
 svg.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
  show(event.key==='Home'?0:event.key==='End'?measured.length-1:selected<0?0:selected+(event.key==='ArrowRight'?1:-1));
 });
}
function waveMixMarkup(bins){
 const mix=summarizeSpectralEnergy(bins);
 if(!mix.usable){
  const message=mix.status==='partial'?'Some wave measurements are missing, so the energy mix is unavailable.':mix.status==='zero'?'No positive wave energy was reported in this reading.':'The energy mix is unavailable for this reading.';
  return `<p class="wave-mix-empty">${message}</p>`;
 }
 const labels={short:'< 8 seconds',medium:'8–12 seconds',long:'12+ seconds'};
 // Largest-remainder rounding keeps the three displayed shares at exactly 100%.
 const rounded=mix.groups.map(g=>Math.floor(g.sharePercent));
 const order=mix.groups.map((g,i)=>({i,remainder:g.sharePercent-rounded[i]})).sort((a,b)=>b.remainder-a.remainder);
 const remainder=100-rounded.reduce((sum,value)=>sum+value,0);
 for(let i=0;i<remainder;i++)rounded[order[i%order.length].i]++;
 const leading=mix.groups.reduce((best,g)=>!best||g.sharePercent>best.sharePercent?g:best,null);
 const leadIndex=mix.groups.indexOf(leading),majority=leading.sharePercent>50;
 const headline=majority?`${labels[leading.id]} between waves`:'A mix of wave periods';
 const summary=majority?`${rounded[leadIndex]}% of measured wave energy falls in this range.`:'Measured energy is spread across several wave periods.';
 return `<h3 class="wave-mix-heading">${escape(headline)}</h3><p class="wave-mix-summary">${summary}</p><div class="wave-mix-bars" aria-label="Share of measured wave energy by period">${mix.groups.map((g,i)=>`<div class="wave-mix-row" data-period-group="${g.id}"><div class="wave-mix-label">${escape(labels[g.id])}<small>between waves</small></div><div class="wave-mix-track" aria-hidden="true"><span class="wave-mix-fill" style="width:${g.sharePercent}%"></span></div><span class="wave-mix-percent" aria-label="${rounded[i]} percent of measured energy">${rounded[i]}%</span></div>`).join('')}</div><p class="wave-mix-lesson">Period is the time between wave crests. These bars split the buoy’s measured wave energy into three groups; a longer bar means a bigger share.</p>`;
}
function renderSpectra(section,payload){
 const bins=Array.isArray(payload?.bins)?payload.bins:[];
 const usable=bins.some(b=>finite(b.densityM2PerHz)&&b.densityM2PerHz>=0);
 const status=section.querySelector('[data-spectral-status]'),content=section.querySelector('[data-spectral-content]');
 if(payload?.status==='unavailable'||!usable){status.textContent='Wave measurements from Edisto buoy are unavailable right now.';content.innerHTML='';return;}
 const time=finite(payload.observedAt)?fmt(payload.observedAt,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'Time unavailable';
 status.textContent=`${payload.status==='stale'?'Stale reading':'Measured'} ${time}`;
 const peak=finite(payload.peakPeriodSeconds)?number(payload.peakPeriodSeconds,1):null;
 const from=finite(payload.peakDirectionDeg)?' from '+direction(payload.peakDirectionDeg):'';
 const mix=waveMixMarkup(bins);
 const facts=peak?`<div class="wave-mix-facts"><span>Strongest period <strong>${peak} sec</strong></span>${from?`<span>At that period <strong>${escape(from.trim())}</strong></span>`:''}</div>`:'';
 content.innerHTML=`${mix}${facts}<details class="spectral-explorer"><summary>Explore wave periods</summary><p class="spectral-reading-guide">Hover, tap or use the arrow keys to explore individual readings. Peaks show the strongest periods.</p><div class="spectral-chart">${spectrumChart(bins)}<output class="spectral-tooltip" aria-live="polite" hidden></output></div><details class="spectral-data"><summary>Technical details &amp; measurements</summary><p class="spectral-technical">Shares show how measured wave energy is distributed across fixed period ranges within the reported frequencies. The groups are less than 8 seconds, 8 to less than 12 seconds, and 12 seconds or longer. Energy is summed using NOAA’s published frequency-band widths, splitting bands at the group boundaries. The chart uses a linear frequency scale (Hz), with labels converted to seconds (1 ÷ frequency). Its vertical scale is spectral energy density in m²/Hz. Mean directions describe where waves come from, clockwise from true north. Missing measurements appear as gaps.</p><div class="spectral-table"><table><caption>Edisto buoy · ${escape(time)} · ${bins.length} frequency bins${payload.missingBins?' · '+payload.missingBins+' missing measurements':''}</caption><thead><tr><th>Frequency (Hz)</th><th>Period (s)</th><th>Density (m²/Hz)</th><th>Mean direction</th></tr></thead><tbody>${bins.map(b=>`<tr><td>${number(b.frequencyHz,3)}</td><td>${number(b.periodSeconds,1)}</td><td>${number(b.densityM2PerHz,3)}</td><td>${finite(b.meanDirectionDeg)?escape(direction(b.meanDirectionDeg))+' · '+number(b.meanDirectionDeg,0)+'°':'—'}</td></tr>`).join('')}</tbody></table></div></details></details>`;

 bindSpectrumExplorer(content,bins);
}
export function initSpectra(){
 const section=document.getElementById('spectral-section');if(!section)return;
 const refresh=section.querySelector('[data-spectral-refresh]');let loading=false,started=false;
 async function load(){
  if(loading)return;loading=true;started=true;refresh.disabled=true;section.querySelector('[data-spectral-status]').textContent='Loading wave measurements…';
  try{const response=await fetch('/api/spectra',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');renderSpectra(section,await response.json());}
  catch{renderSpectra(section,{status:'unavailable'});}finally{loading=false;refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!started){observer.disconnect();load();}},{rootMargin:'160px'});observer.observe(section);}else load();
}
