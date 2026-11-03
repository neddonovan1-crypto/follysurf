/**
 * Measured Charleston harbor conditions, kept separate from surf forecasts.
 * API parameters/units: https://api.tidesandcurrents.noaa.gov/api/prod/
 * Fields and QC: https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html
 * Station/measurement context: https://www.ndbc.noaa.gov/station_page.php?station=chts1
 * No prediction subtraction, beach extrapolation, or wind-height conversion.
 */
const COASTAL_STATION=Object.freeze({id:'8665530',name:'Charleston, SC',sourceUrl:'https://tidesandcurrents.noaa.gov/stationhome.html?id=8665530'});
const base={application:'FollySurf',station:COASTAL_STATION.id,range:'6',time_zone:'gmt',units:'metric',format:'json'};
export const COASTAL_URLS=Object.freeze({
 waterLevel:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'+new URLSearchParams({...base,product:'water_level',datum:'MLLW'}),
 wind:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'+new URLSearchParams({...base,product:'wind'})
});
export const COASTAL_LIMITS=Object.freeze({refreshSeconds:300,freshSeconds:1800,maxAgeSeconds:10800,historySeconds:21600,maxRows:120,maxResponseBytes:131072});
const CACHE_KEY='cache/coastal-8665530-v1.json';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())?Number(value):null;
const nonnegative=value=>{const n=number(value);return n!==null&&n>=0?n:null;};
let memory=null,pending=null;

function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))return null;
 const t=Date.parse(value.replace(' ','T')+':00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,16).replace('T',' ')===value?t/1000:null;
}
function stationMetadata(value){
 if(value?.id!==COASTAL_STATION.id)return null;
 const latitude=number(value.lat),longitude=number(value.lon);
 if(latitude===null||longitude===null||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 return {...COASTAL_STATION,name:typeof value.name==='string'&&value.name.trim()?value.name:COASTAL_STATION.name,latitude,longitude,coordinatesSource:'CO-OPS response metadata'};
}
function flags(value,count){
 if(typeof value!=='string')return null;
 const parts=value.split(',').map(v=>v.trim());
 if(parts.length!==count||parts.some(v=>!/^\d+$/.test(v)))return null;
 return parts.map(Number);
}
function sourceBase(kind){
 const water=kind==='waterLevel';
 return {product:water?'water_level':'wind',station:{...COASTAL_STATION,latitude:null,longitude:null},sourceUrl:COASTAL_URLS[kind],
  status:'unavailable',retrievedAt:null,observedAt:null,latest:null,rows:[],fallback:false,error:null,
  units:water?{level:'m',sigma:'m',time:'Unix seconds UTC'}:{speed:'m/s',gust:'m/s',direction:'degrees true, from',time:'Unix seconds UTC'},
  ...(water?{datum:{name:'MLLW',description:'Mean Lower Low Water at station 8665530',epoch:null,epochNote:'The observations API does not return the datum epoch; retain the requested datum and station.'}}:
   {measurementContext:'Charleston harbor station anemometer; not a standardized 10 m wind or a measurement at Folly Beach.'})};
}
function ageSource(source,now){
 const row=source?.latest;
 if(!source||!row||row.usable!==true||!finite(row.observedAt)||!finite(source.retrievedAt)||source.retrievedAt>now||row.observedAt>source.retrievedAt||now-row.observedAt>COASTAL_LIMITS.maxAgeSeconds){
  return {...source,status:'unavailable',latest:null,observedAt:null};
 }
 return {...source,observedAt:row.observedAt,status:now-row.observedAt<=COASTAL_LIMITS.freshSeconds?'fresh':'stale'};
}

/** Missing numbers stay null; flagged observations remain auditable but unusable. */
export function parseCoastalProduct(payload,kind,{now=Date.now()/1000,retrievedAt=now}={}){
 if(!Object.hasOwn(COASTAL_URLS,kind))throw new TypeError('Unsupported coastal product');
 const result=sourceBase(kind),station=stationMetadata(payload?.metadata);
 if(!finite(now)||!finite(retrievedAt)||retrievedAt>now||payload?.error||!station||!Array.isArray(payload.data)||payload.data.length>COASTAL_LIMITS.maxRows)return {...result,error:'Invalid or unavailable station response'};
 const counts=new Map();
 for(const item of payload.data){const t=timestamp(item?.t);if(t!==null)counts.set(t,(counts.get(t)??0)+1);}
 const rows=[];
 for(const item of payload.data){
  const observedAt=timestamp(item?.t);
  if(observedAt===null||counts.get(observedAt)!==1||observedAt>retrievedAt||now-observedAt>COASTAL_LIMITS.historySeconds)continue;
  const water=kind==='waterLevel',qc=flags(item.f,water?4:2),qualityCode=water&&['p','v'].includes(item.q)?item.q:null;
  // For preliminary water levels the first flag is an outlier count; any
  // nonzero flag is conservatively excluded, while its original values remain.
  const qualityControl=qc===null||(water&&!qualityCode)?'unknown':qc.some(n=>n!==0)?'flagged':'passed';
  if(water){
   const levelM=number(item.v),sigmaM=nonnegative(item.s);
   rows.push({observedAt,levelM,sigmaM,qualityCode,quality:qualityCode==='p'?'preliminary':qualityCode==='v'?'verified':'unknown',flags:qc,qualityControl,usable:qualityControl==='passed'&&levelM!==null});
  }else{
   const speedMs=nonnegative(item.s),gustMs=nonnegative(item.g),d=number(item.d),directionDeg=d!==null&&d>=0&&d<=360?(d===360?0:d):null;
   rows.push({observedAt,speedMs,directionDeg,gustMs,flags:qc,qualityControl,usable:qualityControl==='passed'&&speedMs!==null});
  }
 }
 rows.sort((a,b)=>b.observedAt-a.observedAt);
 const latest=rows.find(row=>row.usable)??null;
 const normalized=ageSource({...result,station,retrievedAt,rows,latest},now);
 return {...normalized,error:normalized.status==='unavailable'?'No recent unflagged observation is available':null};
}

async function deadline(operation,ms){
 let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Coastal deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}
}
async function readJSON(response){
 if(!response.ok||!response.body){await response.body?.cancel();throw Error('Source unavailable');}
 if(Number(response.headers?.get('Content-Length'))>COASTAL_LIMITS.maxResponseBytes){await response.body.cancel();throw Error('Oversized source');}
 const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>COASTAL_LIMITS.maxResponseBytes)throw Error('Oversized source');text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }finally{void reader.cancel().catch(()=>{});}
}
async function fetchProduct(kind,fetchImpl,clock,timeoutMs){
 const controller=new AbortController();
 try{
  const payload=await deadline((async()=>readJSON(await fetchImpl(COASTAL_URLS[kind],{signal:controller.signal,headers:{Accept:'application/json'}})))(),timeoutMs);
  // Completion time, never the request start, is the availability timestamp.
  const retrievedAt=clock();
  return parseCoastalProduct(payload,kind,{now:retrievedAt,retrievedAt});
 }catch{return {...sourceBase(kind),error:'Coastal observation service is unavailable'};}
 finally{controller.abort();}
}
function validCache(value){
 return value?.schemaVersion===1&&value.station?.id===COASTAL_STATION.id&&finite(value.checkedAt)&&['waterLevel','wind'].every(key=>value.sources?.[key]?.product===(key==='waterLevel'?'water_level':'wind'));
}
function present(saved,now){
 const sources=Object.fromEntries(['waterLevel','wind'].map(key=>[key,ageSource(saved.sources[key],now)]));
 const available=Object.values(sources).filter(s=>s.status!=='unavailable').length;
 return {...saved,generatedAt:now,sources,status:available===2&&Object.values(sources).every(s=>s.status==='fresh')?'ready':available?'partial':'unavailable'};
}

