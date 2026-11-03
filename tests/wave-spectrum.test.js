import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSwanSpectrum,summarizeDirectionalSpectrum} from '../server/wave-spectrum.js';
import {getWaveSpectra,WAVE_SPECTRUM_POINTS} from '../server/wave-spectra.js';
const fixture=readFileSync(new URL('./fixtures/nwps-chshb-20261021-12.spc',import.meta.url),'utf8');
const cycle=Date.parse('2026-10-21T12:00Z')/1000;
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('actual NOAA two-hour spectrum preserves location, time, units and integrated band shares',()=>{
 const d=parseSwanSpectrum(fixture,{cycle,expectedLocation:WAVE_SPECTRUM_POINTS[0]});
 assert.equal(d.rows.length,2);assert.equal(d.rows[1].t,cycle+3600);
 close(d.longitude,-79.839996);assert.equal(d.frequenciesHz.length,37);assert.equal(d.directionsFromDeg.length,36);
 const f=d.rows[0].features;
 close(f.bands.reduce((sum,b)=>sum+b.varianceShare,0),1);
 assert.ok(f.peakPeriodS>11&&f.peakPeriodS<11.2);
 assert.ok(f.bands[0].varianceShare>.51&&f.bands[0].varianceShare<.53);
 assert.ok(f.meanDirectionFromDeg>80&&f.meanDirectionFromDeg<85);
});
test('analytical isotropic field integrates degrees and Hz exactly; no fake dominant direction',()=>{
 const d=Array.from({length:36},(_,i)=>i*10);
 const s=summarizeDirectionalSpectrum([.1,.2],d,[d.map(()=>1),d.map(()=>1)]);
 close(s.varianceM2,72);close(s.spectralHeightM,4*Math.sqrt(72));assert.equal(s.meanDirectionFromDeg,null);
 close(s.directionalConcentration,0);close(s.bands.reduce((n,b)=>n+b.varianceM2,0),72);
});
test('circular directions crossing north do not average toward south',()=>{
 const d=Array.from({length:36},(_,i)=>5+i*10),density=d.map((_,i)=>i===0||i===35?1:0);
 const s=summarizeDirectionalSpectrum([.1,.2],d,[density,density]);
 assert.ok(s.meanDirectionFromDeg<1||s.meanDirectionFromDeg>359);assert.ok(s.directionalSpreadDeg<6);
});
test('missing cells invalidate the hour; malformed units, coordinates, cycle and truncated tables fail closed',()=>{
 const missing=fixture.replace(/\n    0    0/,'\n  -99    0');
 assert.equal(parseSwanSpectrum(missing,{cycle}).rows[0].features,null);
 for(const value of [fixture.replace('AFREQ','RFREQ'),fixture.replace('NDIR','CDIR'),fixture.replace(/^m2\/Hz\/degr/m,'J/m2/Hz/degr'),fixture.slice(0,-100)])assert.throws(()=>parseSwanSpectrum(value,{cycle}));
 assert.throws(()=>parseSwanSpectrum(fixture,{cycle:cycle-21600}));
 assert.throws(()=>parseSwanSpectrum(fixture,{cycle,expectedLocation:{latitude:32,longitude:-79}}));
});
test('explicit ZERO is distinct from NODATA and has no invented direction or period',()=>{
 const header=fixture.split('20261021.120000')[0];
 const d=parseSwanSpectrum(header+'20261021.120000\nZERO\n20261021.130000\nNODATA\n',{cycle});
 assert.equal(d.rows[0].features.spectralHeightM,0);assert.equal(d.rows[0].features.peakPeriodS,null);assert.equal(d.rows[1].features,null);
});
test('collection retains raw spectra, omits raw visitor payload, archives partial coverage and reuses cache',async()=>{
 const values=new Map();let calls=0;
 const bucket={get:async key=>values.has(key)?{json:async()=>JSON.parse(values.get(key))}:null,
  put:async(key,value,options)=>{if(options?.onlyIf&&values.has(key))return null;values.set(key,value);return {key};}};
 const fetchImpl=async url=>{calls++;return url.includes('_CHSHB_')?new Response(fixture):new Response('Missing', {status:404});};
 const result=await getWaveSpectra({bucket,fetchImpl,now:cycle+900,force:true});
 assert.equal(result.status,'fresh');assert.equal(result.archiveSaved,true);assert.equal(result.rawResponse,undefined);
 assert.deepEqual(result.data.missingPoints,['NAVB6','41004']);assert.equal(result.data.scoreEligible,false);
 assert.equal(calls,3);assert.ok([...values.keys()].some(k=>k.startsWith('archive/raw/nwpsSpectra/')));
 const snapshot=JSON.parse([...values].find(([k])=>k.startsWith('archive/inputs/nwpsSpectra/'))[1]);
 assert.equal(snapshot.metadata.modelSelection,'NOAA NWPS CHS CG1');assert.equal(snapshot.metadata.location[0].id,'CHSHB');
 await getWaveSpectra({bucket,fetchImpl,now:cycle+1000});assert.equal(calls,3);
});
test('network and missing-file failures terminate within one collection budget',async()=>{
 let calls=0;
 const result=await getWaveSpectra({fetchImpl:async()=>{calls++;return new Response('Missing',{status:404});},now:cycle+900,force:true});
 assert.equal(result.status,'unavailable');assert.equal(result.archiveSaved,false);assert.equal(calls,9);
 const timed=await getWaveSpectra({fetchImpl:()=>new Promise(()=>{}),now:cycle+900,force:true,sourceTimeoutMs:20});
 assert.equal(timed.status,'unavailable');
});
