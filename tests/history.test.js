import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveHistory,archiveObservation,getHistory,compareAt,ratingSnapshot} from '../server/history.js';
import {publicURLs} from '../server/conditions.js';
const at=Date.parse('2026-10-21T12:10:00Z')/1000;
const validAt=Date.parse('2026-10-21T14:00:00Z')/1000;
const marine={status:'fresh',retrievedAt:at,issuedAt:null,sourceUrl:publicURLs(at).marine,data:{latitude:32.6,longitude:-79.9,hourly_units:{time:'unixtime',wave_height:'m',wave_period:'s'},hourly:{time:[validAt,validAt+3600],wave_height:[1.2,null],wave_period:[9,null]}}};
function storage(){
 const values=new Map(),writes=[];
 return {values,writes,bucket:{
  async put(key,value,options){assert.equal(options.onlyIf.get('If-None-Match'),'*');writes.push(key);if(!values.has(key))values.set(key,value);return {key};},
  async get(key){const value=values.get(key);return value===undefined?null:{json:async()=>JSON.parse(value),text:async()=>value};},
  async list({prefix,limit,cursor}){const keys=[...values.keys()].filter(k=>k.startsWith(prefix)).sort();const offset=Number(cursor??0);return {objects:keys.slice(offset,offset+limit).map(key=>({key})),truncated:offset+limit<keys.length,cursor:String(offset+limit)};}
 }};
}
test('complete immutable inputs preserve original units, locations, nulls, timestamps and raw responses',async()=>{
 const {bucket,values}=storage();
 const nwps={status:'fresh',retrievedAt:at,issuedAt:at-3600,sourceUrl:'https://nomads.ncep.noaa.gov/example',rawResponse:{format:'text',body:'original model output\n'},data:{points:[{id:'pier',latitude:32.6489,longitude:-79.938,rows:[{t:validAt,waveM:1.1,peakPeriodS:10,quality:'modeled'}]}]}};
 await archiveHistory(bucket,{marine,nwps},{at:at+1});
 const key=[...values.keys()].find(k=>k.startsWith('archive/inputs/marine/'));
 const original=values.get(key);
 await archiveHistory(bucket,{marine,nwps},{at:at+60});
 assert.equal(values.get(key),original,'later collection cannot overwrite an earlier recorded input');
 const saved=JSON.parse(original);
 assert.equal(saved.retrievedAt,at);assert.equal(saved.recordedAt,at+1);assert.equal(saved.issuedAt,null);
 assert.equal(saved.formulaVersion,4);assert.equal(saved.metadata.units.wave_height,'m');assert.equal(saved.metadata.location.latitude,32.6);
 assert.equal(saved.data.hourly.wave_height[1],null,'missing forecast hours stay missing');
 const page=await getHistory({bucket,date:'2026-10-21',source:'nwps',now:at+120});
 const raw=await getHistory({bucket,date:'2026-10-21',source:'nwps',snapshot:page.snapshots[0].id,raw:true,now:at+120});
 assert.equal(raw.snapshots[0].rawResponse.body,'original model output\n');
 assert.equal(raw.snapshots[0].metadata.units.waveM,'m');
});
test('history comparison only uses actually saved forecasts preceding the valid forecast hour',async()=>{
 const {bucket}=storage();await archiveHistory(bucket,{marine},{at:at+1});
 const result=await getHistory({bucket,date:'2026-10-21',source:'marine',validAt,now:validAt});
 assert.equal(result.status,'ready');const saved=result.snapshots[0];
 assert.equal(saved.comparison.values.wave_height,1.2);assert.equal(saved.comparison.units.wave_height,'m');
 assert.equal(saved.comparison.leadHours,(validAt-at)/3600);
 assert.equal(compareAt({...saved,retrievedAt:validAt},validAt),null);
 assert.equal(compareAt({...saved,issuedAt:validAt+1},validAt),null);
 assert.equal(compareAt({...saved,recordedAt:validAt+1},validAt),null);
 assert.equal(compareAt(saved,validAt-7200),null,'no out-of-range interpolation');
 assert.equal(compareAt({...saved,retrievedAt:validAt+10,recordedAt:validAt+10},validAt+20),null,'a later retrieval is not an advance forecast for the ongoing hour');
 const missing=compareAt(saved,validAt+3600);assert.equal(missing.values.wave_height,null);
});
test('history request is source/date scoped, paginated and rejects arbitrary private keys',async()=>{
 const {bucket,values}=storage();
 for(let i=0;i<10;i++)await archiveHistory(bucket,{marine:{...marine,retrievedAt:at+i}},{at:at+i+1});
 values.set('private/credentials.json','not exposed');
 const first=await getHistory({bucket,date:'2026-10-21',source:'marine',limit:99,now:validAt});
 assert.equal(first.snapshots.length,8);assert.equal(first.truncated,true);
 const next=await getHistory({bucket,date:'2026-10-21',source:'marine',cursor:first.cursor,now:validAt});
 assert.equal(next.snapshots.length,2);assert.equal(next.truncated,false);
 await assert.rejects(getHistory({bucket,date:'2026-10-21',source:'../private',now:validAt}),TypeError);
 await assert.rejects(getHistory({bucket,date:'2026-02-31',now:validAt}),TypeError);
 await assert.rejects(getHistory({bucket,date:'2026-10-22',now:validAt}),TypeError);
 await assert.rejects(getHistory({bucket,date:'2026-10-21',snapshot:'../../private/credentials',now:validAt}),TypeError);
 assert.equal((await getHistory({bucket,date:'2026-10-20',source:'marine',now:validAt})).status,'empty');
});
test('historical storage timeouts fail closed without fabricating empty success',{timeout:1000},async()=>{
 const result=await getHistory({bucket:{list:()=>new Promise(()=>{})},date:'2026-10-21',now:validAt,timeoutMs:10});
 assert.equal(result.status,'unavailable');assert.deepEqual(result.snapshots,[]);
});
test('rating snapshots preserve future predictions and inputs, never retrospective scores',()=>{
 const wind={status:'fresh',retrievedAt:at,issuedAt:null,data:{hourly_units:{wind_speed_10m:'mp/h'},hourly:{time:[at-3600,validAt],wind_speed_10m:[8,8],wind_direction_10m:[315,315],wind_gusts_10m:[10,10]}}};
 const nwps={status:'fresh',retrievedAt:at,issuedAt:at-3600,data:{points:[{id:'pier',rows:[{t:at-3600,waveM:1.2,peakPeriodS:11},{t:validAt,waveM:1.2,peakPeriodS:11,relativeDirectionDeg:-25}]}]}};
 const saved=ratingSnapshot({weather:wind,nwps},at+1);
 assert.equal(saved.firstSeenAt,at+1);assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].validAt,validAt);assert.equal(saved.rows[0].locationId,'pier');assert.equal(saved.rows[0].heightKind,'nearshore-significant');assert.ok(Number.isFinite(saved.rows[0].score));assert.equal(saved.inputs.weather.retrievedAt,at);
 assert.equal(ratingSnapshot({weather:{...wind,status:'cached'},nwps},at+1),null);
 assert.equal(saved.version,4);assert.equal(saved.rows[0].relativeDirectionDeg,-25);
 assert.deepEqual(saved.rows[0].components.map(c=>c.id),['size','period','wind']);
 assert.equal(ratingSnapshot({weather:wind,nwps:{...nwps,data:{points:[{id:'pier',rows:[{t:validAt,waveM:1.2,peakPeriodS:11}]}]}}},at+1).rows[0].relativeDirectionDeg,null);
});
test('extended requests ask for sixteen days without inventing provider coverage',()=>{
 const urls=publicURLs(at);
 for(const key of ['weather','marine'])assert.equal(new URL(urls[key]).searchParams.get('forecast_days'),'16');
 assert.equal(new URL(urls.weather).searchParams.get('wind_speed_unit'),'mph');
});