/** Two fixed provider requests per refresh; no caller-selected station or date. */
export async function getCoastal({bucket,fetchImpl=fetch,now=()=>Date.now()/1000,force=false,sourceTimeoutMs=7000,storageTimeoutMs=1500}={}){
 const clock=typeof now==='function'?now:()=>now,at=clock();
 if(!finite(at))throw new TypeError('Invalid coastal clock');
 if(!force&&memory&&at-memory.checkedAt>=0&&at-memory.checkedAt<COASTAL_LIMITS.refreshSeconds)return present(memory,at);
 if(pending)return pending;
 pending=(async()=>{
  let stored=null;
  if(bucket)try{const object=await deadline(bucket.get(CACHE_KEY),storageTimeoutMs);const value=object?await deadline(object.json(),storageTimeoutMs):null;if(validCache(value))stored=value;}catch{}
  if(!force&&stored&&at-stored.checkedAt>=0&&at-stored.checkedAt<COASTAL_LIMITS.refreshSeconds){memory=stored;return present(stored,clock());}
  const entries=await Promise.all(['waterLevel','wind'].map(async key=>[key,await fetchProduct(key,fetchImpl,clock,sourceTimeoutMs)]));
  const completedAt=clock(),sources=Object.fromEntries(entries);
  for(const key of ['waterLevel','wind'])if(sources[key].status==='unavailable'){
   const old=[memory,stored].filter(validCache).map(v=>ageSource(v.sources[key],completedAt)).filter(s=>s.status!=='unavailable').sort((a,b)=>b.observedAt-a.observedAt)[0];
   if(old)sources[key]={...old,fallback:true,error:'Latest retrieval failed; showing an earlier station observation'};
  }
  memory=present({schemaVersion:1,provider:'NOAA CO-OPS',station:COASTAL_STATION,checkedAt:completedAt,scope:'Measured Charleston harbor conditions. These do not measure breaking waves, Folly Beach wind, or local sandbar water depth.',refreshAfterSeconds:COASTAL_LIMITS.refreshSeconds,sources},completedAt);
  if(bucket)try{await deadline(bucket.put(CACHE_KEY,JSON.stringify(memory),{httpMetadata:{contentType:'application/json'}}),storageTimeoutMs);}catch{}
  return memory;
 })();
 try{return await pending;}finally{pending=null;}
}
