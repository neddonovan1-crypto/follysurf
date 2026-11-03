import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCapture} from '../server/camera-analysis.js';
import {assessFreshness,QUALITY_VERSION} from '../camera-service/camera-quality.mjs';
import {reviewCameraSurfaceBursts,gateSurfaceReview,validateHistoricalCapture} from '../server/camera-surface-review.js';
const now=1800000000;
function fixture(){
  const start=now-86400;
  const frames=Array.from({length:12},(_,i)=>{
    const offsetSeconds=(i<6?10:40)+i%6,captureRequestedAt=start+offsetSeconds;
    return {id:`frame-${String(i+1).padStart(4,'0')}`,offsetSeconds,captureRequestedAt,capturedAt:captureRequestedAt+0.05,
      mediaTime:offsetSeconds,sourceAt:captureRequestedAt-40,sourceClock:'hls-program-date-time',sourceLive:true,
      playbackEpoch:0,jpegBase64:'/9j/AA=='};
  });
  const stableBursts=[frames.slice(0,6).map(f=>f.id),frames.slice(6).map(f=>f.id)];
  const comparisons=frames.slice(1).map((f,i)=>({from:frames[i].id,to:f.id,status:i===5?'unknown':'stable'}));
  for(let i=0;i<12;i+=6)for(let j=i+2;j<i+6;j++)comparisons.push({from:frames[i].id,to:frames[j].id,status:'stable'});
  return {runId:'surface-review-test',sourceCaptureRunId:'original-capture-test',cameraId:'tides-pier',captureMethod:'browser-page-v3',
    captureStartedAt:start,captureCompletedAt:start+100,frames,recoveries:[],sourceTimeVerified:true,freshness:assessFreshness(frames),
    viewQuality:{version:QUALITY_VERSION,status:'unknown',stableBursts,comparisons},
    sampling:{policy:'stationary-view-v1',selectionBasis:'camera-stability-only',watchLimitSeconds:180,acceptedBursts:2,scoutChecks:[],
      attempts:stableBursts.map((ids,i)=>({accepted:true,frameIds:ids,startAt:frames[i*6].captureRequestedAt,endAt:frames[i*6+5].capturedAt}))}};
}
function raw(){return {bursts:[1,2].map((n)=>({burstId:`burst-${n}`,scene:'surf',motion:'visible',waterDetail:'sufficient',
  surface:'textured',evidenceFrameIds:[`frame-${String((n-1)*6+1).padStart(4,'0')}`],limitations:['short-sample']}))};}
function setup(){const records=new Map();return {records,env:{OPENAI_API_KEY:'test-key',BUCKET:{async put(k,v,o){
  if(o?.onlyIf?.get('If-None-Match')==='*'&&records.has(k))return null;records.set(k,v);return {key:k};}}}};}
