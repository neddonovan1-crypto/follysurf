import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCameraCapture, validateCapture} from '../server/camera-analysis.js';
import {assessFreshness,QUALITY_VERSION} from '../camera-service/camera-quality.mjs';
const now = 1800000000;
function job(runId = 'pilot-run-001') {
  return {runId, cameraId: 'washout', captureStartedAt: now - 181, captureCompletedAt: now - 1,
    frames: Array.from({length: 36}, (_, i) => {
      const offsetSeconds = Math.floor(i / 6) * 30 + i % 6;
      return {id: `frame-${String(offsetSeconds + 1).padStart(4, '0')}`, offsetSeconds, jpegBase64: '/9j/AA=='};
    })};
}
function setup() {
  const records = new Map();
  return {records, env: {OPENAI_API_KEY: 'unit-test-only', BUCKET: {
    async put(key, value, options) {
      if (options?.onlyIf?.get('If-None-Match') === '*' && records.has(key)) return null;
      records.set(key, value); return {key};
    },
  }}};
}
const observation = {surface: 'textured', shape: 'unknown', height: null,
  scene:'surf',viewChange:'stable',motion:'visible',
  surfaceEvidenceIds: ['frame-0001'], shapeEvidenceIds: [], limitations: ['Unverified source time'], summary: 'Visible surface ripples.'};
const success = (value = observation) => new Response(JSON.stringify({id: 'test-response', status: 'completed',
  output: [{content: [{type: 'output_text', text: JSON.stringify(value)}]}]}));

// Reproduce the Tides failure: five independently stable bursts, but changes
// between bursts leave the whole view uncertain. All cited frame IDs are valid.
function stationaryJob(viewStatus='unknown') {
  const captureStartedAt=now-181;
  const frames=Array.from({length:30},(_,i)=>{
    const offsetSeconds=[30,55,80,110,155][Math.floor(i/6)]+i%6;
    const captureRequestedAt=captureStartedAt+offsetSeconds;
    return {id:`frame-${String(i+1).padStart(4,'0')}`,offsetSeconds,captureRequestedAt,
      capturedAt:captureRequestedAt+0.05,mediaTime:offsetSeconds,playbackEpoch:0,
      sourceAt:captureRequestedAt-42.443,sourceClock:'hls-program-date-time',sourceLive:true,jpegBase64:'/9j/AA=='};
  });
  const stableBursts=Array.from({length:5},(_,i)=>frames.slice(i*6,i*6+6).map(f=>f.id));
  const comparisons=frames.slice(1).map((f,i)=>({from:frames[i].id,to:f.id,
    status:(i+1)%6===0&&(i+1)!==12?viewStatus:'stable'}));
  for(let i=0;i<frames.length;i+=6) for(let j=i+2;j<i+6;j++) comparisons.push({from:frames[i].id,to:frames[j].id,status:'stable'});
  return {runId:'pilot-tides-gate-regression',cameraId:'tides-pier',captureMethod:'browser-page-v3',
    captureStartedAt,captureCompletedAt:now-1,frames,recoveries:[],sourceTimeVerified:true,
    freshness:assessFreshness(frames),viewQuality:{version:QUALITY_VERSION,status:viewStatus,stableBursts,comparisons},
    sampling:{policy:'stationary-view-v1',selectionBasis:'camera-stability-only',watchLimitSeconds:180,
      acceptedBursts:5,scoutChecks:[],attempts:stableBursts.map((ids,i)=>({accepted:true,frameIds:ids,
        startAt:frames[i*6].captureRequestedAt,endAt:frames[i*6+5].capturedAt}))}};
}

test('Tides regression: registered bursts cannot preserve shape after the whole view becomes uncertain',async()=>{
  for(const viewStatus of ['unknown','pan-or-zoom']) {
    const capture=stationaryJob(viewStatus),{env,records}=setup();
    const raw={...observation,viewChange:'stable',shape:'mostly-peeling',limitations:[],
      surfaceEvidenceIds:capture.frames.map(f=>f.id),shapeEvidenceIds:capture.frames.map(f=>f.id),
      summary:'Multiple peeling breaking waves across the extended sequence.'};
    const result=await analyzeCameraCapture(capture,env,{now:()=>now,fetcher:async()=>success(raw)});
    const saved=JSON.parse(records.get(result.objectKey));
    assert.equal(saved.observation.viewChange,viewStatus);
    assert.equal(saved.observation.shape,'unknown');assert.deepEqual(saved.observation.shapeEvidenceIds,[]);
    assert.equal(saved.observation.surface,'textured');assert.deepEqual(saved.observation.surfaceEvidenceIds,raw.surfaceEvidenceIds);
    assert.ok(saved.qualityGatesApplied.includes('shape-withheld-changing-or-uncertain-view'));
    assert.ok(saved.observation.limitations.some(s=>s.includes('view')));
    assert.ok(!saved.observation.summary.includes('peeling'));assert.equal(saved.scoreEligible,false);
    const audit=JSON.parse(records.get('camera-research/tides-pier/pilot-tides-gate-regression/model-output.json'));
    assert.deepEqual(audit.rawObservation,raw);
  }
});

