import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBrowserPage,measureCapturedViews,makeScoutContactSheet,checkPlayback,safeErrorDetails,networkDiagnostic} from '../camera-service/browser-capture.mjs';
import {summarizeViews} from '../camera-service/camera-quality.mjs';
import {validateCapture,analyzeCameraCapture} from '../server/camera-analysis.js';

function fixture({stalled=false,repeat=false,slow=false,bufferFor=0,screenshotMs=25,stranded=false}={}) {
  const origin=1800000000000;let clock=origin,shots=0,layoutReads=0,mediaOffset=0,wasRecovered=false;
  const video={
    waitFor:async()=>{},scrollIntoViewIfNeeded:async()=>{},
    evaluate:async(_fn,target)=>{
      if(typeof target==='number'){mediaOffset=target-clock/1000;wasRecovered=true;}
      const stuck=stranded&&!wasRecovered&&clock>=origin+16000;
      return {time:stalled?0:stuck?60:clock/1000+mediaOffset,paused:false,ended:false,
      buffered:stuck?[[100,120]]:[],
      readyState:stuck?1:clock>=origin+31000 && clock<origin+31000+bufferFor ? 1 : 4,
      width:1280,height:720,decodedFrames:Math.floor(clock/40)};},
    boundingBox:async()=>({x:100,y:120,width:960,height:540}),
    elementHandle:async()=>video,
  };
  const cdp={send:async(method,params)=>{
    if (method==='Page.getLayoutMetrics') {layoutReads++;return {cssVisualViewport:{pageX:0,pageY:700}};}
    assert.equal(method,'Page.captureScreenshot');
    assert.deepEqual(params.clip,{x:100,y:820,width:960,height:540,scale:1});
    clock+=slow ? 5500 : screenshotMs;
    return {data:Buffer.from([255,216,255,repeat ? 0 : ++shots]).toString('base64')};
  }};
  const page={evaluate:async expression=>{const frames=JSON.parse(expression.slice(expression.lastIndexOf('})([')+3,-1));return frames.length===3?{status:'unknown'}:summarizeViews(frames,frames.map(()=>null));},on(){},off(){},addInitScript:async()=>{},context:()=>({newCDPSession:async()=>cdp}),bringToFront:async()=>{},screenshot:async()=>Buffer.from([255,216,255,0]),setDefaultTimeout(){},goto:async url=>{assert.equal(url,'https://www.tidesfollybeach.com/surf-cam/');return {ok:()=>true};},
    getByText:()=>({waitFor:async()=>{},isVisible:async()=>false}),
    getByRole:()=>({isVisible:async()=>false}),locator:()=>video};
  return {browser:{newPage:async()=>page},now:()=>clock,wait:async ms=>{clock+=ms;},counts:()=>({shots,layoutReads})};
}
test('page sampler emits six timed bursts accepted by the private analysis contract',async()=>{
  const f=fixture();const job=await captureBrowserPage(f.browser,'tides-pier','pilot-browser-test',f);
  assert.equal(job.frames.length,36);assert.equal(job.sourceTimeVerified,false);
  assert.equal(job.frames.at(-1).offsetSeconds,155);
  assert.deepEqual(f.counts(),{shots:36,layoutReads:6});
  assert.ok(Math.abs(job.frames[0].capturedAt-job.frames[0].captureRequestedAt-0.025)<0.001);
  validateCapture(job,f.now()/1000);
  const records=new Map();let body;
  const env={OPENAI_API_KEY:'test-only',BUCKET:{put:async(k,v)=>{records.set(k,v);return {key:k};}}};
  const observation={surface:'unknown',shape:'unknown',height:null,surfaceEvidenceIds:[],shapeEvidenceIds:[],
    limitations:['Camera pans'],summary:'Changing view.',scene:'surf',viewChange:'pan-or-zoom',motion:'visible'};
  const result=await analyzeCameraCapture(job,env,{now:()=>f.now()/1000,fetcher:async(_url,request)=>{
    body=JSON.parse(request.body);return Response.json({id:'test',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(observation)}]}]});
  }});
  assert.match(body.input[0].content[1].text,/capture clock offset/);
  const saved=JSON.parse(records.get(result.objectKey));
  assert.equal(saved.frames[0].capturedAt,job.frames[0].capturedAt);
  assert.equal(saved.scoreEligible,false);assert.equal(saved.observation.viewChange,'unknown');
  for (const mutate of [j=>j.frames[0].capturedAt=j.captureStartedAt-1,j=>j.frames[1].mediaTime=j.frames[0].mediaTime,
    j=>j.sourceTimeVerified=true,j=>j.frames[0].captureRequestedAt+=12]) {
    const bad=structuredClone(job);mutate(bad);assert.throws(()=>validateCapture(bad,f.now()/1000));
  }
});
test('frozen, repeated and delayed captures fail before becoming vision jobs',async()=>{
  for (const [options,error] of [[{stalled:true},/player-start-timeout/],[{repeat:true},/repeated-rendered-frames/],[{slow:true},/sampling-too-slow/]]) {
    const f=fixture(options);await assert.rejects(captureBrowserPage(f.browser,'tides-pier','pilot-browser-test',f),error);
  }
});
test('capture failures retain bounded diagnostics and a screenshot for review',async()=>{
  const f=fixture({stalled:true});let saved;
  await assert.rejects(captureBrowserPage(f.browser,'tides-pier','pilot-browser-test',{
    ...f,onDiagnostic:async(details,image)=>{saved={details,image};},
  }),/player-start-timeout/);
  assert.equal(saved.details.step,'wait-playback');
  assert.equal(saved.details.reason,'player-start-timeout');
  assert.ok(saved.image.length>0);
});
test('brief buffering keeps actual timestamps; longer buffering still fails closed',async()=>{
  const f=fixture({bufferFor:2000});const job=await captureBrowserPage(f.browser,'tides-pier','pilot-browser-test',f);
  validateCapture(job,f.now()/1000);
  assert.ok(job.frames[6].captureRequestedAt-job.captureStartedAt>=32);
  assert.ok(job.frames[7].captureRequestedAt-job.frames[6].captureRequestedAt>=0.79);
  const blocked=fixture({bufferFor:6000});
  await assert.rejects(captureBrowserPage(blocked.browser,'tides-pier','pilot-browser-test',blocked),/player-not-ready/);
});
test('slower frames remain strictly sequential at millisecond clock resolution',async()=>{
  const f=fixture({screenshotMs:1200});
  const job=await captureBrowserPage(f.browser,'tides-pier','pilot-browser-test',f);
  validateCapture(job,f.now()/1000);
  assert.ok(job.frames[1].captureRequestedAt>job.frames[0].capturedAt);
});
test('media checks reject a stopped decoder, resets and hidden playback failures',()=>{
  const previous={time:10,decodedFrames:100};
  const current={time:11,decodedFrames:120,paused:false,ended:false,readyState:4,width:1280,height:720};
  checkPlayback(previous,current,1);
  for (const patch of [{time:1},{time:10},{time:30},{decodedFrames:100},{paused:true},{width:0},{readyState:0},{connected:false}]) {
    assert.throws(()=>checkPlayback(previous,{...current,...patch},1));
  }
});
test('failure messages redact URLs and image payloads',()=>{
  assert.equal(safeErrorDetails(new Error('Failed https://example.com/?secret=hidden\nCall log')).reason,'Failed [url]');
  assert.equal(safeErrorDetails(new Error('Bad data:image/jpeg;base64,private')).reason,'Bad [data]');
});
test('network diagnostics retain status and media category without paths or credentials',()=>{
  const request={url:()=> 'https://user:secret@cdn.example/private/camera/segment.ts?token=hidden',resourceType:()=> 'xhr'};
  assert.deepEqual(networkDiagnostic(request,403),{host:'cdn.example',type:'xhr',status:403,kind:'segment'});
  request.url=()=> 'https://cdn.example/private/index.m3u8?token=hidden';
  assert.equal(networkDiagnostic(request,200).kind,'playlist');
});

