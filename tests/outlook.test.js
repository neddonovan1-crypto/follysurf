import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOutlook,sourceUsable} from '../web/outlook.js';
const base={nearshore:{waveM:1.2,peakPeriodS:13},wind:0,windDir:315,gust:0,sourceFresh:true};
const rate=(overrides={})=>evaluateOutlook({...base,...overrides});
test('complete nearshore setup does not require an NWS period',()=>{
 const result=rate();
 assert.equal(result.score,100);assert.equal(result.label,'Standout');assert.equal(result.level,5);
 assert.equal(result.confidence,'Model outlook');assert.equal(result.version,4);assert.equal(result.basis,'nearshore');
});
test('flat waves remain zero regardless of wind and gusts',()=>{
 for(const wind of [0,2,5,15,25])for(const windDir of [0,135,315]){
  assert.equal(rate({nearshore:{waveM:0,peakPeriodS:13},wind,windDir,gust:wind+5}).score,0);
 }
});
test('period and wave potential bound score even in ideal wind',()=>{
 assert.equal(rate({nearshore:{waveM:1.2,peakPeriodS:6}}).score,57);
 assert.equal(rate({nearshore:{waveM:.5,peakPeriodS:20}}).score,42);
 assert.equal(rate({nearshore:{waveM:4.8,peakPeriodS:20}}).score,0);
 assert.equal(rate({nearshore:{waveM:5.5,peakPeriodS:20}}).score,0);
 const before=rate({nearshore:{waveM:.499,peakPeriodS:13}}).score;
 const after=rate({nearshore:{waveM:.5,peakPeriodS:13}}).score;
 assert.ok(Math.abs(after-before)<=1,'no abrupt height threshold reward');
});
test('wind effects are circular and strong winds limit quality without caps',()=>{
 assert.equal(rate({wind:7,windDir:-45,gust:7}).score,rate({wind:7,windDir:315,gust:7}).score);
 assert.ok(rate({wind:7,windDir:135,gust:7}).score<rate({wind:7,windDir:315,gust:7}).score);
 assert.ok(rate({wind:15,windDir:135,gust:15}).score<20);
 assert.ok(rate({wind:25,windDir:315,gust:25}).score<40);
 for(const windDir of [0,135,315,null])assert.equal(rate({windDir}).score,100);
 for(const windDir of [0,135,315])assert.ok(Math.abs(rate({wind:2.999,windDir,gust:3}).score-rate({wind:3,windDir,gust:3}).score)<=1);
});
test('missing gusts produce only a possibility range, never a favourable scalar',()=>{
 const missing=rate({gust:null});
 assert.equal(missing.score,null);assert.deepEqual(missing.scoreRange,{min:0,max:100});
 assert.equal(missing.level,0);assert.equal(missing.label,'Partial forecast');assert.equal(missing.confidence,'Gusts unavailable');
 for(const wind of [0,2,7,15,25])for(const gust of [wind,wind+5,wind+40]){
  const unknown=rate({wind,gust:null}),known=rate({wind,gust});
  assert.equal(unknown.score,null);assert.ok(unknown.scoreRange.min<=known.score&&unknown.scoreRange.max>=known.score);
 }
});
test('missing light-wind direction produces a range containing every alignment',()=>{
 for(const gust of [2,3,15,30,40,45]){
  const partial=rate({wind:2,windDir:null,gust});
  assert.equal(partial.score,null);assert.equal(partial.level,0);
  assert.equal(partial.confidence,'Wind direction unavailable');
  for(let windDir=0;windDir<360;windDir+=5){
   const score=rate({wind:2,windDir,gust}).score;
   assert.ok(score>=partial.scoreRange.min&&score<=partial.scoreRange.max);
  }
 }
 assert.equal(rate({wind:3,windDir:null,gust:3}).score,null);
 assert.equal(rate({wind:3,windDir:null,gust:3}).scoreRange,undefined);
 assert.equal(rate({wind:0,windDir:null,gust:0}).score,100);
});
test('joint missing direction and gust bounds maximise both unknowns',()=>{
 const partial=rate({wind:2,windDir:null,gust:null});
 assert.equal(partial.score,null);assert.equal(partial.level,0);
 assert.deepEqual(partial.scoreRange,{min:0,max:98});
 assert.equal(partial.confidence,'Wind direction and Gusts unavailable');
 for(let windDir=0;windDir<360;windDir+=5)for(const gust of [1,2,3,15,30,40,45,60]){
  const score=rate({wind:2,windDir,gust}).score;
  assert.ok(score>=partial.scoreRange.min&&score<=partial.scoreRange.max);
 }
 const inconsistent=rate({wind:2.5,windDir:null,gust:0});
 assert.equal(inconsistent.score,null);assert.ok(inconsistent.scoreRange.max>=rate({wind:2.5,windDir:315,gust:2.5}).score);
});
test('inconsistent gust data becomes partial, with one mph rounding tolerance',()=>{
 assert.equal(rate({wind:10,gust:8}).score,null);
 assert.equal(rate({wind:10,gust:8}).label,'Partial forecast');
 assert.ok(Number.isFinite(rate({wind:10,gust:9}).score));
});
test('gusts enter one continuous wind response and severe gusts remain limiting',()=>{
 assert.ok(rate({wind:5,gust:40}).score<40);
 assert.ok(rate({wind:5,gust:30}).score<60);
 assert.equal(rate({wind:5,gust:40}).reason,'Strong wind gusts expected.');
 assert.ok(rate({wind:5,gust:45}).score<20);
 assert.equal(rate({wind:5,gust:60}).score,0);
 assert.deepEqual(rate().components.map(c=>c.id),['size','period','wind']);
 assert.equal(rate().gustCeiling,undefined);
 for(const gust of [12/.7,20,30,45]){
  assert.ok(Math.abs(rate({gust:gust-.001}).score-rate({gust:gust+.001}).score)<=1);
 }
 let previous=101;
 for(let gust=0;gust<=50;gust+=.5){const score=rate({gust}).score;assert.ok(score<=previous);previous=score;}
});
test('stale or missing core fields and mean-period substitutes produce no score',()=>{
 for(const input of [{},{...base,sourceFresh:false},{...base,wind:null},{...base,wind:NaN},{...base,nearshore:null},{...base,nearshore:{waveM:1,period:13}},{...base,nearshore:{waveM:1,peakPeriodS:null}},{...base,nearshore:{waveM:1,peakPeriodS:0}},{...base,nearshore:null,offshore:{wave:1.2,period:13,wave_peak_period:null}}]){
  assert.equal(evaluateOutlook(input).score,null);
 }
 assert.equal(sourceUsable({status:'fresh',data:{},issuedAt:0},90000,86400),false);
});
test('unrelated offshore swell share and approach angle cannot boost rating',()=>{
 const changed=rate({nearshore:{...base.nearshore,relativeDirectionDeg:80},offshore:{wave:1.5,swell:1.5,waveDir:135}});
 assert.equal(changed.score,rate().score);
});
test('captured nearshore forecast scenario can improve without claiming observed quality',()=>{
 const result=rate({nearshore:{waveM:.9737,peakPeriodS:11.897},wind:7.1,windDir:358,gust:17.4});
 assert.equal(result.score,60);assert.equal(result.label,'Promising');assert.equal(result.level,4);
});
test('finite valid extremes always produce bounded scores',()=>{
 for(const waveM of [0,.1,1,5,30])for(const peakPeriodS of [.1,6,13,30])for(const wind of [0,5,30,100]){
  const result=rate({nearshore:{waveM,peakPeriodS},wind,gust:wind+3});
  assert.ok(Number.isFinite(result.score)&&result.score>=0&&result.score<=100);
 }
});

