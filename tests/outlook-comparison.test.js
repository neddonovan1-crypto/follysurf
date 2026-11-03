import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateOutlook as v2} from '../research/models/folly-index-v2.js';
import {evaluateOutlook as v3} from '../research/models/folly-index-v3.js';
import {evaluateOutlook as v4} from '../web/outlook.js';
import {rankSessionWindows} from '../web/session-windows.js';
const fixture=JSON.parse(readFileSync(new URL('../research/models/sunday-forecast.json',import.meta.url),'utf8'));
test('captured Sunday forecast retains historical versions and uses the compromise for new session scores',()=>{
 const hours=fixture.hours;
 assert.deepEqual(hours.map(h=>v2({...h,sourceFresh:true}).score),[15,15]);
 assert.deepEqual(hours.map(h=>v3({...h,sourceFresh:true}).score),[29,30]);
 const start=hours[0].t;
 const ranked=rankSessionWindows({rows:hours.map(h=>({...h,isDay:1})),nearshoreRows:hours.map(h=>({t:h.t,...h.nearshore})),
  daily:{sunrise:[start-1800],sunset:[start+36000]},now:start-86400,day:'2026-10-25',weatherFresh:true,nearshoreFresh:true});
 assert.deepEqual(hours.map(h=>v4({...h,sourceFresh:true}).score),[22,23]);
 assert.equal(ranked.best.score,22);
 assert.deepEqual(ranked.best.periodRangeS,{min:8.2,max:8.239});
 assert.equal(ranked.best.outlookReason,'Gusty winds may roughen the water.');
 assert.equal(ranked.best.hourlyOutlooks[0].components.find(c=>c.id==='wind').value<.3,true);
});

test('Pier diagnostic reproduces 46/61/55 without reviving the separate gust penalty',()=>{
 const input={nearshore:{waveM:3.1*.3048,peakPeriodS:10.9},wind:10,windDir:17,gust:13,sourceFresh:true};
 const old=v2(input),plateau=v3(input),blend=v4(input);
 assert.deepEqual([old.score,plateau.score,blend.score],[46,61,55]);
 assert.equal(blend.label,'Fair');assert.equal(blend.version,4);
 assert.equal(blend.components.find(c=>c.id==='period').value,.895);
 assert.deepEqual(blend.components.filter(c=>c.id!=='period'),plateau.components.filter(c=>c.id!=='period'));
 assert.equal(blend.gustCeiling,undefined);
});
test('compromise stays between period preferences with the same single wind response',()=>{
 for(const peakPeriodS of [3,3.1,4,5,6,7,8,10.9,13,20])for(const gust of [5,20,35]){
  const input={nearshore:{waveM:.8,peakPeriodS},wind:5,windDir:45,gust,sourceFresh:true};
  const old=v2(input),plateau=v3(input),blend=v4(input),period=r=>r.components.find(c=>c.id==='period').value;
  assert.ok(period(blend)>=Math.min(period(old),period(plateau))&&period(blend)<=Math.max(period(old),period(plateau)));
  assert.equal(blend.effectiveWindMph,plateau.effectiveWindMph);
 }
});
