import {normalizeSwellComponents,swellComponentsURL,SWELL_MAX_AGE} from '../web/swell-components.js';

const KEY='cache/swell-components-mfwam-v1.json',TTL=20*60;
let memory=null,pending=null;
async function bounded(work,ms){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Swell deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
const cached=(value,at)=>value?.schemaVersion===1&&value.model==='meteofrance_wave'&&value.status==='fresh'&&Array.isArray(value.rows)&&Number.isFinite(value.retrievedAt)&&at>=value.retrievedAt&&at-value.retrievedAt<Math.min(TTL,SWELL_MAX_AGE);
export async function getSwellComponents({bucket,fetchImpl=fetch,now=()=>Date.now()/1000,sourceTimeoutMs=8000,storageTimeoutMs=1000}={}){
 const clock=typeof now==='function'?now:()=>now,at=clock();
 if(cached(memory,at))return memory;
 if(pending)return pending;
 pending=(async()=>{
  if(bucket)try{const o=await bounded(bucket.get(KEY),storageTimeoutMs),saved=o?await bounded(o.json(),storageTimeoutMs):null;if(cached(saved,at)){memory=saved;return saved;}}catch{}
  const controller=new AbortController();
  try{
   const result=await bounded((async()=>{
    const response=await fetchImpl(swellComponentsURL(),{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok||!response.body){await response.body?.cancel();throw Error('Swell source unavailable');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let body='',bytes=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>150000)throw Error('Swell response exceeds limit');body+=decoder.decode(value,{stream:true});}}
    finally{void reader.cancel().catch(()=>{});}
    return normalizeSwellComponents(JSON.parse(body+decoder.decode()),{retrievedAt:clock()});
   })(),sourceTimeoutMs);
   memory=result;
   if(bucket)try{await bounded(bucket.put(KEY,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}}),storageTimeoutMs);}catch{}
   return result;
  }catch{return {schemaVersion:1,status:'unavailable',model:'meteofrance_wave',provider:'Open-Meteo',retrievedAt:null,issuedAt:null,rows:[],error:'Offshore swell components unavailable'};}
  finally{controller.abort();}
 })();
 try{return await pending;}finally{pending=null;}
}
