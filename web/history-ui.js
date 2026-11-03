import {finite,fmt,easternDayBounds,dayKey} from './data.js';
const stamp=t=>fmt(t,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET';
export function historySelection(snapshots,target,start,end){
 return snapshots.filter(s=>finite(s.retrievedAt)&&s.retrievedAt>=start&&s.retrievedAt<end&&s.retrievedAt<target&&finite(s.recordedAt)&&s.recordedAt<target&&s.comparison?.forecastAt===target&&finite(s.comparison.values?.wave_height)).sort((a,b)=>a.retrievedAt-b.retrievedAt);
}
export function waveChange(previous,current,metric=false){
 if(!finite(previous)||!finite(current))return null;
 const delta=(current-previous)*(metric?1:3.280839895);
 return Math.abs(delta)<.05?'Wave height is unchanged':`Waves are forecast ${Math.abs(delta).toFixed(1)} ${metric?'m':'ft'} ${delta>0?'higher':'lower'}`;
}
export function initHistory({getRows,getUnits,getRetrievedAt=()=>null}){
 const $=id=>document.getElementById(id),target=$('revision-target'),lookback=$('revision-lookback'),status=$('revision-status'),cards=$('revision-cards'),more=$('revision-more');
 let previousRows=null,snapshots=[],pages=[],request=0,range=null,loadedTarget=null;
 const current=()=>getRows().find(r=>r.t===Number(target.value));
 function render(){
  cards.replaceChildren();
  if(!range||loadedTarget!==Number(target.value))return;
  const row=current(),eligible=historySelection(snapshots,Number(target.value),range.start,range.end),old=eligible[0];
  if(!old||!finite(row?.wave)){
   status.textContent='No earlier forecast was saved for this time '+(lookback.value==='yesterday'?'yesterday.':'today.')+' Try another time or comparison period. History builds as forecasts are saved.';return;
  }
  const metric=getUnits()==='metric',scale=metric?1:3.280839895,unit=metric?'m':'ft',value=old.comparison.values.wave_height;
  if(eligible.length===1&&finite(getRetrievedAt())&&Math.abs(old.retrievedAt-getRetrievedAt())<1&&Math.abs(value-row.wave)<.00001){status.textContent=`First forecast saved ${stamp(old.retrievedAt)}. Changes will appear as new forecasts arrive.`;return;}
  status.textContent=`${waveChange(value,row.wave,metric)} since ${stamp(old.retrievedAt)}.`;
  for(const [label,wave,period,note] of [['Earlier forecast',value,old.comparison.values.wave_period,stamp(old.retrievedAt)],['Latest forecast',row.wave,row.period,'For '+stamp(row.t)]]){
   const card=document.createElement('div');card.className='revision-card';
   const heading=document.createElement('span');heading.textContent=label;
   const number=document.createElement('strong');number.textContent=(wave*scale).toFixed(1)+' '+unit;
   const detail=document.createElement('span');detail.textContent=finite(period)?period.toFixed(1)+' s wave period':'Wave period unavailable';
   const saved=document.createElement('small');saved.textContent=note;
   card.append(heading,number,detail,saved);cards.append(card);
  }
 }
 function datesForRange(start,end){const dates=[];for(let t=Math.floor(start/86400)*86400;t<end;t+=86400)dates.push(new Date(t*1000).toISOString().slice(0,10));return dates;}
 async function load(append=false){
  if(!current())return;
  const token=++request,validAt=Number(target.value);loadedTarget=null;cards.replaceChildren();status.textContent='Checking earlier forecasts…';more.hidden=true;
  if(!append){
   const today=dayKey(Date.now()/1000),todayBounds=easternDayBounds(today);
   range=lookback.value==='yesterday'?easternDayBounds(dayKey(todayBounds.start-1)):todayBounds;
   snapshots=[];pages=datesForRange(range.start,Math.min(range.end,Date.now()/1000)).map(date=>({date,cursor:null}));
  }
  $('revision-refresh').disabled=true;
  try{
   const results=await Promise.all(pages.map(async page=>{
    const response=await fetch('/api/history?'+new URLSearchParams({date:page.date,source:'marine',validAt:String(validAt),limit:'8',...(page.cursor?{cursor:page.cursor}:{})}),{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Unavailable');const payload=await response.json();if(payload.status==='unavailable')throw Error('Unavailable');return {page,payload};
   }));
   if(token!==request)return;
   snapshots.push(...results.flatMap(r=>r.payload.snapshots??[]));
   snapshots=[...new Map(snapshots.map(s=>[s.id,s])).values()];
   pages=results.filter(r=>r.payload.truncated&&r.payload.cursor).map(r=>({date:r.page.date,cursor:r.payload.cursor}));
   loadedTarget=validAt;render();more.hidden=!pages.length;
  }catch{if(token===request){status.textContent='Saved forecasts are temporarily unavailable. Try again shortly.';cards.replaceChildren();}}
  finally{if(token===request)$('revision-refresh').disabled=false;}
 }
 function update(){
  const rows=getRows(),future=rows.filter(r=>r.t>Date.now()/1000&&finite(r.wave));
  if(!future.length){cards.replaceChildren();more.hidden=true;status.textContent='Forecast history will be available when wave forecasts load.';return;}
  if(previousRows!==rows){
   previousRows=rows;const prior=Number(target.value),preferred=future.find(r=>r.isDay===1&&Number(fmt(r.t,{hour:'numeric',hourCycle:'h23'}))>=8)??future.find(r=>r.t>=Date.now()/1000+12*3600)??future[0];
   const choices=future.filter((r,i)=>i%3===0||r.t===prior||r.t===preferred.t);target.replaceChildren();
   for(const r of choices){const option=document.createElement('option');option.value=r.t;option.textContent=stamp(r.t);target.append(option);}
   target.value=String(choices.some(r=>r.t===prior)?prior:preferred.t);load();
  }else render();
 }
 target.addEventListener('change',()=>load());lookback.addEventListener('change',()=>load());$('revision-refresh').addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));
 return {update};
}
