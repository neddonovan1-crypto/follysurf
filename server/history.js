import {evaluateOutlook} from '../web/outlook.js';

const HISTORY_SOURCES=Object.freeze(['weather','marine','tides','nws','nwps','buoy','buoyModel','ratings','coastal','spectra','nwpsSpectra']);
const observationSources=['coastal','spectra'];
const inputSources=HISTORY_SOURCES.filter(s=>s!=='ratings'&&!observationSources.includes(s));
const observationWrites=new WeakMap();
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const day=t=>new Date(t*1000).toISOString().slice(0,10);
const formulaVersion=()=>evaluateOutlook().version;
async function bounded(work,timeoutMs=1500){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Archive deadline reached')),timeoutMs);})]);}finally{clearTimeout(timer);}}
async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function writeOnce(bucket,key,value,timeoutMs,contentType='application/json'){
 return bounded(bucket.put(key,typeof value==='string'?value:JSON.stringify(value),{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType}}),timeoutMs);
}
function metadata(sourceName,source){
 const d=source.data;
 const times=d.hourly?.time??d.points?.flatMap(p=>p.rows?.map(r=>r.t)??[])??d.periods?.flatMap(p=>[p.start,p.end])??d.predictions?.map(p=>Date.parse(p.t.replace(' ','T')+'Z')/1000)??d.rows?.map(r=>r.t)??[];
 const validTimes=times.filter(finite);
 let request;try{request=new URL(source.sourceUrl??d.sourceUrl);}catch{}
 const location=d.points?.map(p=>({id:p.id,latitude:p.latitude,longitude:p.longitude}))??(finite(d.latitude)&&finite(d.longitude)?{latitude:d.latitude,longitude:d.longitude}:sourceName==='tides'?{station:'8666467',name:'Folly River North'}:sourceName==='nws'?{zone:d.zone,scope:d.scope}:sourceName==='buoy'?{station:'41004',latitude:32.501,longitude:-79.099}:null);
 const units=d.hourly_units??(sourceName==='nwpsSpectra'?{varianceM2:'m²',spectralHeightM:'m',period:'s',direction:'degrees true (from)',varianceShare:'fraction',directionalSpreadDeg:'degrees',frequencyBandwidth:'dimensionless'}:sourceName==='nwps'?{waveM:'m',peakPeriodS:'s',relativeDirectionDeg:'degrees relative to shore normal'}:sourceName==='tides'?{height:'ft',datum:'MLLW'}:sourceName==='nws'?{surfMinFt:'ft',surfMaxFt:'ft'}:sourceName==='buoy'?{waveM:'m',windMs:'m/s',gustMs:'m/s',waterC:'°C',waveDirectionDeg:'degrees true (from)'}:null);
 return {location,requestedLocation:request?{latitude:Number(request.searchParams.get('latitude'))||null,longitude:Number(request.searchParams.get('longitude'))||null,station:request.searchParams.get('station')}:null,
  units,validTimeRange:validTimes.length?{start:Math.min(...validTimes),end:Math.max(...validTimes)}:null,
  modelSelection:request?.searchParams.get('models')??(['weather','marine','buoyModel'].includes(sourceName)?'provider best_match; individual model issue times not supplied':['nwps','nwpsSpectra'].includes(sourceName)?'NOAA NWPS CHS CG1':null),
  timeBasis:'Unix seconds UTC; original source timezone and units retained in data',missingValues:'Original nulls and normalized missing-value flags retained; no interpolation or backfill',issueTimeKnown:finite(source.issuedAt)};
}
export function ratingSnapshot(sources,at){
 const wave=sources.nwps,wind=sources.weather;
 if(!wave?.data?.points?.length||!wind?.data?.hourly||!finite(at))return null;
 const h=wind.data.hourly;
 if(!Array.isArray(h.time)||wind.data.hourly_units?.wind_speed_10m&&wind.data.hourly_units.wind_speed_10m!=='mp/h')return null;
 const fresh=['nwps','weather'].every(k=>sources[k]?.status==='fresh'&&finite(sources[k].retrievedAt)&&sources[k].retrievedAt<=at);
 if(!fresh)return null;
 const rows=[];
 for(const p of wave.data.points)for(const r of p.rows??[]){
  if(!finite(r.t)||r.t<=at)continue;
  const i=h.time.findIndex(t=>finite(t)&&t<=r.t&&r.t<t+3600);
  if(i<0)continue;
  const result=evaluateOutlook({nearshore:r,wind:h.wind_speed_10m?.[i],windDir:h.wind_direction_10m?.[i],gust:h.wind_gusts_10m?.[i],sourceFresh:true});
  rows.push({locationId:p.id,validAt:r.t,score:result.score,level:result.level,basis:'nearshore',heightKind:'nearshore-significant',waveM:r.waveM,peakPeriodS:r.peakPeriodS,relativeDirectionDeg:r.relativeDirectionDeg??null,components:result.components,windMph:h.wind_speed_10m?.[i]??null,windDirectionDeg:h.wind_direction_10m?.[i]??null,gustMph:h.wind_gusts_10m?.[i]??null});
 }
 return rows.length?{schemaVersion:1,type:'folly-index',version:formulaVersion(),firstSeenAt:at,issuedAt:null,rows,inputs:Object.fromEntries(['nwps','weather'].map(k=>[k,{retrievedAt:sources[k].retrievedAt,issuedAt:sources[k].issuedAt??null,sourceUrl:sources[k].sourceUrl??sources[k].data?.sourceUrl??null}]))}:null;
}