test('an AI stable-view claim cannot restore shape rejected by independent image checks',async()=>{
  const f=fixture();const job=await captureBrowserPage(f.browser,'tides-pier','pilot-quality-gate',f);
  const records=new Map();
  const raw={surface:'textured',shape:'mixed',height:null,surfaceEvidenceIds:['frame-0001'],shapeEvidenceIds:['frame-0001'],
    limitations:[],summary:'A stable view with mixed shape.',scene:'surf',viewChange:'stable',motion:'visible'};
  const result=await analyzeCameraCapture(job,{OPENAI_API_KEY:'test',BUCKET:{put:async(k,v)=>{records.set(k,v);return {key:k};}}},
    {now:()=>f.now()/1000,fetcher:async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})});
  const record=JSON.parse(records.get(result.objectKey));
  assert.equal(record.observation.shape,'unknown');assert.equal(record.observation.viewChange,'unknown');
  assert.equal(record.sourceTimeVerified,false);assert.equal(record.scoreEligible,false);
});

test('stranded Washout-like buffer is recovered in a gap and the new playback epoch is explicit',async()=>{
 const f=fixture({stranded:true});const job=await captureBrowserPage(f.browser,'tides-pier','pilot-gap-recovery',f);
 assert.equal(job.recoveries.length,1);assert.equal(job.frames[5].playbackEpoch,0);assert.equal(job.frames[6].playbackEpoch,1);
 assert.ok(job.recoveries[0].to>job.recoveries[0].from);validateCapture(job,f.now()/1000);
 const bad=structuredClone(job);bad.recoveries=[];assert.throws(()=>validateCapture(bad,f.now()/1000),/discontinuity/);
});

