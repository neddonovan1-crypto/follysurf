import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFollyObservations,validateObservationPlan,importRatingSnapshots} from '../server/calibration.js';
const at=100000;
const plan={schemaVersion:1,planId:'test-only',formulaVersion:2,protocol:'Synthetic test fixture; 10 minute independent land observation.',sessionMinutes:10,frozenAt:at-20000,leadMinHours:1,leadMaxHours:24,locations:[{id:'pier',latitude:32.65,longitude:-79.94,matchRadiusM:250}],events:[{id:'event-a',eventGroup:'storm-a',startAt:at-1000,endAt:at+1000,split:'holdout',nourishmentEra:'unknown'}]};
const observation=(observerId,quality=3)=>({id:observerId,eventId:'event-a',sessionId:'session-a',observerId,locationId:'pier',latitude:32.65,longitude:-79.94,observedAt:at,recordedAt:at+60,durationMinutes:10,independent:true,blindToForecast:true,qualityScale:'folly-observer-v1',quality,boardClass:'longboard',skillClass:'intermediate',height:{kind:'breaking-face-range',min:.5,max:1,unit:'m'}});
const snapshot={schemaVersion:1,type:'folly-index',version:2,firstSeenAt:at-7200,issuedAt:null,inputs:{nwps:{issuedAt:at-10800,retrievedAt:at-7300}},rows:[{locationId:'pier',validAt:at,score:54,level:3,basis:'nearshore',heightKind:'nearshore-significant',waveM:1}]};
const run=(extra={})=>evaluateFollyObservations({plan,observations:[observation('a'),observation('b',4)],snapshots:[snapshot],now:at+600,...extra});
test('prospective matching preserves location, lead, cohort and independent agreement',()=>{
 const result=run();assert.equal(result.matchedSessions,1);assert.equal(result.matches[0].observedQuality,3.5);assert.equal(result.matches[0].leadHours,2);
 assert.equal(result.matches[0].heightComparison,null);assert.equal(result.strata[0].observerMeanAbsoluteDifference,1);assert.equal(result.strata[0].split,'holdout');
});
test('whole-event and overlapping-window leakage is rejected before analysis',()=>{
 for(const eventGroup of ['storm-a','other-storm'])assert.throws(()=>validateObservationPlan({...plan,events:[...plan.events,{...plan.events[0],id:'b',eventGroup,split:'development'}]}),/cross/);
 assert.throws(()=>validateObservationPlan({...plan,frozenAt:at}),/Freeze/);
});
test('late retrieval or future issue cannot masquerade as prospective forecast',()=>{
 assert.equal(run({snapshots:[{...snapshot,firstSeenAt:at+1}]}).matchedSessions,0);
 assert.equal(importRatingSnapshots([{...snapshot,issuedAt:at}]).rows.length,0);
 assert.equal(run({snapshots:[{...snapshot,rows:[{...snapshot.rows[0],score:null}]}]}).matchedSessions,0);
});
test('unblinded, duplicate observer and off-location reports cannot inflate evidence',()=>{
 assert.equal(run({observations:[observation('a'),{...observation('b'),blindToForecast:false}]}).matchedSessions,0);
 assert.equal(run({observations:[observation('a'),{...observation('a'),id:'different-id'}]}).matchedSessions,0);
 assert.equal(run({observations:[observation('a'),{...observation('b'),latitude:33}]}).matchedSessions,0);
});
test('board cohorts and height semantics remain separate',()=>{
 assert.equal(run({observations:[observation('a'),{...observation('b'),boardClass:'shortboard'}]}).matchedSessions,0);
 assert.equal(run({observations:[observation('a'),{...observation('b'),height:{min:1,max:2,unit:'ft'}}]}).matchedSessions,0);
});
test('nearest valid hour and earliest archive win deterministically',()=>{
 const newer={...snapshot,firstSeenAt:at-3700,rows:[{...snapshot.rows[0],score:90}]};
 assert.equal(run({snapshots:[newer,snapshot,snapshot]}).matches[0].predictedScore,54);
 assert.equal(run({snapshots:[newer,snapshot,snapshot]}).matchedSessions,1);
});

test('nourishment eras need dated evidence and never pool work-period observations',()=>{
 const event={...plan.events[0],nourishmentEra:'post'};
 assert.throws(()=>validateObservationPlan({...plan,events:[event]}),/documented/);
 const evidence={startAt:at-10000,endAt:at-2000,sourceUrl:'https://example.org/test-fixture'};
 assert.ok(validateObservationPlan({...plan,events:[{...event,nourishmentWindow:evidence}]}));
 assert.throws(()=>validateObservationPlan({...plan,events:[{...event,nourishmentWindow:{...evidence,endAt:at}}]}),/crosses/);
});
test('formula version and session protocol are predeclared, not selected from outcomes',()=>{
 assert.equal(run({snapshots:[{...snapshot,version:1}]}).matchedSessions,0);
 assert.equal(run({observations:[observation('a'),{...observation('b'),durationMinutes:5}]}).matchedSessions,0);
});

test('imports actual history envelopes and refuses unnoticed pagination truncation',()=>{
 const history={snapshots:[{schemaVersion:1,source:'ratings',data:snapshot}],truncated:false};
 assert.equal(run({snapshots:history}).matchedSessions,1);
 assert.throws(()=>importRatingSnapshots({...history,truncated:true}),/truncated/);
});
