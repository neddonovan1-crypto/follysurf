// Public NOAA NDBC formats/units: https://www.ndbc.noaa.gov/faq/measdes.shtml
// alpha1 is mean direction FROM true north. Density is m²/Hz, not wave power.
export const SPECTRA_URLS=Object.freeze({density:'https://www.ndbc.noaa.gov/data/realtime2/41004.data_spec',direction:'https://www.ndbc.noaa.gov/data/realtime2/41004.swdir'});
const TTL=600,MAX_AGE=86400,KEY='cache/spectra-41004-v1.json';
let memory=null,pending=null;
const station={id:'41004',name:'Edisto'};
const numeric=value=>/^[+-]?\d+(?:\.\d+)?$/.test(value)?Number(value):null;

export function parseSpectrum(text,{direction=false,now=Date.now()/1000}={}){
 if(typeof text!=='string'||!text.startsWith('#YY')||!text.includes(direction?'alpha1':'Sep_Freq'))return [];
 const rows=[];
 for(const line of text.split('\n').slice(1,33)){
  const match=line.match(/^(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(.+)$/);if(!match)continue;
  const [year,month,day,hour,minute]=match.slice(1,6).map(Number);
  const date=new Date(Date.UTC(year,month-1,day,hour,minute)),observedAt=date.getTime()/1000;
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||observedAt>now+300||now-observedAt>MAX_AGE)continue;
  let body=match[6];
  if(!direction){const sep=body.match(/^(\S+)\s+/);if(!sep)continue;body=body.slice(sep[0].length);}
  const pairs=[...body.matchAll(/(\S+)\s+\((\d+(?:\.\d+)?)\)/g)];
  if(pairs.length<2||pairs.length>128||body.replace(/(\S+)\s+\((\d+(?:\.\d+)?)\)/g,'').trim())continue;
  let previous=0,invalid=false;
  const bins=pairs.map(pair=>{
   const frequencyHz=Number(pair[2]);if(frequencyHz<=previous||frequencyHz>2)invalid=true;previous=frequencyHz;
   let value=numeric(pair[1]);
   if(value===null||value<0||value===999||(!direction&&value>=999)||(direction&&value>360))value=null;
   if(direction&&value===360)value=0;
   return {frequencyHz,value};
  });
  if(!invalid&&bins.some(bin=>bin.value!==null))rows.push({observedAt,bins});
 }
 return rows.sort((a,b)=>b.observedAt-a.observedAt);
}

export function combineSpectra(density,direction,{now=Date.now()/1000,retrievedAt=now}={}){
 const row=parseSpectrum(density,{now})[0];
 const base={schemaVersion:1,station,quality:'realtime-provisional',sourceUrl:SPECTRA_URLS.density,directionSourceUrl:SPECTRA_URLS.direction,units:{density:'m²/Hz',frequency:'Hz',period:'s',direction:'degrees true, from'},retrievedAt,observedAt:null,status:'unavailable',bins:[],peakPeriodSeconds:null,peakDirectionDeg:null,missingBins:0,directionAvailable:false};
 if(!row)return base;
 const directions=new Map((parseSpectrum(direction,{direction:true,now}).find(d=>d.observedAt===row.observedAt)?.bins??[]).map(b=>[b.frequencyHz,b.value]));
 const bins=row.bins.map(b=>({frequencyHz:b.frequencyHz,periodSeconds:1/b.frequencyHz,densityM2PerHz:b.value,meanDirectionDeg:directions.get(b.frequencyHz)??null}));
 const peak=bins.reduce((best,bin)=>bin.densityM2PerHz!==null&&bin.densityM2PerHz>0&&(!best||bin.densityM2PerHz>best.densityM2PerHz)?bin:best,null);
 return {...base,status:now-row.observedAt<=10800?'fresh':'stale',observedAt:row.observedAt,bins,peakPeriodSeconds:peak?.periodSeconds??null,peakDirectionDeg:peak?.meanDirectionDeg??null,missingBins:bins.filter(b=>b.densityM2PerHz===null).length,directionAvailable:bins.some(b=>b.meanDirectionDeg!==null)};
}