test('serialized browser quality expression executes and returns compact measurements',async()=>{
 let seed=123456;const rgba=new Uint8ClampedArray(240*136*4);
 for(let i=0;i<rgba.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;rgba[i]=rgba[i+1]=rgba[i+2]=seed>>>24;rgba[i+3]=255;}
 class Image {async decode(){}}
 const document={createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:rgba})})})};
 const page={evaluate:expression=>Function('Image','document','return '+expression)(Image,document)};
 const frames=Array.from({length:36},(_,i)=>({id:String(i),playbackEpoch:0,jpegBase64:'test'}));
 const quality=await measureCapturedViews(page,frames);
 assert.equal(quality.status,'stable');assert.equal(quality.comparisons.length,59);assert.equal(quality.stableBursts.length,6);
 const scout=await measureCapturedViews(page,frames.slice(0,3),'scout');
 assert.equal(scout.status,'stable');assert.equal(scout.comparisons.length,3);
 assert.ok(scout.comparisons.every(p=>p.matches>=8&&p.highCorrelation>=8&&Number.isFinite(p.medianBestCorrelation)));
 assert.deepEqual(scout.comparisons.map(p=>[p.from,p.to]),[['0','1'],['1','2'],['0','2']]);
});

test('scout contact sheet preserves three images, aspect ratios and capture labels in executable browser code',async()=>{
 const drawn=[],labels=[];
 class Image {width=1280;height=720;async decode(){}}
 const canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>drawn.push(args.slice(1)),fillText:text=>labels.push(text)}),toDataURL:()=> 'data:image/jpeg;base64,/9j/AAAA'};
 const document={createElement:()=>canvas};
 const page={evaluate:expression=>Function('Image','document','return '+expression)(Image,document)};
 const frames=Array.from({length:3},(_,i)=>({id:`scout-${i+1}`,jpegBase64:'test',mediaTime:10+i,captureRequestedAt:1800000000+i}));
 assert.equal(await makeScoutContactSheet(page,frames),'/9j/AAAA');
 assert.deepEqual(drawn,[[0,34,960,540],[0,608,960,540],[0,1182,960,540]]);
 assert.equal(canvas.width,960);assert.equal(canvas.height,1722);
 assert.ok(labels.every((s,i)=>s.includes(frames[i].id)&&s.includes(new Date(frames[i].captureRequestedAt*1000).toISOString())));
});

test('stationary browser mode returns bounded empty evidence when every scout is uncertain',async()=>{
  const f=fixture();const capture=await captureBrowserPage(f.browser,'tides-pier','pilot-adaptive-empty',{...f,samplingMode:'stationary'});
  assert.equal(capture.captureMethod,'browser-page-v3');assert.equal(capture.frames.length,0);
  assert.equal(capture.sampling.outcome,'no-stable-window');assert.equal(capture.sourceTimeVerified,false);
  assert.ok(f.counts().shots<=90);
});
