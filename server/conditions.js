import {collectForecastSources} from './forecast.js';
import {archiveHistory} from './history.js';
import {buoyForecastURL,createBuoySnapshot,compareSnapshots} from './verification.js';

const TTL=20*60;
const CACHE_KEY='cache/conditions-v2.json';
let memory=null,pending=null;
const stamp=()=>Date.now()/1000;
export function publicURLs(at=stamp()){
 const base={latitude:32.64,longitude:-79.91,forecast_days:16,timeformat:'unixtime',timezone:'America/New_York'};
 const date=offset=>new Date((at+offset*86400)*1000).toISOString().slice(0,10).replaceAll('-','');
 return {
  marine:'https://marine-api.open-meteo.com/v1/marine?'+new URLSearchParams({...base,cell_selection:'sea',hourly:'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period'}),
  weather:'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({...base,latitude:32.655,longitude:-79.94,hourly:'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation_probability,is_day',daily:'sunrise,sunset',temperature_unit:'fahrenheit',wind_speed_unit:'mph'}),
  tides:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'+new URLSearchParams({product:'predictions',application:'FollySurf',begin_date:date(-1),end_date:date(17),datum:'MLLW',station:'8666467',time_zone:'gmt',units:'english',interval:'hilo',format:'json'}),
  buoyModel:buoyForecastURL()
 };
}
async function bounded(operation,timeoutMs){
 let timer;
 try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Storage or source deadline reached')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
async function read(bucket,key,timeoutMs=1500){try{return await bounded((async()=>{const o=await bucket?.get(key);return o?await o.json():null;})(),timeoutMs);}catch{return null;}}
async function put(bucket,key,data,createOnly=false,timeoutMs=1500){if(bucket)await bounded(bucket.put(key,JSON.stringify(data),{httpMetadata:{contentType:'application/json'},...(createOnly?{onlyIf:new Headers({'If-None-Match':'*'})}:{})}),timeoutMs);}
async function jsonSource(kind,url,fetchImpl,clock,timeoutMs){
 const controller=new AbortController();
 try{
  return await bounded((async()=>{
   const r=await fetchImpl(url,{headers:{'User-Agent':'FollySurf/1.0 (independent Folly Beach forecast dashboard)'},signal:controller.signal});
   if(!r.ok){await r.body?.cancel();throw Error('Provider unavailable');}
   const data=await r.json();
   const field=kind==='weather'?'wind_speed_10m':'wave_height';
   if(data.error)throw Error('No usable data');
   if(kind==='tides'){if(!data.predictions?.some(p=>['H','L'].includes(p.type)&&typeof p.v==='string'&&p.v.trim()&&Number.isFinite(Number(p.v))&&Number.isFinite(Date.parse(p.t.replace(' ','T')+'Z'))))throw Error('No usable tides');}
   else if(!Array.isArray(data.hourly?.time)||!Array.isArray(data.hourly?.[field])||data.hourly.time.length!==data.hourly[field].length||!data.hourly.time.every(Number.isFinite)||!data.hourly[field].some(Number.isFinite))throw Error('Invalid hourly data');
   return {status:'fresh',data,retrievedAt:clock(),issuedAt:null,sourceUrl:url};
  })(),timeoutMs);
 }catch{controller.abort();return {status:'unavailable',data:null,retrievedAt:null,issuedAt:null,error:'Provider could not be reached or returned no usable data',sourceUrl:url};}
}
export function fallbackSources(current,previous,at){
 const result={...current};
 for(const [key,value] of Object.entries(result)){
  const old=previous?.[key];
  // Old observations are not served as a current measurement.
  if(value.status==='unavailable'&&key!=='buoy'&&old?.data&&at-old.retrievedAt>=0&&at-old.retrievedAt<6*3600){
   const issueLimit=key==='nws'?36*3600:key==='nwps'?30*3600:Infinity;
   if(Number.isFinite(old.issuedAt)&&at-old.issuedAt>issueLimit)continue;
   result[key]={...old,status:'cached',error:value.error};
  }
 }
 return result;
}
async function archive(bucket,sources,at,timeoutMs){
 if(!bucket)return false;
 const day=new Date(at*1000).toISOString().slice(0,10);
 const jobs=[];
 if(Object.values(sources).some(s=>s?.status==='fresh'&&s.data))jobs.push(archiveHistory(bucket,sources,{at,timeoutMs}));
 for(const key of ['nws','nwps']){
  const source=sources[key];if(source?.status!=='fresh'||!source.data)continue;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source.data)));
  const hash=Array.from(new Uint8Array(digest)).slice(0,10).map(b=>b.toString(16).padStart(2,'0')).join('');
  const archiveKey=`archive/${key}/${source.issuedAt??day}/${hash}.json`;
  const {rawResponse,...normalized}=source;
  jobs.push(put(bucket,archiveKey,{...normalized,firstSeenAt:source.retrievedAt},true,timeoutMs));
 }
 if(sources.buoyModel?.status==='fresh'){
  const key=`archive/buoy-model/${day}/${Math.floor(new Date(at*1000).getUTCHours()/6)*6}.json`;
  // First retrieval in each six-hour bin is retained, never replaced by later hindsight.
  const snapshot=createBuoySnapshot(sources.buoyModel.data,sources.buoyModel.retrievedAt);
  if(snapshot)jobs.push(put(bucket,key,snapshot,true,timeoutMs));
 }
 if(sources.buoy?.data)jobs.push(put(bucket,`archive/buoy/${day}/${Math.floor(at/3600)}.json`,{...sources.buoy,rawResponse:undefined},false,timeoutMs));
 const results=await Promise.allSettled(jobs);return results.length>0&&results.every(r=>r.status==='fulfilled');
}
export async function getConditions({bucket,fetchImpl=fetch,now=stamp,force=false,collectionMode='on-request',sourceTimeoutMs=12000,storageTimeoutMs=1500}={}){
 const clock=typeof now==='function'?now:()=>now;
 const at=clock();
 if(!force&&memory&&at-memory.generatedAt>=0&&at-memory.generatedAt<TTL)return memory;
 if(pending)return pending;
 pending=(async()=>{
  const stored=await read(bucket,CACHE_KEY,storageTimeoutMs);
  if(!force&&stored&&at-stored.generatedAt>=0&&at-stored.generatedAt<TTL){memory=stored;return stored;}
  const urls=publicURLs(at);
  const [official,others,heartbeat]=await Promise.all([
   collectForecastSources({fetchImpl,now:at,clock,collectionTimeoutMs:sourceTimeoutMs}),
   Promise.all(Object.entries(urls).map(async([key,url])=>[key,await jsonSource(key,url,fetchImpl,clock,sourceTimeoutMs)])),
   read(bucket,'status/scheduled.json',storageTimeoutMs)
  ]);
  const sources=fallbackSources({...official,...Object.fromEntries(others)},stored?.sources??memory?.sources,at);
  let archiveActive=false;try{archiveActive=await archive(bucket,sources,clock(),storageTimeoutMs);}catch{}
  const scheduleActive=collectionMode==='scheduled'||(heartbeat?.status==='ok'&&Number.isFinite(heartbeat.completedAt)&&at-heartbeat.completedAt>=0&&at-heartbeat.completedAt<8*3600);
  // Raw responses live in immutable research storage, never in the visitor payload or hot cache.
  const publicSources=Object.fromEntries(Object.entries(sources).map(([name,{rawResponse,...source}])=>[name,source]));
  const bundle={generatedAt:clock(),sources:publicSources,archive:{active:archiveActive,mode:collectionMode,scheduleActive,lastScheduledAt:heartbeat?.completedAt??null,message:archiveActive?(scheduleActive?'Forecast snapshots saved; scheduled collection has a recent successful run.':'Forecast snapshots saved on page refresh; no recent scheduled collection is verified.'):'Persistent forecast archive unavailable.'}};
  memory=bundle;try{await put(bucket,CACHE_KEY,bundle,false,storageTimeoutMs);}catch{}
  return bundle;
 })();
 try{return await pending;}finally{pending=null;}
}
export async function getVerification({bucket,now=stamp,fetchImpl=fetch}={}){
 const at=typeof now==='function'?now():now;
 const conditions=await getConditions({bucket,now:at,fetchImpl});
 const snapshots=[];
 if(bucket){
  const startAfter=`archive/buoy-model/${new Date((at-7*86400)*1000).toISOString().slice(0,10)}/`;
  const list=await bounded(bucket.list({prefix:'archive/buoy-model/',startAfter,limit:40}),1500);
  const items=await Promise.all(list.objects.map(o=>read(bucket,o.key)));
  snapshots.push(...items.filter(Boolean));
 }
 return {generatedAt:at,archive:conditions.archive,...compareSnapshots(snapshots,conditions.sources.buoy?.data?.rows??[],{now:at})};
}