/** Every snapshot is immutable and records what was actually retrieved, never a backfill. */
export async function archiveHistory(bucket,sources,{at=Date.now()/1000,timeoutMs=1500}={}){
 if(!bucket)return 0;
 const jobs=[];
 for(const name of inputSources){
  const source=sources[name];if(source?.status!=='fresh'||!source.data||!finite(source.retrievedAt)||source.retrievedAt>at)continue;
  jobs.push((async()=>{
   let raw={format:'json',embeddedIn:'data'};
   if(source.rawResponse){
    const text=typeof source.rawResponse.body==='string'?source.rawResponse.body:JSON.stringify(source.rawResponse.body);
    const hash=await digest(text),format=source.rawResponse.format==='json'?'json':'text';
    const key=`archive/raw/${name}/${hash}.${format==='json'?'json':'txt'}`;
    await writeOnce(bucket,key,text,timeoutMs,format==='json'?'application/json':'text/plain');
    raw={format,key,sha256:hash};
   }
   const hash=await digest(JSON.stringify({data:source.data,issuedAt:source.issuedAt??null,formulaVersion:formulaVersion()}));
   const id=`${Math.floor(source.retrievedAt*1000)}-${hash.slice(0,20)}`;
   const snapshot={schemaVersion:1,id,source:name,recordedAt:at,retrievedAt:source.retrievedAt,issuedAt:source.issuedAt??null,formulaVersion:formulaVersion(),sourceUrl:source.sourceUrl??source.data.sourceUrl??null,status:source.status,metadata:metadata(name,source),raw,data:source.data};
   await writeOnce(bucket,`archive/inputs/${name}/${day(source.retrievedAt)}/${id}.json`,snapshot,timeoutMs);
  })());
 }
 const ratings=ratingSnapshot(sources,at);
 if(ratings)jobs.push((async()=>{
  const hash=await digest(JSON.stringify(ratings));const id=`${Math.floor(at*1000)}-${hash.slice(0,20)}`;
  await writeOnce(bucket,`archive/inputs/ratings/${day(at)}/${id}.json`,{schemaVersion:1,id,source:'ratings',recordedAt:at,retrievedAt:at,issuedAt:null,formulaVersion:ratings.version,status:'fresh',metadata:{location:'Folly NWPS model points; per-point rows',units:{score:'0–100',waveM:'m',windMph:'mph'},timeBasis:'Forecast inputs available before validAt',validation:'Unvalidated heuristic; no beach observations implied'},data:ratings},timeoutMs);
 })());
 const results=await Promise.allSettled(jobs);
 if(results.some(r=>r.status==='rejected'))throw Error('Some forecast inputs could not be archived');
 return results.length;
}

/** Called with waitUntil by observation endpoints; never fetches or blocks conditions. */
export async function archiveObservation(bucket,source,result,{at=Date.now()/1000,timeoutMs=1500}={}){
 if(!observationSources.includes(source))throw new TypeError('Unsupported observation source');
 if(!bucket||!result||!finite(at))return 0;
 const eligible=s=>s?.status==='fresh'&&!s.fallback&&!s.error&&finite(s.retrievedAt)&&s.retrievedAt<=at&&finite(s.observedAt)&&s.observedAt<=s.retrievedAt;
 let data,retrievedAt,units,location;
 if(source==='coastal'){
  const sources=Object.fromEntries(Object.entries(result.sources??{}).filter(([,s])=>eligible(s)&&s.latest));
  if(!Object.keys(sources).length)return 0;
  data={schemaVersion:result.schemaVersion,station:result.station,scope:result.scope,sources};
  retrievedAt=Math.max(...Object.values(sources).map(s=>s.retrievedAt));
  units=Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{...s.units,...(s.datum?{datum:s.datum}:{})}]));
  location=result.station;
 }else{
  if(!eligible(result)||!result.bins?.length)return 0;
  const {checkedAt,generatedAt,...observation}=result;
  data=observation;retrievedAt=result.retrievedAt;units=result.units;location=result.station;
 }
 const hash=await digest(JSON.stringify(data));
 const id=`${Math.floor(retrievedAt*1000)}-${hash.slice(0,20)}`;
 const key=`archive/inputs/${source}/${day(retrievedAt)}/${id}.json`;
 let recent=observationWrites.get(bucket);if(!recent){recent=new Map();observationWrites.set(bucket,recent);}
 if(recent.has(key)){await recent.get(key);return 0;}
 const snapshot={schemaVersion:1,id,source,recordedAt:at,retrievedAt,issuedAt:null,formulaVersion:formulaVersion(),status:'fresh',sourceUrl:result.sourceUrl??result.station?.sourceUrl??null,
  metadata:{kind:'observation',location,units,timeBasis:'Unix seconds UTC; per-source observedAt and retrievedAt retained',representation:'Normalized provider observations; raw provider responses not retained',quality:'Provider quality flags retained; observations are not beach surf measurements'},data};
 const writing=writeOnce(bucket,key,snapshot,timeoutMs);
 recent.set(key,writing);
 while(recent.size>64)recent.delete(recent.keys().next().value);
 try{await writing;return 1;}catch(error){recent.delete(key);throw error;}
}

