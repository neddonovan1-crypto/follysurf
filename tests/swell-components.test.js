import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSwellComponents,currentSwellComponents,swellComponentsURL} from '../web/swell-components.js';
import {getSwellComponents} from '../server/swell-components.js';

// Live MFWAM/Open-Meteo response checked 2026-10-21 17 UTC at Folly's
// offshore request point. Model periods are means, not peak periods.
const at=1792602000;
const sample=()=>({latitude:32.625,longitude:-79.87499,hourly_units:{time:'unixtime',swell_wave_height:'m',swell_wave_direction:'°',swell_wave_period:'s',secondary_swell_wave_height:'m',secondary_swell_wave_direction:'°',secondary_swell_wave_period:'s'},hourly:{time:[at,at+3600,at+7200],swell_wave_height:[.88,.88,.86],swell_wave_direction:[79,78,78],swell_wave_period:[5.8,5.65,5.65],secondary_swell_wave_height:[.24,.26,.26],secondary_swell_wave_direction:[76,116,116],secondary_swell_wave_period:[8.15,9.05,9.2]}});
test('MFWAM components keep their common point/time, with valid-hour matching and freshness gates',()=>{
 const source=normalizeSwellComponents(sample(),{retrievedAt:at});
 assert.deepEqual(currentSwellComponents(source,at+3599).secondary,{heightM:.24,periodS:8.15,directionFromDeg:76});
 assert.equal(currentSwellComponents(source,at+3600).secondary.directionFromDeg,116);
 assert.equal(currentSwellComponents(source,at-1),null);
 assert.equal(currentSwellComponents(source,at+10800),null,'never extrapolate past coverage');
 assert.equal(currentSwellComponents({...source,status:'cached'},at),null);
 assert.equal(currentSwellComponents({...source,model:'best_match'},at),null);
 assert.equal(currentSwellComponents({...source,retrievedAt:at-21601},at),null);
 const url=new URL(swellComponentsURL());assert.equal(url.searchParams.get('models'),'meteofrance_wave');
 assert.match(url.searchParams.get('hourly'),/secondary_swell_wave_direction/);
});
test('Missing values, wrong units, or malformed coverage cannot become fabricated swell',()=>{
 const raw=sample();raw.hourly.secondary_swell_wave_height[0]=null;raw.hourly.secondary_swell_wave_direction[1]=999;
 const source=normalizeSwellComponents(raw,{retrievedAt:at});
 assert.equal(source.rows[0].secondary.heightM,null);assert.equal(source.rows[1].secondary.directionFromDeg,null);
 const units=sample();units.hourly_units.swell_wave_height='ft';assert.throws(()=>normalizeSwellComponents(units,{retrievedAt:at}));
 const times=sample();times.hourly.time[1]=at;assert.throws(()=>normalizeSwellComponents(times,{retrievedAt:at}));
 const missing=sample();missing.hourly.secondary_swell_wave_period.pop();assert.throws(()=>normalizeSwellComponents(missing,{retrievedAt:at}));
});
test('Independent collector caches original retrieval time and withholds old data after failure',async()=>{
 const values=new Map(),bucket={get:async k=>values.has(k)?{json:async()=>JSON.parse(values.get(k))}:null,put:async(k,v)=>values.set(k,v)};
 let fetches=0;
 const fetchImpl=async()=>{fetches++;return new Response(JSON.stringify(sample()));};
 const first=await getSwellComponents({bucket,fetchImpl,now:at});assert.equal(first.status,'fresh');assert.equal(values.size,1);
 const second=await getSwellComponents({bucket,fetchImpl,now:at+600});assert.equal(second.retrievedAt,at);assert.equal(fetches,1);
 const fail=await getSwellComponents({bucket,fetchImpl:async()=>new Response('',{status:503}),now:at+1201});
 assert.equal(fail.status,'unavailable');assert.deepEqual(fail.rows,[]);assert.equal(fail.retrievedAt,null);
 const timeout=await getSwellComponents({fetchImpl:()=>new Promise(()=>{}),now:at+1800,sourceTimeoutMs:15});assert.equal(timeout.status,'unavailable');
});
test('future swell matches the selected hour without treating fresh forecasts as stale',()=>{
 const source=normalizeSwellComponents(sample(),{retrievedAt:at});
 source.rows.push({...source.rows[0],t:at+86400});
 assert.deepEqual(currentSwellComponents(source,at+86400,at),source.rows.at(-1));
 assert.equal(currentSwellComponents(source,at+86400,at+21601),null);
 assert.equal(currentSwellComponents(source,at+90000,at),null);
});
