import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCoastalProduct,COASTAL_URLS,COASTAL_LIMITS} from '../server/coastal.js';

// Synthetic parser/service fixtures only. These are never shipped as live data.
const at=Date.parse('2026-10-21T12:00:00Z')/1000;
const metadata={id:'8665530',name:'Charleston',lat:'32.7808',lon:'-79.9236'};
const water=(overrides={})=>({t:'2026-10-21 11:54',v:'-0.125',s:'0.003',f:'0,0,0,0',q:'p',...overrides});
const wind=(overrides={})=>({t:'2026-10-21 11:54',s:'0.0',d:'360',dr:'N',g:'1.2',f:'0,0',...overrides});
const payload=rows=>({metadata,data:rows});
const iso=t=>new Date(t*1000).toISOString().slice(0,16).replace('T',' ');

test('coastal observations preserve datum, metric units, actual coordinates and independent timestamps',()=>{
 const level=parseCoastalProduct(payload([water()]),'waterLevel',{now:at});
 const breeze=parseCoastalProduct(payload([wind({t:'2026-10-21 11:48'})]),'wind',{now:at});
 assert.equal(level.status,'fresh');assert.equal(level.latest.levelM,-.125,'water below MLLW is valid');
 assert.equal(level.datum.name,'MLLW');assert.equal(level.datum.epoch,null);
 assert.equal(level.units.level,'m');assert.equal(level.latest.quality,'preliminary');
 assert.equal(level.station.latitude,32.7808);assert.equal(level.station.longitude,-79.9236);
 assert.equal(breeze.latest.speedMs,0,'calm wind is a real zero');assert.equal(breeze.latest.directionDeg,0);
 assert.equal(breeze.units.speed,'m/s');assert.equal(breeze.observedAt,at-720);
 assert.equal(level.observedAt,at-360);assert.equal(level.retrievedAt,at);
});

test('missing metrics stay missing, QC-flagged rows stay visible but never become latest usable observations',()=>{
 const result=parseCoastalProduct(payload([wind({s:'',g:''}),wind({t:'2026-10-21 11:48',s:'5',f:'1,0'}),wind({t:'2026-10-21 11:42',s:'3',d:'',g:''})]),'wind',{now:at});
 assert.equal(result.rows[0].speedMs,null);assert.equal(result.rows[0].gustMs,null);
 assert.equal(result.rows[1].qualityControl,'flagged');assert.equal(result.rows[1].speedMs,5);
 assert.equal(result.latest.speedMs,3);assert.equal(result.latest.gustMs,null);assert.equal(result.latest.directionDeg,null);
 for(const f of ['1,0,0,0','0,0,1,0','bad'])assert.equal(parseCoastalProduct(payload([water({f})]),'waterLevel',{now:at}).latest,null);
 assert.equal(parseCoastalProduct(payload([water({q:'unknown'})]),'waterLevel',{now:at}).latest,null);
});

test('station mismatches, future/invalid timestamps and duplicates cannot create a current observation',()=>{
 assert.equal(parseCoastalProduct({...payload([water()]),metadata:{...metadata,id:'8666467'}},'waterLevel',{now:at}).status,'unavailable');
 assert.equal(parseCoastalProduct({...payload([water()]),metadata:{...metadata,lat:''}},'waterLevel',{now:at}).status,'unavailable');
 for(const t of ['2026-02-30 11:54','2026-10-21 12:06','2026-10-21T11:54:00Z'])assert.equal(parseCoastalProduct(payload([water({t})]),'waterLevel',{now:at}).latest,null);
 assert.equal(parseCoastalProduct(payload([water(),water()]),'waterLevel',{now:at}).latest,null);
 const stale=parseCoastalProduct(payload([water({t:iso(at-3600)})]),'waterLevel',{now:at});
 assert.equal(stale.status,'stale');assert.equal(stale.observedAt,at-3600);
 assert.equal(parseCoastalProduct(payload([water({t:iso(at-COASTAL_LIMITS.maxAgeSeconds-60)})]),'waterLevel',{now:at}).latest,null);
});

