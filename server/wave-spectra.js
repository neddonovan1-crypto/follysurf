import {nwpsCycles} from './forecast.js';
import {parseSwanSpectrum} from './wave-spectrum.js';
import {archiveHistory} from './history.js';

// Locations are verified against the published CHS spectral-file headers.
// None is a Pier/Washout breaking-wave measurement or a local spectral substitute.
export const WAVE_SPECTRUM_POINTS=Object.freeze([
 {id:'CHSHB',name:'Charleston Harbor model point',latitude:32.73,longitude:-79.84},
 {id:'NAVB6',name:'Offshore navigation model point',latitude:32.64,longitude:-79.68},
 {id:'41004',name:'Edisto model point',latitude:32.501,longitude:-79.099},
]);
const KEY='cache/nwps-spectra-v1.json',TTL=3600;
let pending=null;
export function waveSpectrumUrl(cycle,id){
 if(!WAVE_SPECTRUM_POINTS.some(p=>p.id===id)||!Number.isFinite(cycle)||cycle%21600!==0)throw new TypeError('Invalid spectral request');
 const d=new Date(cycle*1000),date=d.toISOString().slice(0,10).replaceAll('-',''),hour=d.toISOString().slice(11,13);
 return `https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod/er.${date}/chs/${hour}/CG1/nwps.t${hour}z.spc2d_${id}_CG1.chs.txt`;
}
async function bounded(work,ms){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Wave-spectrum deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
async function readText(url,fetchImpl,ms){
 const controller=new AbortController();
 try{return await bounded((async()=>{
  const response=await fetchImpl(url,{signal:controller.signal,headers:{'Accept':'text/plain','User-Agent':'FollySurf/1.0 (wave-spectrum research)'}});
  if(!response.ok||!response.body){await response.body?.cancel();throw Error(`Spectrum HTTP ${response.status}`);}
  const reader=response.body.getReader(),decoder=new TextDecoder();let body='',bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)return body+decoder.decode();bytes+=value.byteLength;if(bytes>2_000_000)throw Error('Spectrum exceeds byte limit');body+=decoder.decode(value,{stream:true});}}
  finally{void reader.cancel().catch(()=>{});}
 })(),ms);}finally{controller.abort();}
}
const empty=(at,error)=>({schemaVersion:1,status:'unavailable',generatedAt:at,retrievedAt:null,issuedAt:null,data:null,archiveSaved:false,error});
function usableCached(cached,at){
 return cached?.schemaVersion===1&&cached.status==='fresh'&&cached.data?.points?.length&&Number.isFinite(cached.retrievedAt)&&
  at>=cached.retrievedAt&&at-cached.retrievedAt<TTL&&Number.isFinite(cached.issuedAt)&&at>=cached.issuedAt&&at-cached.issuedAt<=18*3600;
}
/** Research feed, isolated from the latency and score of the public conditions request. */
export async function getWaveSpectra({bucket,fetchImpl=fetch,now=()=>Date.now()/1000,force=false,sourceTimeoutMs=12000,storageTimeoutMs=1500}={}){
 const clock=typeof now==='function'?now:()=>now,at=clock();
 if(pending)return pending;
 pending=(async()=>{
  if(!force&&bucket){try{const o=await bounded(bucket.get(KEY),storageTimeoutMs);const cached=o?await bounded(o.json(),storageTimeoutMs):null;if(usableCached(cached,at))return cached;}catch{}}
  const deadline=Date.now()+sourceTimeoutMs;
  for(const cycle of nwpsCycles(at,3)){
   const remaining=deadline-Date.now();if(remaining<=0)break;
   const results=await Promise.allSettled(WAVE_SPECTRUM_POINTS.map(async point=>{
    const sourceUrl=waveSpectrumUrl(cycle,point.id),body=await readText(sourceUrl,fetchImpl,Math.min(5000,remaining));
    const retrievedAt=clock(),parsed=parseSwanSpectrum(body,{cycle,expectedLocation:point});
    if(!parsed.rows.some(r=>r.t>retrievedAt&&r.status==='modeled'))throw Error('No usable future spectra');
    return {point:{...point,...parsed,retrievedAt,sourceUrl},raw:{id:point.id,retrievedAt,sourceUrl,body}};
   }));
   const successes=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
   if(!successes.length)continue;
   const retrievedAt=Math.max(...successes.map(s=>s.point.retrievedAt)),completedAt=clock();
   if(completedAt-cycle>18*3600||cycle>completedAt)continue;
   const missingPoints=WAVE_SPECTRUM_POINTS.filter(p=>!successes.some(s=>s.point.id===p.id)).map(p=>p.id);
   const source={status:'fresh',issuedAt:cycle,retrievedAt,sourceUrl:successes[0].point.sourceUrl,
    data:{schemaVersion:1,cycle,model:'NOAA NWPS CHS CG1 / SWAN',scope:'regional-model-points',scoreEligible:false,
     interpretation:'Frequency bands are variance shares, not identified swell trains. No wind-sea classification or breaking-surf prediction.',
     points:successes.map(s=>s.point),missingPoints},rawResponse:{format:'json',body:{cycle,files:successes.map(s=>s.raw)}}};
   let archiveSaved=false;
   if(bucket){try{archiveSaved=(await archiveHistory(bucket,{nwpsSpectra:source},{at:completedAt,timeoutMs:storageTimeoutMs}))>0;}catch{}}
   const {rawResponse,...publicSource}=source;
   const result={schemaVersion:1,...publicSource,generatedAt:completedAt,archiveSaved,error:missingPoints.length?'Some regional spectra are unavailable':null};
   if(bucket){try{await bounded(bucket.put(KEY,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}}),storageTimeoutMs);}catch{}}
   return result;
  }
  return empty(clock(),'No recent regional directional spectra could be retrieved');
 })();
 try{return await pending;}finally{pending=null;}
}
