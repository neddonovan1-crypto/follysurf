import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fallbackSources,getConditions} from '../server/conditions.js';

const at=Date.parse('2026-10-21T12:00:00Z')/1000;
const source=(overrides={})=>({status:'fresh',data:{valid:true},retrievedAt:at-1800,issuedAt:null,...overrides});
function memoryBucket(){
 const values=new Map(),reads=[],writes=[],attempts=[];
 const bucket={
  async get(key){reads.push(key);const value=values.get(key);return value===undefined?null:{json:async()=>JSON.parse(value)};},
  async head(key){return values.has(key)?{key}:null;},
  async put(key,value,options){
   const createOnly=options?.onlyIf?.get?.('If-None-Match')==='*'||options?.onlyIf?.etagDoesNotMatch==='*';
   attempts.push({key,createOnly});
   if(createOnly&&values.has(key))return null;
   values.set(key,value);writes.push(key);return {key};
  },
  async list({prefix=''}){return {objects:[...values.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}
 };
 return {values,reads,writes,attempts,bucket};
}

test('forecast fallback preserves the original retrieval age, expires, and never invents an observation',()=>{
 const missing={status:'unavailable',data:null,error:'Offline'};
 const current={marine:missing,weather:source(),nws:missing,nwps:missing,buoy:missing,tides:missing};
 const previous={
  marine:source(),weather:source({data:{old:true}}),
  nws:source({issuedAt:at-37*3600}),nwps:source({issuedAt:at-31*3600}),
  buoy:source(),tides:source({retrievedAt:at-7*3600})
 };
 const result=fallbackSources(current,previous,at);
 assert.equal(result.marine.status,'cached');
 assert.equal(result.marine.retrievedAt,at-1800,'fallback must not reset age');
 assert.equal(result.marine.error,'Offline');
 assert.deepEqual(result.weather,current.weather,'a live source wins over cache');
 assert.equal(result.nws.status,'unavailable','old product issues must not become current after a recent fetch');
 assert.equal(result.nwps.status,'unavailable');
 assert.equal(result.buoy.data,null,'failed observation feed must not be promoted from an old cache');
 assert.equal(result.tides.data,null,'fallback expires after six hours');
 assert.equal(fallbackSources({marine:missing},{marine:source({retrievedAt:at+60})},at).marine.data,null,'future retrievals are invalid');
});

test('conditions service isolates failures, shares work, reuses R2 cache, and retains first archived buoy forecast',async()=>{
 const {values,writes,attempts,bucket}=memoryBucket();
 const oldWeather={hourly:{time:[at,at+3600],wind_speed_10m:[8,7],wind_direction_10m:[315,315],is_day:[1,1]}};
 values.set('cache/conditions-v2.json',JSON.stringify({generatedAt:at-1800,sources:{weather:source({data:oldWeather,retrievedAt:at-3600})}}));
 const product={id:'12345678-1234-1234-1234-123456789abc',issuanceTime:'2026-10-21T08:43:00Z',productText:`SCZ150-212200-
Charleston-
Including Folly Beach
.TODAY...
Surf Height.................2 to 3 feet.
Rip Current Risk*...........Low.
.THURSDAY...Surf height 2 to 3 feet.
&&
$$`};
 const buoy='#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE\n2026 10 21 11 50 315 5 7 1.2 8 5 90 1020 20 24 10 MM MM MM';
 let calls=0,wave=1.3;
 const response=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status});
 const fetchImpl=async url=>{
  calls++;
  if(url.includes('api.weather.gov/products/types'))return response({'@graph':[{id:product.id,issuanceTime:product.issuanceTime}]});
  if(url.includes('api.weather.gov/products/'))return response(product);
  if(url.includes('nomads.ncep.noaa.gov'))return response('No cycle',404);
  if(url.includes('ndbc.noaa.gov'))return response(buoy);
  if(url.includes('tidesandcurrents.noaa.gov'))return response({predictions:[{t:'2026-10-21 12:00',v:'1',type:'L'},{t:'2026-10-21 18:00',v:'5',type:'H'}]});
  if(url.includes('marine-api.open-meteo.com')){
   const isBuoy=new URL(url).searchParams.get('latitude')==='32.501';
   return response({latitude:isBuoy?32.501:32.64,longitude:isBuoy?-79.099:-79.91,hourly_units:{wave_height:'m'},hourly:{time:[at,at+86400],wave_height:[wave,wave]}});
  }
  if(url.includes('api.open-meteo.com'))return response('Weather outage',503);
  throw new Error('Unexpected URL');
 };
 const [first,concurrent]=await Promise.all([getConditions({bucket,fetchImpl,now:at}),getConditions({bucket,fetchImpl,now:at})]);
 assert.strictEqual(first,concurrent,'concurrent visitors share one pending collection');
 assert.equal(first.sources.nws.status,'fresh');
 assert.equal(first.sources.nws.rawResponse,undefined,'raw upstream bodies are not sent to visitors');
 assert.ok([...values.keys()].some(k=>k.startsWith('archive/raw/nws/')),'the full NWS product is retained privately for research');
 assert.ok([...values.keys()].some(k=>k.startsWith('archive/inputs/marine/')),'complete marine inputs are archived immutably');
 assert.equal(first.sources.nwps.status,'unavailable');
 assert.equal(first.sources.buoy.status,'fresh');
 assert.equal(first.sources.marine.status,'fresh');
 assert.equal(first.sources.weather.status,'cached');
 assert.equal(first.sources.weather.retrievedAt,at-3600);
 const firstCalls=calls;assert.ok(firstCalls>0);
 const cached=await getConditions({bucket,fetchImpl,now:at+60});
 assert.strictEqual(cached,first);
 assert.equal(calls,firstCalls,'memory cache prevents duplicate provider requests');
 // A fresh module instance simulates a separate Worker isolate with empty memory.
 const cold=await import('../server/conditions.js?conditions-test-cold-isolate');
 const shared=await cold.getConditions({bucket,fetchImpl,now:at+120});
 assert.equal(shared.generatedAt,at);
 assert.equal(calls,firstCalls,'R2 cache works before a network request');
 const archiveKey=[...values.keys()].find(key=>key.startsWith('archive/buoy-model/'));
 assert.ok(archiveKey,'a model forecast was persisted before matching observations');
 const original=values.get(archiveKey);
 wave=9;
 const refreshed=await getConditions({bucket,fetchImpl,now:at+1201});
 assert.ok(calls>firstCalls,'expired shared cache fetches new sources');
 assert.equal(refreshed.sources.buoyModel.data.hourly.wave_height[0],9);
 assert.equal(values.get(archiveKey),original,'later hindsight cannot overwrite the first snapshot in a six-hour bin');
 assert.equal(writes.filter(key=>key===archiveKey).length,1);
 const forecastWrites=attempts.filter(({key})=>/^archive\/(nws|nwps|buoy-model)\//.test(key));
 assert.ok(forecastWrites.length>=2);
 assert.ok(forecastWrites.every(({createOnly})=>createOnly),'forecast immutability must be enforced by a conditional storage write, including across isolates');
 assert.equal(attempts.filter(({key})=>key===archiveKey).length,2,'the second conditional write is rejected by storage, not just a local existence check');
});

test('forecast retrieval and archived lead times start when the response body finishes loading',async()=>{
 const isolated=await import('../server/conditions.js?conditions-completion-clock');
 const {values,bucket}=memoryBucket();
 let clock=at;
 const fetchImpl=async url=>{
  if(url.includes('marine-api.open-meteo.com')&&new URL(url).searchParams.get('latitude')==='32.501'){
   return {ok:true,json:async()=>{
    // A delayed response must not be backdated to request start.
    clock=at+42;
    return {latitude:32.501,longitude:-79.099,hourly_units:{wave_height:'m'},hourly:{time:[at+86400],wave_height:[1.2]}};
   }};
  }
  return new Response('Provider unavailable',{status:503});
 };
 const result=await isolated.getConditions({bucket,fetchImpl,now:()=>clock});
 assert.equal(result.sources.buoyModel.status,'fresh');
 assert.equal(result.sources.buoyModel.retrievedAt,at+42);
 assert.equal(result.generatedAt,at+42);
 const key=[...values.keys()].find(key=>key.startsWith('archive/buoy-model/'));
 assert.ok(key);
 const snapshot=JSON.parse(values.get(key));
 assert.equal(snapshot.retrievedAt,at+42,'forecast lead time must use completed retrieval, not request start');
});

test('malformed hourly timestamps and mismatched arrays are rejected before reaching the browser',async()=>{
 const cases=[
  {time:['not-a-timestamp'],values:[1]},
  {time:[at,null],values:[1,2]},
  {time:[at,at+3600],values:[1]}
 ];
 for(let i=0;i<cases.length;i++){
  // Each isolated service has no prior successful source that could mask rejection as a fallback.
  const isolated=await import(`../server/conditions.js?conditions-bad-time-${i}`);
  const fixture=cases[i];
  const fetchImpl=async url=>{
   if(url.includes('open-meteo.com')){
    const field=url.includes('marine-api.')?'wave_height':'wind_speed_10m';
    return Response.json({hourly:{time:fixture.time,[field]:fixture.values}});
   }
   return new Response('Provider unavailable',{status:503});
  };
  const result=await isolated.getConditions({fetchImpl,now:at});
  for(const source of ['marine','weather','buoyModel']){
   assert.equal(result.sources[source].status,'unavailable',`${source} must reject malformed case ${i}`);
   assert.equal(result.sources[source].data,null);
  }
 }
});

test('unresponsive storage cannot pin shared conditions requests or claim successful archiving',{timeout:1500},async()=>{
 const isolated=await import('../server/conditions.js?conditions-storage-deadlines');
 const never=()=>new Promise(()=>{});
 let gets=0,writes=0,failWeather=false;
 const bucket={get(){gets++;return never();},put(){writes++;return never();}};
 const fetchImpl=async url=>{
  if(url.includes('open-meteo.com')){
   if(failWeather&&url.includes('api.open-meteo.com'))return new Response('Unavailable',{status:503});
   const isBuoy=new URL(url).searchParams.get('latitude')==='32.501';
   return Response.json({latitude:isBuoy?32.501:32.64,longitude:isBuoy?-79.099:-79.91,hourly_units:{wave_height:'m'},hourly:{time:[at+86400],wave_height:[1.2],wind_speed_10m:[8]}});
  }
  return new Response('Unavailable',{status:503});
 };
 const options={bucket,fetchImpl,now:at,sourceTimeoutMs:40,storageTimeoutMs:10};
 const [first,shared]=await Promise.all([isolated.getConditions(options),isolated.getConditions(options)]);
 assert.strictEqual(first,shared);
 assert.equal(first.sources.weather.status,'fresh');
 assert.equal(first.archive.active,false,'timed-out writes are not proof of archive success');
 assert.ok(writes>0,'the fixture exercised hanging archive and cache writes');
 const priorGets=gets;
 failWeather=true;
 const second=await isolated.getConditions({...options,now:at+60,force:true});
 assert.ok(gets>priorGets,'the pending collection is released after bounded storage timeouts');
 assert.equal(second.sources.weather.status,'cached');
 assert.equal(second.sources.weather.retrievedAt,at,'fallback retains actual original retrieval time');
});

test('a provider that never resolves or ignores abort cannot prevent a bounded partial response',{timeout:1500},async()=>{
 const isolated=await import('../server/conditions.js?conditions-provider-deadlines');
 const never=()=>new Promise(()=>{});
 const result=await isolated.getConditions({now:at,sourceTimeoutMs:20,storageTimeoutMs:10,fetchImpl:async url=>{
  if(url.includes('api.open-meteo.com'))return Response.json({hourly:{time:[at],wind_speed_10m:[8]}});
  return never();
 }});
 assert.equal(result.sources.weather.status,'fresh','one stalled provider does not discard a successful independent source');
 for(const key of ['marine','buoyModel','tides','nws','nwps','buoy'])assert.equal(result.sources[key].status,'unavailable',key);
 assert.equal(result.archive.active,false);
});

test('conditions collection ignores the obsolete cache without modifying stored historical data',async()=>{
 const isolated=await import('../server/conditions.js?conditions-obsolete-cache');
 const {values,reads,bucket}=memoryBucket();
 const old={generatedAt:at-60,sources:{weather:source({retrievedAt:at-60,data:{hourly:{time:[at],wind_speed_10m:[8]}}})}};
 const original=JSON.stringify(old);values.set('cache/conditions.json',original);
 let calls=0;
 const result=await isolated.getConditions({bucket,now:at,fetchImpl:async()=>{calls++;return new Response('Offline',{status:503});}});
 assert.ok(calls>0,'an obsolete cache must not suppress collection');
 assert.ok(!reads.includes('cache/conditions.json'),'the retired cache is no longer read');
 assert.equal(values.get('cache/conditions.json'),original,'historical storage is not modified or deleted');
 assert.ok(values.has('cache/conditions-v2.json'),'collection still writes the current hot cache');
 assert.equal(result.sources.weather.status,'unavailable','obsolete cache cannot alter new collection results');
 assert.equal(result.sources.weather.data,null);
});