async function deadline(operation,ms){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
async function fetchPrefix(url,fetchImpl,timeoutMs){
 const controller=new AbortController();
 try{return await deadline((async()=>{
  const response=await fetchImpl(url,{signal:controller.signal});
  if(!response.ok||!response.body){await response.body?.cancel();throw Error('Unavailable source');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
  try{
   while(bytes<300000){const {value,done}=await reader.read();if(done){text+=decoder.decode();return text;}
    bytes+=value.byteLength;if(bytes>300000)throw Error('Source prefix too large');text+=decoder.decode(value,{stream:true});
    // Files are newest first. Keep 32 complete rows to match direction if its update lags.
    const lines=text.split('\n');if(lines.length>=34)return lines.slice(0,33).join('\n')+'\n';
   }
   throw Error('Source prefix too large');
  }finally{void reader.cancel().catch(()=>{});}
 })(),timeoutMs);}finally{controller.abort();}
}
function aged(result,now){
 if(!result||result.schemaVersion!==1||!Array.isArray(result.bins))return null;
 if(!Number.isFinite(result.observedAt)||now-result.observedAt>MAX_AGE||result.observedAt>now+300)return {...combineSpectra('',null,{now,retrievedAt:result.retrievedAt}),error:'No recent spectrum available'};
 return {...result,status:now-result.observedAt<=10800?'fresh':'stale'};
}
export async function getSpectra({bucket,fetchImpl=fetch,now=()=>Date.now()/1000,force=false,sourceTimeoutMs=8000,storageTimeoutMs=1500}={}){
 const clock=typeof now==='function'?now:()=>now,at=clock();
 if(!force&&memory&&at-memory.checkedAt>=0&&at-memory.checkedAt<TTL)return aged(memory,at);
 if(pending)return pending;
 pending=(async()=>{
  let stored=null;
  try{const object=await deadline(Promise.resolve(bucket?.get(KEY)),storageTimeoutMs);stored=object?await deadline(object.json(),storageTimeoutMs):null;}catch{}
  if(!force&&stored&&Number.isFinite(stored.checkedAt)&&at-stored.checkedAt>=0&&at-stored.checkedAt<TTL){const cached=aged(stored,at);if(cached){memory={...cached,checkedAt:stored.checkedAt};return cached;}}
  const sources=await Promise.allSettled(Object.values(SPECTRA_URLS).map(async url=>({text:await fetchPrefix(url,fetchImpl,sourceTimeoutMs),retrievedAt:clock()})));
  const completedAt=clock(),density=sources[0].status==='fulfilled'?sources[0].value:null,direction=sources[1].status==='fulfilled'?sources[1].value:null;
  let result=combineSpectra(density?.text??'',direction?.text??'',{now:completedAt,retrievedAt:density?.retrievedAt??null});
  // Retrieval time belongs to completed source reads, not request initiation or a later failed read.
  if(result.directionAvailable&&direction)result.retrievedAt=Math.max(result.retrievedAt,direction.retrievedAt);
  if(result.status==='unavailable'){
   const old=[memory,stored].filter(Boolean).sort((a,b)=>(b.observedAt??0)-(a.observedAt??0)).map(value=>aged(value,completedAt)).find(value=>value?.status!=='unavailable');
   if(old)result={...old,error:'Latest retrieval failed; showing previous observation'};
   else result={...result,retrievedAt:null,error:'No recent spectrum available'};
  }
  memory={...result,checkedAt:completedAt};
  try{if(bucket)await deadline(bucket.put(KEY,JSON.stringify(memory),{httpMetadata:{contentType:'application/json'}}),storageTimeoutMs);}catch{}
  return result;
 })();
 try{return await pending;}finally{pending=null;}
}