test('surface-only pilot withholds unvalidated shape even when every view check passes',async()=>{
  const capture=stationaryJob('stable'),{env,records}=setup();
  const raw={...observation,shape:'mostly-peeling',shapeEvidenceIds:capture.frames.map(f=>f.id),
    limitations:[],summary:'Peeling waves.'};
  const result=await analyzeCameraCapture(capture,env,{now:()=>now,fetcher:async(_url,request)=>{
    const body=JSON.parse(request.body);
    assert.deepEqual(body.text.format.schema.properties.shape.enum,['unknown']);
    assert.match(body.instructions,/surface appearance only/i);
    return success(raw);
  }});
  const saved=JSON.parse(records.get(result.objectKey));
  assert.equal(saved.observation.viewChange,'stable');assert.equal(saved.observation.surface,'textured');
  assert.equal(saved.observation.shape,'unknown');assert.deepEqual(saved.observation.shapeEvidenceIds,[]);
  assert.ok(!saved.observation.summary.includes('peeling'));
  assert.ok(saved.qualityGatesApplied.includes('shape-withheld-surface-only-pilot'));
  assert.ok(saved.observation.limitations.some(s=>s.includes('pending validation')));
  assert.equal(saved.analysisScope,'surface-only');assert.equal(saved.qualityGateVersion,'folly-camera-gates-v2');
  assert.equal(saved.scoreEligible,false);
});

test('private analysis sends only image evidence, saves research output and deduplicates calls', async () => {
  const {env, records} = setup(); let calls = 0;
  const options = {now: () => now, fetcher: async (url, request) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(request.body);
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content.filter(p => p.type === 'input_image').length, 36);
    assert.ok(!request.body.includes('forecast-secret'));
    return success();
  }};
  const result = await analyzeCameraCapture({...job(), forecast: 'forecast-secret'}, env, options);
  assert.equal(result.status, 'analyzed');
  const saved = JSON.parse(records.get(result.objectKey));
  assert.equal(saved.scoreEligible, false); assert.equal(saved.sourceStartAt, null);
  assert.equal(saved.kind, 'camera-research-observation');
  assert.ok(!JSON.stringify(saved).includes('unit-test-only'));
  assert.equal((await analyzeCameraCapture(job(), env, options)).status, 'already-claimed');
  assert.equal(calls, 1);
});

test('untrusted captures cannot choose URLs, chronology or unlimited image volume', () => {
  for (const mutate of [j => j.cameraId = '__proto__', j => j.runId = '../escape',
    j => j.captureCompletedAt = now + 60, j => j.frames.reverse(),
    j => j.frames[0].jpegBase64 = 'https://example.com/image.jpg',
    j => j.frames[0].jpegBase64 = '/9j/' + 'A'.repeat(600000)]) {
    const value = job(); mutate(value); assert.throws(() => validateCapture(value, now));
  }
});

test('pilot budget caps API attempts across cameras and failures', async () => {
  const {env} = setup(); let calls = 0;
  const options = {now: () => now, fetcher: async () => {calls++; return new Response('', {status: 429});}};
  for (let i = 0; i < 4; i++) {
    await assert.rejects(analyzeCameraCapture(job(`pilot-run-00${i}`), env, options), /HTTP 429/);
  }
  await assert.rejects(analyzeCameraCapture(job('pilot-run-005'), env, options), /Daily pilot limit/);
  assert.equal(calls, 4);
});

test('refusals, incomplete output and invented evidence cannot become saved observations', async () => {
  const replies = [
    () => new Response(JSON.stringify({status: 'incomplete', output: []})),
    () => new Response(JSON.stringify({status: 'completed', output: [{content: [{type: 'refusal'}]}]})),
    () => success({...observation, surfaceEvidenceIds: ['invented-frame']}),
    () => success({...observation, height: 3}),
  ];
  for (const fetcher of replies) {
    const {env, records} = setup();
    await assert.rejects(analyzeCameraCapture(job(), env, {now: () => now, fetcher}));
    assert.ok(![...records.keys()].some(k => k.endsWith('/observation.json')));
    assert.ok([...records.keys()].some(k => k.endsWith('/failure.json')));
  }
});

test('quality gates deterministically withhold unsupported labels and preserve raw output privately',async()=>{
  for (const patch of [{scene:'advertisement'},{motion:'possible-freeze'},{viewChange:'pan-or-zoom'},{viewChange:'unknown'}]) {
    const {env,records}=setup();
    const raw={...observation,shape:'mostly-peeling',shapeEvidenceIds:['frame-0001'],summary:'Unsupported peeling claim',...patch};
    const result=await analyzeCameraCapture({...job(),sourceCaptureRunId:'original-capture-001'},env,{now:()=>now,fetcher:async()=>success(raw)});
    const saved=JSON.parse(records.get(result.objectKey));
    assert.equal(saved.sourceCaptureRunId,'original-capture-001');
    assert.equal(saved.observation.shape,'unknown');assert.deepEqual(saved.observation.shapeEvidenceIds,[]);
    assert.ok(!saved.observation.summary.includes('peeling'));assert.equal(saved.scoreEligible,false);
    assert.ok(saved.qualityGatesApplied.length>=1);
    if (patch.scene || patch.motion) {assert.equal(saved.observation.surface,'unknown');assert.deepEqual(saved.observation.surfaceEvidenceIds,[]);}
    else assert.equal(saved.observation.surface,'textured');
    const audit=JSON.parse(records.get('camera-research/washout/pilot-run-001/model-output.json'));
    assert.equal(audit.rawObservation.shape,'mostly-peeling');
  }
  const stale=job();stale.captureCompletedAt=now-1801;stale.captureStartedAt=now-2000;
  stale.sourceCaptureRunId='original-capture-001';assert.throws(()=>validateCapture(stale,now),/stale/);
});