const success=value=>Response.json({id:'test-response',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('historical review preserves clocks without relaxing the live freshness gate',()=>{
  const job=fixture(),before=JSON.stringify(job);
  assert.throws(()=>validateCapture(job,now),/stale/);validateHistoricalCapture(job,now);
  assert.equal(JSON.stringify(job),before);
  assert.throws(()=>validateHistoricalCapture(job,now+31*86400),/window/);
  assert.throws(()=>validateHistoricalCapture(job,job.captureCompletedAt-60),/window/);
  job.frames[1].mediaTime=job.frames[0].mediaTime;assert.throws(()=>validateHistoricalCapture(job,now),/timing/);
});
test('limited detail and uncertain motion cannot retain confident labels',()=>{
  for(const patch of [{waterDetail:'limited'},{waterDetail:'insufficient'},{motion:'possible-freeze'},{scene:'other'},{evidenceFrameIds:[]}]){
    const value=raw();Object.assign(value.bursts[0],patch);
    const result=gateSurfaceReview(value,fixture());
    assert.equal(result[0].surface,'unknown');assert.deepEqual(result[0].evidenceFrameIds,[]);
    assert.equal(result[1].surface,'textured');assert.equal(result[0].shape,'unknown');assert.equal(result[0].height,null);
    assert.equal(result[0].publicationEligible,false);assert.equal(result[0].scoreEligible,false);
  }
});
test('every burst is required and evidence cannot leak from a clearer burst',()=>{
  for(const change of [v=>v.bursts.pop(),v=>v.bursts.reverse(),v=>v.bursts[0].evidenceFrameIds=['frame-0007'],
    v=>v.bursts[0].evidenceFrameIds=['invented'],v=>v.bursts[0].summary='Peeling waves',v=>v.bursts[0].limitations=['peeling']]){
    const value=raw();change(value);assert.throws(()=>gateSurfaceReview(value,fixture()));
  }
});
test('one paid historical review records provenance, is private and deduplicates',async()=>{
  const {env,records}=setup(),job=fixture();let calls=0;
  const options={now:()=>now,fetcher:async(_url,req)=>{
    calls++;const body=JSON.parse(req.body);assert.equal(body.store,false);
    assert.equal(body.input[0].content.filter(c=>c.type==='input_image').length,12);
    assert.match(body.instructions,/historical/i);return success(raw());}};
  const result=await reviewCameraSurfaceBursts(job,env,options),record=JSON.parse(records.get(result.objectKey));
  assert.equal(record.currentConditions,false);assert.equal(record.captureCompletedAt,job.captureCompletedAt);
  assert.equal(record.publicationEligible,false);assert.equal(record.validationStatus,'awaiting-independent-human-review');
  const input=JSON.parse(records.get('camera-research/tides-pier/surface-review-test/surface-review-input.json'));
  assert.equal(input.frames[0].jpegSha256.length,64);assert.ok(!JSON.stringify(input).includes('jpegBase64'));
  assert.equal((await reviewCameraSurfaceBursts(job,env,options)).status,'already-claimed');assert.equal(calls,1);
});
test('historical attempts share the existing daily budget and failed output is not published',async()=>{
  const {env,records}=setup();let calls=0;
  for(let i=0;i<4;i++) await assert.rejects(reviewCameraSurfaceBursts({...fixture(),runId:`surface-failure-${i}`},env,
    {now:()=>now,fetcher:async()=>{calls++;return success({bursts:[]});}}));
  await assert.rejects(reviewCameraSurfaceBursts({...fixture(),runId:'surface-failure-5'},env,
    {now:()=>now,fetcher:async()=>{calls++;return success(raw());}}),/Daily pilot limit/);
  assert.equal(calls,4);assert.ok(![...records.keys()].some(k=>k.endsWith('/surface-review.json')));
});
test('worker archival review uses saved identity and never starts a browser',async()=>{
  const code=readFileSync(new URL('../camera-service/worker.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace('export class CameraCapture','class CameraCapture').replace('export default','const handler=');
  const CameraCapture=Function('DurableObject','return (()=>{'+code+';return CameraCapture;})()')
    (class{constructor(ctx,env){this.ctx=ctx;this.env=env;}});
  const data=new Map(),job=fixture();job.runId='original-capture-test-tides-pier';let calls=0;
  const ctx={storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),deleteAlarm:async()=>{}}};
  const env={PILOT_SURFACE_REVIEW_FROM:'original-capture-test',BUCKET:{get:async()=>({json:async()=>job}),put:async()=>{}},
    ANALYSIS:{reviewSurface:async value=>{calls++;assert.equal(value.sourceCaptureRunId,job.runId);return {status:'surface-reviewed',scoreEligible:false};}}};
  const instance=new CameraCapture(ctx,env);
  assert.equal((await instance.run('tides-pier','surface-review-test')).status,'surface-reviewed');
  assert.equal((await instance.run('tides-pier','surface-review-test')).status,'already-attempted');assert.equal(calls,1);
});
