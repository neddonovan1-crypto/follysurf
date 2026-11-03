import {finite,fmt,direction} from './data.js';
const number=(value,digits=1)=>finite(value)?value.toFixed(digits):'—';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function measuredTime(source){
 const at=source?.latest?.observedAt??source?.observedAt;
 if(!finite(at))return '<span class="coastal-unavailable">Measurement time unavailable</span>';
 const label=fmt(at,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET';
 return `<time datetime="${new Date(at*1000).toISOString()}">${source.status==='stale'?'Stale · ':'Measured '}${escape(label)}</time>`;
}
function renderCoastal(panel,payload){
 const status=panel.querySelector('[data-coastal-status]'),content=panel.querySelector('[data-coastal-content]');
 if(!payload||payload.status==='unavailable'){status.textContent='Charleston coastal measurements are unavailable right now.';content.innerHTML='';return;}
 const metric=document.getElementById('units')?.textContent.includes('°C');
 const water=payload.sources?.waterLevel,wind=payload.sources?.wind;
 const level=water?.latest?.levelM,air=wind?.latest;
 const waterUsable=['fresh','stale'].includes(water?.status)&&finite(level),windUsable=['fresh','stale'].includes(wind?.status)&&finite(air?.speedMs);
 status.textContent=payload.status==='partial'?'Some measurements are unavailable.':'Latest harbor measurements';
 const height=waterUsable?number(level*(metric?1:3.280839895))+' '+(metric?'m':'ft'):'Unavailable';
 const speedFactor=metric?3.6:2.236936292,speedUnit=metric?'km/h':'mph';
 const windSpeed=windUsable?number(air.speedMs*speedFactor)+' '+speedUnit:'Unavailable';
 const waterMarkup=`<article class="coastal-reading"><h4>Measured water level</h4><strong>${height}</strong><p>MLLW · Charleston station datum${waterUsable&&water.latest.quality==='preliminary'?' · Preliminary':''}</p>${waterUsable?measuredTime(water):''}</article>`;
 const windMarkup=`<article class="coastal-reading"><h4>Measured coastal wind</h4><strong>${windSpeed}</strong>${windUsable?`<p>${finite(air.directionDeg)?'From '+escape(direction(air.directionDeg))+' · ':''}${finite(air.gustMs)?'Gusts '+number(air.gustMs*speedFactor)+' '+speedUnit:''}</p>${measuredTime(wind)}`:''}</article>`;
 content.innerHTML=`<div class="coastal-readings">${waterMarkup}${windMarkup}</div>`;
}
export function initCoastal(){
 const panel=document.getElementById('coastal-section');if(!panel)return;
 const button=panel.querySelector('[data-coastal-refresh]');let loading=false,payload=null,lastLoaded=0;
 async function load(){
  if(loading)return;loading=true;button.disabled=true;panel.querySelector('[data-coastal-status]').textContent='Loading Charleston measurements…';
  try{const response=await fetch('/api/coastal',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');payload=await response.json();lastLoaded=Date.now();renderCoastal(panel,payload);}
  catch{payload=null;renderCoastal(panel,null);}finally{loading=false;button.disabled=false;}
 }
 panel.addEventListener('toggle',()=>{if(panel.open&&(!payload||Date.now()-lastLoaded>300000))load();});
 button.addEventListener('click',load);
 document.getElementById('units')?.addEventListener('click',()=>queueMicrotask(()=>{if(payload)renderCoastal(panel,payload);}));
}