test('viewer explanation follows the limiting conditions without claiming beach observations',()=>{
 const examples=[
  [{nearshore:{waveM:0,peakPeriodS:13}},'Very small waves expected.'],
  [{nearshore:{waveM:.4,peakPeriodS:13}},'Small waves expected.'],
  [{nearshore:{waveM:4,peakPeriodS:13}},'Very large waves expected.'],
  [{nearshore:{waveM:1.2,peakPeriodS:6}},'Peak period about 6 seconds.'],
  [{wind:15,windDir:135,gust:15},'Onshore winds; likely choppy.'],
  [{wind:20,windDir:315,gust:20},'Strong offshore winds.'],
  [{wind:10,windDir:225,gust:10},'Cross-shore winds; likely choppy.'],
  [{wind:0,gust:18},'Gusty winds may roughen the water.'],
  [{nearshore:{waveM:.9737,peakPeriodS:11.897},wind:7.1,windDir:358,gust:17.4},'Gusty winds may roughen the water.'],
 ];
 for(const [input,reason] of examples)assert.equal(rate(input).reason,reason);
 assert.equal(rate().reason,'Well-spaced waves with favourable winds.');
});

test('interim period preference gives partial credit through 13 seconds without discontinuities',()=>{
 const scores=[3,6,7,8,10,13,16,20].map(peakPeriodS=>rate({nearshore:{waveM:1.2,peakPeriodS}}).score);
 assert.deepEqual(scores,[0,57,70,75,85,100,100,100]);
 assert.equal(rate().periodGuidance,'beyond-guidance-range-unvalidated');
 for(const t of [3,6,7,13]){
  const before=rate({nearshore:{waveM:1.2,peakPeriodS:t-.001}}).score;
  const after=rate({nearshore:{waveM:1.2,peakPeriodS:t+.001}}).score;
  assert.ok(Math.abs(after-before)<=1);
 }
});

test('zero sustained wind cannot hide unknown direction when gusts are present',()=>{
 const partial=rate({wind:0,windDir:null,gust:25});
 assert.equal(partial.score,null);
 for(let windDir=0;windDir<360;windDir+=5){
  const complete=rate({wind:0,windDir,gust:25});
  assert.ok(complete.score>=partial.scoreRange.min&&complete.score<=partial.scoreRange.max);
 }
 assert.equal(rate({wind:0,windDir:null,gust:null}).score,null);
});
