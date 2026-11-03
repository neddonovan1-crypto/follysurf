import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSpectrum,combineSpectra,getSpectra,SPECTRA_URLS} from '../server/spectra.js';
const density=readFileSync(new URL('./fixtures/spectra-41004.data_spec',import.meta.url),'utf8');
const direction=readFileSync(new URL('./fixtures/spectra-41004.swdir',import.meta.url),'utf8');
const observedAt=Date.parse('2026-10-21T02:20:00Z')/1000,now=observedAt+1800;
test('public NOAA row preserves density, periods, alpha1 and missing directions',()=>{
 const result=combineSpectra(density,direction,{now});
 assert.equal(result.bins.length,46);assert.equal(result.observedAt,observedAt);
 assert.equal(result.bins[0].densityM2PerHz,0);assert.equal(result.bins[0].meanDirectionDeg,null);
 assert.equal(result.peakPeriodSeconds,1/.170);assert.equal(result.peakDirectionDeg,64);
 assert.equal(result.units.density,'m²/Hz');assert.equal(result.status,'fresh');
});
test('density sentinel is missing, not an enormous artificial peak; zero stays zero',()=>{
 const result=combineSpectra(density.replace('1.760 (0.170)','999.000 (0.170)'),direction,{now});
 assert.equal(result.missingBins,1);assert.equal(result.bins[20].densityM2PerHz,null);
 assert.equal(result.peakPeriodSeconds,1/.160);
 assert.equal(combineSpectra(density.replace('1.760 (0.170)','MM (0.170)'),direction,{now}).missingBins,1);
});
test('directions join exact timestamp and frequency, never nearest row or array index',()=>{
 assert.equal(combineSpectra(density,direction.replace('02 20','01 20'),{now}).directionAvailable,false);
 const shifted=direction.replace('64.0 (0.170)','64.0 (0.175)');
 assert.equal(combineSpectra(density,shifted,{now}).peakDirectionDeg,null);
 assert.equal(combineSpectra(density,direction.replace('64.0 (0.170)','360.0 (0.170)'),{now}).peakDirectionDeg,0);
});
test('malformed, duplicate, nonmonotonic, future and stale rows cannot become current data',()=>{
 for(const input of ['<html>NOAA maintenance</html>',density.replace('10 21','02 31'),density.replace('(0.170)','(0.160)'),density.replace('(0.170)','(0.100)')])assert.deepEqual(parseSpectrum(input,{now}),[]);
 assert.equal(combineSpectra(density,direction,{now:observedAt-301}).status,'unavailable');
 assert.equal(combineSpectra(density,direction,{now:observedAt+10801}).status,'stale');
 assert.equal(combineSpectra(density,direction,{now:observedAt+86401}).status,'unavailable');
});
test('runtime fetch uses real public endpoints; optional direction failure and expired fallback are honest',async()=>{
 const calls=[];
 const first=await getSpectra({force:true,now,fetchImpl:async url=>{calls.push(url);return new Response(url===SPECTRA_URLS.density?density:'unavailable',{status:url===SPECTRA_URLS.density?200:503});}});
 assert.deepEqual(calls.sort(),Object.values(SPECTRA_URLS).sort());assert.equal(first.bins.length,46);assert.equal(first.directionAvailable,false);
 const cached=await getSpectra({force:true,now:now+1200,fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(cached.observedAt,observedAt);assert.equal(cached.retrievedAt,now);assert.match(cached.error,/previous observation/);
 const expired=await getSpectra({force:true,now:observedAt+86401,fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(expired.status,'unavailable');assert.deepEqual(expired.bins,[]);
});
test('network deadline and oversize responses resolve unavailable without hanging',async()=>{
 const at=observedAt+2*86400;
 const stalled=await getSpectra({force:true,now:at,sourceTimeoutMs:10,fetchImpl:()=>new Promise(()=>{})});
 assert.equal(stalled.status,'unavailable');
 const oversized=await getSpectra({force:true,now:at,fetchImpl:async()=>new Response('x'.repeat(300001))});
 assert.equal(oversized.status,'unavailable');
});
test('large real-time files stop after complete recent rows and cancel the remaining download',async()=>{
 let cancelled=0;
 const result=await getSpectra({force:true,now,fetchImpl:async url=>{
  const fixture=url===SPECTRA_URLS.density?density:direction;
  const [header,row]=fixture.trim().split('\n');
  const prefix=header+'\n'+Array(33).fill(row).join('\n')+'\n';
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(prefix));},cancel(){cancelled++;}}));
 }});
 assert.equal(result.bins.length,46);assert.equal(result.peakDirectionDeg,64);assert.equal(cancelled,2);
});
test('retrievedAt records completed contributing reads, never request start or failed direction completion',async()=>{
 for(const directionWorks of [true,false]){
  let clock=now;
  const result=await getSpectra({force:true,now:()=>clock,fetchImpl:async url=>{
   if(url===SPECTRA_URLS.density){clock=now+3;return new Response(density);}
   await new Promise(resolve=>setTimeout(resolve,5));clock=now+8;
   if(!directionWorks)throw Error('direction unavailable');
   return new Response(direction);
  }});
  assert.equal(result.retrievedAt,now+(directionWorks?8:3));
  assert.equal(result.observedAt,observedAt);
  assert.equal(result.directionAvailable,directionWorks);
 }
});