export function compareAt(snapshot,validAt){
 if(!finite(validAt)||!finite(snapshot.retrievedAt)||snapshot.retrievedAt>=validAt||!finite(snapshot.recordedAt)||snapshot.recordedAt>=validAt)return null;
 const h=snapshot.data?.hourly;
 if(!Array.isArray(h?.time))return null;
 const i=h.time.findIndex(t=>finite(t)&&t<=validAt&&validAt<t+3600);
 if(i<0||h.time[i]<=snapshot.retrievedAt||h.time[i]<=snapshot.recordedAt||(finite(snapshot.issuedAt)&&h.time[i]<=snapshot.issuedAt))return null;
 return {validAt,forecastAt:h.time[i],leadHours:(h.time[i]-snapshot.retrievedAt)/3600,values:Object.fromEntries(Object.entries(h).filter(([key,value])=>key!=='time'&&Array.isArray(value)).map(([key,value])=>[key,finite(value[i])?value[i]:null])),units:snapshot.data.hourly_units??snapshot.metadata?.units??{}};
}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
/** One date/source partition per request, at most eight objects; never enumerate private bucket keys. */
export async function getHistory({bucket,date=day(Date.now()/1000),source='marine',validAt=null,limit=4,cursor=null,snapshot=null,raw=false,now=Date.now()/1000,timeoutMs=1500}={}){
 if(!validDate(date)||!HISTORY_SOURCES.includes(source)||date>day(now))throw new TypeError('Choose a valid source and a current or past UTC date');
 if(validAt!==null&&!finite(validAt))throw new TypeError('validAt must be Unix seconds');
 if(snapshot!==null&&!/^\d{13}-[a-f0-9]{20}$/.test(snapshot))throw new TypeError('Invalid snapshot ID');
 if(cursor!==null&&(typeof cursor!=='string'||cursor.length>1024))throw new TypeError('Invalid cursor');
 const count=Math.max(1,Math.min(8,Math.floor(Number(limit)||4))),prefix=`archive/inputs/${source}/${date}/`;
 const base={date,source,validAt,comparisonType:observationSources.includes(source)?'recorded observations; no forecast comparison calculated':'forecast-to-forecast; not measured accuracy',snapshots:[],truncated:false,cursor:null};
 if(!bucket)return {...base,status:'unavailable'};
 try{
  const list=snapshot?{objects:[{key:prefix+snapshot+'.json'}],truncated:false}:await bounded(bucket.list({prefix,limit:count,...(cursor?{cursor}:{})}),timeoutMs);
  const results=await Promise.all(list.objects.slice(0,count).map(async o=>{
   if(!o.key.startsWith(prefix))return null;
   const object=await bounded(bucket.get(o.key),timeoutMs);if(!object)return null;
   const saved=await bounded(object.json(),timeoutMs);
   if(saved.source!==source||!finite(saved.recordedAt)||saved.recordedAt>now||!finite(saved.retrievedAt)||saved.retrievedAt>now)return null;
   const result={...saved,comparison:compareAt(saved,validAt)};
   if(raw&&snapshot&&saved.raw?.key&&new RegExp(`^archive/raw/${source}/[a-f0-9]{64}\\.(json|txt)$`).test(saved.raw.key)){
    const rawObject=await bounded(bucket.get(saved.raw.key),timeoutMs);
    result.rawResponse=rawObject?{format:saved.raw.format,body:await bounded(rawObject.text(),timeoutMs)}:null;
   }
   return result;
  }));
  const snapshots=results.filter(Boolean).sort((a,b)=>a.retrievedAt-b.retrievedAt);
  return {...base,status:snapshots.length?'ready':'empty',snapshots,truncated:Boolean(list.truncated),cursor:list.truncated?list.cursor??null:null};
 }catch{return {...base,status:'unavailable'};}
}
