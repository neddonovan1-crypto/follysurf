import test from 'node:test';
import assert from 'node:assert/strict';
import {selectStationaryBursts} from '../camera-service/stationary-sampler.mjs';
import {summarizeViews,assessFreshness} from '../camera-service/camera-quality.mjs';
import {validateCapture,analyzeCameraCapture} from '../server/camera-analysis.js';

let seed=123456;
const image={width:240,height:136,data:Array.from({length:32640},()=>{
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;
})};
function setup({neverStable=false,rejectFirst=false,slow=false,slowMedia=false}={}) {
  const origin=1800000000000;let clock=origin,sequence=0,attempt=0;
  return {now:()=>clock,wait:async ms=>{clock+=ms;},
    captureFrame:async()=>{
      const at=clock/1000;clock+=slow?2500:25;
      return {id:`scout-${++sequence}`,captureRequestedAt:at,capturedAt:clock/1000,
        mediaTime:(at-origin/1000)*(slowMedia?0.1:1),decodedFrames:sequence*30,playbackEpoch:0,
        sourceAt:at-10,sourceClock:'hls-program-date-time',sourceLive:true,
        jpegBase64:Buffer.from([255,216,255,sequence]).toString('base64')};
    },
    scoutQuality:async frames=>({status:neverStable?'unknown':frames[0].mediaTime>=20?'stable':'pan-or-zoom'}),
    burstQuality:async frames=>{
      attempt++;
      return summarizeViews(frames,frames.map((_,i)=>rejectFirst&&attempt===1&&i===3?null:image));
    }};
}
function job(selected) {
  return {...selected,runId:'pilot-adaptive-test',cameraId:'tides-pier',captureMethod:'browser-page-v3',
    recoveries:[],playlists:[],viewQuality:summarizeViews(selected.frames,selected.frames.map(()=>image)),
    freshness:assessFreshness(selected.frames),sourceTimeVerified:true};
}
test('adaptive selection waits for a stable view and preserves real coverage and source times',async()=>{
  const f=setup();const selected=await selectStationaryBursts(f);
  assert.equal(selected.frames.length,36);assert.ok(selected.frames[0].mediaTime>=24);
  assert.ok(selected.frames[6].captureRequestedAt-selected.frames[5].capturedAt>=10);
  const capture=job(selected);validateCapture(capture,f.now()/1000);
  assert.equal(capture.freshness.maxAgeSeconds,10);
  assert.equal(selected.sampling.acceptedBursts,6);assert.ok(selected.sampling.scoutChecks.some(q=>q.status==='pan-or-zoom'));
  const records=new Map();
  const raw={surface:'textured',shape:'unknown',height:null,surfaceEvidenceIds:['frame-0001'],shapeEvidenceIds:[],
    limitations:['Short intervals only'],summary:'Textured.',scene:'surf',viewChange:'stable',motion:'visible'};
  const result=await analyzeCameraCapture(capture,{OPENAI_API_KEY:'test',BUCKET:{put:async(k,v)=>{records.set(k,v);return {key:k};}}},
    {now:()=>f.now()/1000,fetcher:async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})});
  const saved=JSON.parse(records.get(result.objectKey));
  assert.equal(saved.scoreEligible,false);assert.equal(saved.sampling.acceptedBursts,6);
  for(const change of [j=>j.frames[1].offsetSeconds=100,j=>j.frames[1].mediaTime=j.frames[0].mediaTime+0.1,
    j=>j.viewQuality.comparisons[1]=j.viewQuality.comparisons[0],j=>j.sampling.attempts[0].frameIds=['fake'],
    j=>j.sampling.selectionBasis='largest-waves']) {
    const bad=structuredClone(capture);change(bad);assert.throws(()=>validateCapture(bad,f.now()/1000));
  }
});
test('a camera that starts moving during the candidate burst causes the entire burst to be discarded',async()=>{
  const f=setup({rejectFirst:true});const selected=await selectStationaryBursts(f);
  assert.equal(selected.sampling.attempts[0].accepted,false);
  assert.ok(selected.frames[0].captureRequestedAt>selected.sampling.attempts[0].endAt);
  assert.equal(selected.frames.length%6,0);validateCapture(job(selected),f.now()/1000);
});
test('unknown views stop within the budget and produce an explicit no-stable-window result',async()=>{
  const f=setup({neverStable:true});const selected=await selectStationaryBursts(f);
  assert.equal(selected.frames.length,0);assert.equal(selected.sampling.outcome,'no-stable-window');
  assert.equal(selected.sampling.attempts.length,0);assert.ok(selected.sampling.shots<=90);
  assert.ok(selected.captureCompletedAt-selected.captureStartedAt<=180);
  assert.throws(()=>validateCapture(job(selected),f.now()/1000));
});
test('diagnostics retain three time-spaced scout triples with exact reasons without accepting uncertain footage',async()=>{
  const f=setup({neverStable:true}),reviews=[];
  f.scoutQuality=async frames=>({status:'unknown',comparisons:[{from:frames[0].id,to:frames[1].id,
    status:'unknown',reason:'insufficient-trackable-landmarks',matches:2,textured:31}]});
  const selected=await selectStationaryBursts({...f,onScoutReview:async review=>{reviews.push(review);await f.wait(2500);}});
  assert.equal(selected.frames.length,0);assert.equal(reviews.length,3);
  assert.deepEqual(reviews.map(r=>r.index),[1,2,3]);
  assert.deepEqual(reviews.map(r=>Math.floor(r.offsetSeconds/60)),[0,1,2]);
  assert.ok(reviews.every(r=>r.frames.length===3&&r.frames[0].id===r.check.comparisons[0].from));
  assert.ok(selected.sampling.scoutChecks.every(c=>c.comparisons[0].reason==='insufficient-trackable-landmarks'));
  assert.ok(selected.captureCompletedAt-selected.captureStartedAt<=180);
});
test('slow shots cannot be accepted as an uninterrupted burst',async()=>{
  const f=setup({slow:true});const selected=await selectStationaryBursts(f);
  assert.equal(selected.frames.length,0);assert.ok(selected.sampling.attempts.length>0);
  assert.ok(selected.sampling.attempts.every(a=>a.reason==='invalid-capture-or-playback-cadence'));
});
test('slow playback cannot pass merely because screenshots arrive on time',async()=>{
  const f=setup({slowMedia:true});f.scoutQuality=async()=>({status:'stable'});
  const selected=await selectStationaryBursts(f);
  assert.equal(selected.frames.length,0);assert.ok(selected.sampling.attempts.length>0);
  assert.ok(selected.sampling.attempts.every(a=>a.reason==='invalid-capture-or-playback-cadence'));
});