const spectrum={schemaVersion:1,status:'fresh',station:{id:'41004'},observedAt:at-600,retrievedAt:at,units:{density:'m²/Hz'},bins:[{frequencyHz:.1,densityM2PerHz:2,meanDirectionDeg:null}],quality:'realtime-provisional'};
test('observation archives deduplicate cached results and retain actual times and quality',async()=>{
 const {bucket,writes}=storage();
 await Promise.all([archiveObservation(bucket,'spectra',spectrum,{at:at+1}),archiveObservation(bucket,'spectra',{...spectrum,checkedAt:at+30},{at:at+30})]);
 assert.equal(writes.length,1);
 const history=await getHistory({bucket,source:'spectra',date:'2026-10-21',now:at+60});
 const saved=history.snapshots[0];
 assert.equal(saved.data.observedAt,at-600);assert.equal(saved.retrievedAt,at);
 assert.equal(saved.data.bins[0].meanDirectionDeg,null);assert.equal(saved.data.quality,'realtime-provisional');
 assert.equal(saved.metadata.kind,'observation');assert.equal(saved.comparison,null);
 assert.match(history.comparisonType,/recorded observations/);
 assert.match(saved.metadata.representation,/raw provider responses not retained/);
});
test('coastal archives only fresh successful products with original datum and quality flags',async()=>{
 const {bucket}=storage();
 const waterLevel={status:'fresh',fallback:false,retrievedAt:at,observedAt:at-60,latest:{observedAt:at-60,levelM:.2,quality:'preliminary',flags:'0,0'},rows:[],units:{levelM:'m'},datum:'MLLW'};
 const coastal={station:{id:'8665530'},sources:{waterLevel,wind:{...waterLevel,status:'stale',fallback:true}}};
 assert.equal(await archiveObservation(bucket,'coastal',coastal,{at:at+1}),1);
 const history=await getHistory({bucket,source:'coastal',date:'2026-10-21',now:at+60});
 const saved=history.snapshots[0];
 assert.deepEqual(Object.keys(saved.data.sources),['waterLevel']);
 assert.equal(saved.metadata.units.waterLevel.datum,'MLLW');
 assert.equal(saved.data.sources.waterLevel.latest.quality,'preliminary');
 assert.equal(saved.data.sources.waterLevel.retrievedAt,at);
});
test('observation archive rejects fallback/future data and bounds failures without blocking retries',async()=>{
 const {bucket,writes}=storage();
 for(const change of [{status:'stale'},{error:'retrieval failed'},{fallback:true},{retrievedAt:at+60},{observedAt:at+60}]){
  assert.equal(await archiveObservation(bucket,'spectra',{...spectrum,...change},{at}),0);
 }
 assert.equal(writes.length,0);
 let fail=true;
 const hanging={put:()=>fail?new Promise(()=>{}):Promise.resolve({})};
 await assert.rejects(archiveObservation(hanging,'spectra',spectrum,{at,timeoutMs:5}),/deadline/);
 fail=false;
 assert.equal(await archiveObservation(hanging,'spectra',spectrum,{at,timeoutMs:5}),1);
});
