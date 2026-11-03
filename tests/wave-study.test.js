import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWaveStudyRows,evaluateWaveStudy} from '../server/wave-study.js';
import {evaluateOutlook as v3} from '../research/models/folly-index-v3.js';
import {evaluateOutlook as v4} from '../web/outlook.js';

// Entirely synthetic fixtures for matching/leakage tests, never surf observations.
function dataset(version=3){
 const evaluateOutlook=version===3?v3:v4;
 const start=Date.parse('2026-11-01T00:00Z')/1000,site={id:'pier',latitude:32.6489,longitude:-79.938,matchRadiusM:100};
 const plan={schemaVersion:1,planId:'synthetic-unit-test',frozenAt:start-86400,formulaVersion:version,protocol:'synthetic',sessionMinutes:10,
  locations:[site],leadMinHours:1,leadMaxHours:6,events:[],waveStudy:{candidateSet:'incoming-waves-v1',referencePointId:'CHSHB',ridgePenalties:[.1,1,10],minDevelopmentEvents:3,minHoldoutEvents:2}};
 const observations=[],snapshots=[],spectra=[];
 for(let e=0;e<5;e++){
  const cycle=start+e*86400,eventId=`event${e}`,eventGroup=`storm${e}`;
  plan.events.push({id:eventId,eventGroup,startAt:cycle,endAt:cycle+21600,split:e<3?'development':'holdout',nourishmentEra:'unknown'});
  const spectralRows=[],ratingRows=[];
  for(let j=0;j<3;j++){
   const validAt=cycle+(j+2)*3600,sessionId=`session${e}-${j}`,quality=1+(e+j)%5;
   const f={waveM:.5+j*.3,peakPeriodS:6+e,relativeDirectionDeg:10*e-20,windMph:3+j,windDirectionDeg:315,gustMph:6+j};
   const score=evaluateOutlook({nearshore:f,wind:f.windMph,windDir:f.windDirectionDeg,gust:f.gustMph,sourceFresh:true}).score;
   ratingRows.push({...f,score,locationId:'pier',validAt,basis:'nearshore',heightKind:'nearshore-significant'});
   spectralRows.push({t:validAt,status:'modeled',features:{spectralHeightM:1+e*.1,energyPeriodS:7+j,frequencyBandwidth:.4,directionalConcentration:.8,meanDirectionFromDeg:80+e*5,
    bands:[{id:'6to8',varianceShare:.2},{id:'8to12',varianceShare:.3},{id:'12plus',varianceShare:.1}]}});
   for(const observerId of ['a','b'])observations.push({id:`${sessionId}-${observerId}`,eventId,sessionId,observerId,locationId:'pier',latitude:site.latitude,longitude:site.longitude,
    observedAt:validAt,recordedAt:validAt+60,durationMinutes:10,independent:true,blindToForecast:true,qualityScale:'folly-observer-v1',quality,boardClass:'longboard',skillClass:'intermediate',height:null});
  }
  snapshots.push({schemaVersion:1,type:'folly-index',version,id:`rating${e}`,firstSeenAt:cycle+900,issuedAt:null,inputs:{nwps:{issuedAt:cycle,retrievedAt:cycle+800}},rows:ratingRows});
  spectra.push({schemaVersion:1,id:`spectrum${e}`,source:'nwpsSpectra',status:'fresh',retrievedAt:cycle+600,recordedAt:cycle+700,issuedAt:cycle,
   data:{cycle,scope:'regional-model-points',scoreEligible:false,points:[{id:'CHSHB',latitude:32.73,longitude:-79.84,retrievedAt:cycle+600,sourceUrl:'https://example.test/synthetic',rows:spectralRows}]}});
 }
 return {plan,observations,snapshots,spectra,now:start+6*86400};
}
test('pairs exact prospective spectra and keeps eight candidates on identical holdout sessions',()=>{
 const report=evaluateWaveStudy(dataset());assert.equal(report.matchedSessions,15);assert.equal(report.strata.length,1);
 const s=report.strata[0];assert.equal(s.developmentEvents,3);assert.equal(s.holdoutEvents,2);assert.equal(s.models.length,8);
 for(const m of s.models){assert.equal(m.holdout.sessions,6);assert.equal(m.holdout.eventGroups,2);assert.ok(Number.isFinite(m.holdout.eventWeightedMAE));}
 assert.equal(report.matchedInputs[0].forecastSnapshotId,'rating0');assert.equal(report.matchedInputs[0].spectralSource.snapshotId,'spectrum0');
});
test('changing every holdout label cannot change fitted parameters or predictions',()=>{
 const original=dataset(),changed=structuredClone(original);
 for(const o of changed.observations)if(['event3','event4'].includes(o.eventId))o.quality=o.quality===1?5:1;
 const a=evaluateWaveStudy(original).strata[0].models,b=evaluateWaveStudy(changed).strata[0].models;
 assert.deepEqual(a.map(m=>m.parameters),b.map(m=>m.parameters));
 assert.deepEqual(a.map(m=>m.predictions.map(p=>p.predictedQuality)),b.map(m=>m.predictions.map(p=>p.predictedQuality)));
});
test('late spectra, wrong cycle, wrong point and missing cells never enter a matched candidate',()=>{
 for(const mutation of [
  s=>{s.recordedAt+=3600;},s=>{s.issuedAt-=21600;s.data.cycle-=21600;},s=>{s.data.points[0].id='NAVB6';},s=>{s.data.points[0].rows.forEach(r=>r.status='missing');}
 ]){
  const d=dataset();mutation(d.spectra[0]);const out=buildWaveStudyRows(d);assert.equal(out.rows.length,12);assert.equal(out.excluded.length,3);
 }
});
test('event-count gates, independent observers, complete exports and event splits are enforced',()=>{
 const d=dataset();d.plan.waveStudy.minDevelopmentEvents=10;
 assert.equal(evaluateWaveStudy(d).strata[0].status,'awaiting-independent-events');
 const bad=dataset();bad.plan.events[3].eventGroup=bad.plan.events[0].eventGroup;assert.throws(()=>evaluateWaveStudy(bad),/cannot cross/);
 const unblinded=dataset();unblinded.observations.forEach(o=>o.blindToForecast=false);assert.equal(evaluateWaveStudy(unblinded).matchedSessions,0);
 assert.throws(()=>evaluateWaveStudy({...dataset(),spectra:{truncated:true,snapshots:[]}}),/Complete/);
});
test('board cohorts remain separate and the empty study does not pretend to find a winning formula',()=>{
 const d=dataset();d.observations.filter(o=>o.eventId==='event4').forEach(o=>o.boardClass='shortboard');
 const result=evaluateWaveStudy(d);assert.equal(result.strata.length,2);assert.ok(result.strata.every(s=>s.models.length===0));
 const empty=dataset();empty.observations=[];const report=evaluateWaveStudy(empty);assert.equal(report.status,'awaiting-matched-observations');assert.equal(report.matchedSessions,0);
});

test('v4 studies label the archived baseline correctly and never mix formula versions',()=>{
 const d=dataset(4),report=evaluateWaveStudy(d);
 assert.equal(report.matchedSessions,15);
 assert.equal(report.strata[0].models[0].candidate,'v4');
 assert.ok(report.matchedInputs.every(r=>r.formulaVersion===4));
 d.snapshots[0].version=3;
 assert.equal(evaluateWaveStudy(d).matchedSessions,12);
 d.plan.formulaVersion=5;
 assert.throws(()=>evaluateWaveStudy(d),/archived v3 or v4/);
});