function bucketFixture(){
 const values=new Map();let gets=0,puts=0;
 return {values,counts:()=>({gets,puts}),bucket:{async get(key){gets++;const s=values.get(key);return s===undefined?null:{json:async()=>JSON.parse(s)};},async put(key,value){puts++;values.set(key,value);}}};
}

test('coastal service makes only fixed bounded product requests, shares work and stamps completed retrieval',async()=>{
 const {getCoastal}=await import('../server/coastal.js?coastal-service');
 const fixture=bucketFixture(),urls=[];let clock=at;
 const fetchImpl=async url=>{
  urls.push(url);const product=new URL(url).searchParams.get('product');
  const body=JSON.stringify(payload([product==='wind'?wind():water()]));
  return new Response(new ReadableStream({start(controller){clock=at+7;controller.enqueue(new TextEncoder().encode(body));controller.close();}}));
 };
 const options={bucket:fixture.bucket,fetchImpl,now:()=>clock};
 const [one,two]=await Promise.all([getCoastal(options),getCoastal(options)]);
 assert.strictEqual(one,two);assert.equal(one.status,'ready');assert.equal(urls.length,2);
 for(const url of urls){const q=new URL(url).searchParams;assert.equal(q.get('station'),'8665530');assert.equal(q.get('units'),'metric');assert.equal(q.get('time_zone'),'gmt');assert.equal(q.get('range'),'6');}
 assert.equal(new URL(COASTAL_URLS.waterLevel).searchParams.get('datum'),'MLLW');
 assert.equal(one.sources.wind.retrievedAt,at+7);assert.equal(one.sources.waterLevel.retrievedAt,at+7);
 await getCoastal({...options,now:at+60});assert.equal(urls.length,2,'memory cache avoids repeated upstream calls');
 const cold=await import('../server/coastal.js?coastal-cold');
 const shared=await cold.getCoastal({...options,now:at+120});assert.equal(shared.status,'ready');assert.equal(urls.length,2,'R2 cache works across isolates');
});

test('coastal failures are isolated and cache fallback retains age then expires',async()=>{
 const {getCoastal}=await import('../server/coastal.js?coastal-fallback');
 const fixture=bucketFixture();let failWind=false;
 const fetchImpl=async url=>{
  if(new URL(url).searchParams.get('product')==='wind')return failWind?new Response('Unavailable',{status:503}):Response.json(payload([wind()]));
  return Response.json(payload([water()]));
 };
 const first=await getCoastal({bucket:fixture.bucket,fetchImpl,now:at});assert.equal(first.status,'ready');
 failWind=true;
 const second=await getCoastal({bucket:fixture.bucket,fetchImpl,now:at+1801,force:true});
 assert.equal(second.sources.wind.status,'stale');assert.equal(second.sources.wind.fallback,true);
 assert.equal(second.sources.wind.retrievedAt,at);assert.equal(second.sources.wind.observedAt,at-360);
 assert.equal(second.sources.waterLevel.fallback,false);assert.equal(second.sources.waterLevel.retrievedAt,at+1801);
 const expired=await getCoastal({bucket:fixture.bucket,fetchImpl,now:at+COASTAL_LIMITS.maxAgeSeconds+1,force:true});
 assert.equal(expired.sources.wind.status,'unavailable');assert.equal(expired.sources.wind.latest,null);
});

test('source and storage deadlines release pending work; oversized payloads never reach parsing',{timeout:1500},async()=>{
 const {getCoastal}=await import('../server/coastal.js?coastal-deadlines');
 let calls=0;
 const bucket={get:()=>new Promise(()=>{}),put:()=>new Promise(()=>{})};
 const never=()=>{calls++;return new Promise(()=>{});};
 const options={bucket,fetchImpl:never,now:at,sourceTimeoutMs:10,storageTimeoutMs:10};
 assert.equal((await getCoastal(options)).status,'unavailable');
 assert.equal((await getCoastal({...options,force:true})).status,'unavailable');assert.equal(calls,4,'failed work does not leave pending requests pinned');
 const large=await getCoastal({...options,force:true,fetchImpl:async()=>new Response(' '.repeat(COASTAL_LIMITS.maxResponseBytes+1))});
 assert.equal(large.status,'unavailable');
});
