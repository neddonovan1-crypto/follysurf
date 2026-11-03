import {selectStationaryBursts} from './stationary-sampler.mjs';
import {createViewAnalyzer,parsePlaylistTiming,assessFreshness,recoveryTarget} from './camera-quality.mjs';
export const CAMERA_PAGES = Object.freeze({
  washout: 'https://surfwashout.com/',
  'tides-pier': 'https://www.tidesfollybeach.com/surf-cam/',
});
export const SAMPLE_OFFSETS = Object.freeze(Array.from({length:36}, (_, i) => Math.floor(i/6)*30+i%6));
export class BrowserCaptureFault extends Error {
  constructor(code) {super(code); this.name='BrowserCaptureFault'; this.code=code;}
}
const fail = code => {throw new BrowserCaptureFault(code);};
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
export function networkDiagnostic(request,status=null) {
  const url=new URL(request.url());
  return {host:url.hostname,type:request.resourceType(),status,
    kind:/\.m3u8$/i.test(url.pathname) ? 'playlist' : /\.(ts|m4s|mp4)$/i.test(url.pathname) ? 'segment' : 'other'};
}
async function installMediaDiagnostics(page) {
  await page.addInitScript(() => {
    const records=[];window.__surfMediaDiagnostics=records;
    // Observe the page's own Hls instances; leave URLs, settings and requests untouched.
    const attached=new WeakMap();window.__surfAttachedHls=attached;
    const instrument=Hls=>{
      if(!Hls?.prototype?.attachMedia || Hls.prototype.__surfObserved) return Hls;
      const original=Hls.prototype.attachMedia;
      Hls.prototype.attachMedia=function(media) {
        const result=original.call(this,media);attached.set(media,this);return result;
      };
      Object.defineProperty(Hls.prototype,'__surfObserved',{value:true});return Hls;
    };
    let hls=instrument(window.Hls);
    try {Object.defineProperty(window,'Hls',{configurable:true,get:()=>hls,set:value=>{hls=instrument(value);}});} catch {}

    const last=new WeakMap();
    const ranges=r=>Array.from({length:Math.min(r.length,8)},(_,i)=>[r.start(i),r.end(i)]);
    for(const event of ['loadstart','loadedmetadata','playing','waiting','stalled','seeking','seeked','ended','error','emptied','durationchange','timeupdate']) {
      document.addEventListener(event,e=>{
        const v=e.target;if(!(v instanceof HTMLVideoElement)) return;
        const at=Date.now();if(event==='timeupdate' && at-(last.get(v)||0)<1000) return;
        if(event==='timeupdate') last.set(v,at);
        records.push({at,event,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,
          readyState:v.readyState,networkState:v.networkState,seeking:v.seeking,paused:v.paused,
          errorCode:v.error?.code??null,buffered:ranges(v.buffered),seekable:ranges(v.seekable),
          decodedFrames:v.getVideoPlaybackQuality?.().totalVideoFrames??null,
          visible:!!(v.getBoundingClientRect().width && v.getBoundingClientRect().height),
          videoCount:document.querySelectorAll('video').length});
        if(records.length>240) records.shift();
      },true);
    }
  });
}
export function safeErrorDetails(error) {
  return {errorType:String(error?.name ?? 'Error').slice(0,40),reason:String(error?.message ?? '').split('\n')[0]
    .replace(/https?:\/\/\S+/g,'[url]').replace(/data:\S+/g,'[data]').slice(0,180)};
}

// Read only presentation/playback state. Never collect cookies, media URLs or player credentials.
export async function mediaState(video) {
  return video.evaluate(v => {
    const hls=v.ownerDocument.defaultView.__surfAttachedHls?.get(v);
    const date=hls?.playingDate;
    const sourceAt=date instanceof Date && Number.isFinite(date.getTime())?date.getTime()/1000:null;
    const details=hls?.latestLevelDetails??hls?.levels?.[hls?.currentLevel]?.details;
    return {sourceAt,sourceClock:sourceAt===null?null:'hls-program-date-time',sourceLive:details?.live===true,
    time:v.currentTime,paused:v.paused,ended:v.ended,
    readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,
    connected:v.isConnected,duration:Number.isFinite(v.duration) ? v.duration : null,
    seeking:v.seeking,networkState:v.networkState,errorCode:v.error?.code??null,
    buffered:Array.from({length:Math.min(v.buffered.length,8)},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]),
    seekable:Array.from({length:Math.min(v.seekable.length,8)},(_,i)=>[v.seekable.start(i),v.seekable.end(i)]),
    bufferedUntil:v.buffered.length ? v.buffered.end(v.buffered.length-1) : 0,
    decodedFrames:v.getVideoPlaybackQuality?.().totalVideoFrames ?? null};});
}
export function checkPlayback(previous,current,wallSeconds) {
  if (current.connected===false) fail('player-replaced');
  if (current.paused || current.ended || current.readyState<2 || current.width<320 || current.height<180 ||
      !Number.isFinite(current.time)) fail('player-not-ready');
  if (previous) {
    const advance=current.time-previous.time;
    if (advance<0.1) fail('player-stalled-or-reset');
    if (advance>wallSeconds+5 || advance<Math.max(0.1,wallSeconds-12)) fail('player-discontinuous');
    if (current.decodedFrames!==null && previous.decodedFrames!==null && current.decodedFrames<=previous.decodedFrames) {
      fail('video-not-decoding');
    }
  }
}

async function prepareVideo(page,cameraId,{now,wait,setStep}) {
  setStep('navigate-camera-page');
  const response=await page.goto(CAMERA_PAGES[cameraId],{waitUntil:'domcontentloaded',timeout:45000});
  if (!response?.ok()) fail('camera-page-http-error');
  if (cameraId==='tides-pier') {
    setStep('cookie-notice');
    const accept=page.getByRole('button',{name:'ACCEPT',exact:true});
    if (await accept.isVisible()) await accept.click();
  } else {
    setStep('scroll-to-player');
    // This site uses data-scroll-id, not an element whose id is livecam.
    await page.getByRole('link',{name:'Watch Live',exact:true}).click();
  }
  const video = cameraId==='washout'
    ? page.frameLocator('iframe[src="https://coastalcameranetwork.com/webcams/washout/beach-cam.php"]').locator('video').first()
    : page.locator('#folly-video');
  if (cameraId==='washout') {
    setStep('play-button');
    const play=page.frameLocator('iframe[src="https://coastalcameranetwork.com/webcams/washout/beach-cam.php"]')
      .getByRole('button',{name:'Play Video',exact:true});
    await play.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if (await play.isVisible()) await play.click();
  }
  setStep('video-visible');
  await video.waitFor({state:'visible',timeout:45000});
  await video.scrollIntoViewIfNeeded();
  // Standard HTML media playback, equivalent to pressing Play; no request header changes.
  setStep('start-media');
  await video.evaluate(v => {v.muted=true; return v.play();}).catch(() => {});
  setStep('wait-playback');
  const deadline=now()+45000;
  let previous=null;
  while (now()<deadline) {
    const current=await mediaState(video);
    try {
      checkPlayback(previous,current,1);
      if (previous) return video;
      previous=current;
    } catch {previous=null;}
    await wait(1000);
  }
  fail('player-start-timeout');
}

async function renderedClip(video,cdp) {
  const box=await video.boundingBox();
  if (!box || box.width<160 || box.height<90) fail('player-not-visible');
  const {cssVisualViewport}=await cdp.send('Page.getLayoutMetrics');
  // Locator boxes are relative to the main viewport, including iframe offsets.
  // CDP screenshot clips use document coordinates. No media URL is requested.
  return {x:box.x+cssVisualViewport.pageX,y:box.y+cssVisualViewport.pageY,
    width:box.width,height:box.height,scale:1};
}

export async function captureBrowserPage(browser,cameraId,runId,{now=Date.now,wait=sleep,onDiagnostic=async()=>{},onProgress=async()=>{},onScoutReview,samplingMode='fixed'}={}) {
  if (!['fixed','stationary'].includes(samplingMode) || (samplingMode==='stationary'&&cameraId!=='tides-pier') || !Object.hasOwn(CAMERA_PAGES,cameraId) || !/^[a-z0-9-]{8,80}$/.test(runId)) fail('invalid-capture-request');
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(10000);
  await page.bringToFront();
  let step='prepare-player',lastMediaState=null;
  const captureTimings=[],network=[],playlists=[],pending=new Set(),streamIds=new Map(),recoveries=[];
  let playbackEpoch=0;
  const collectTiming=async response=>{
    const request=response.request();
    const frameUrl=request.frame().url();
    const expected=cameraId==='washout'?'https://coastalcameranetwork.com/webcams/washout/beach-cam.php':CAMERA_PAGES[cameraId];
    if(!frameUrl.startsWith(expected)||pending.size>=2||playlists.length>=100||response.status()!==200) return;
    if(Number(response.headers()['content-length']??0)>65536) return;
    const data=parsePlaylistTiming(await response.text(),now()/1000);if(!data) return;
    const url=request.url();
    if(!streamIds.has(url)){if(streamIds.size>=8)return;streamIds.set(url,streamIds.size+1);}
    playlists.push({...data,streamId:streamIds.get(url)});
  };
  const remember=record=>{network.push({at:now(),...record});if(network.length>240) network.shift();};
  const onResponse=response=>{
    try {const record=networkDiagnostic(response.request(),response.status());
      if(record.kind!=='other' || record.status>=400) remember(record);
      if(record.kind==='playlist') {
        const task=collectTiming(response).catch(()=>{});pending.add(task);task.finally(()=>pending.delete(task));
      }
    } catch { /* Telemetry cannot interrupt playback. */ }
  };
  const onFailed=request=>{try {remember({...networkDiagnostic(request),failed:true});} catch {}};
  page.on('response',onResponse);page.on('requestfailed',onFailed);
  let diagnosticVideo;
  try {
  await installMediaDiagnostics(page);
  const video=await prepareVideo(page,cameraId,{now,wait,setStep:value=>{step=value;}});
  diagnosticVideo=video;
  if (cameraId==='tides-pier') {
    step='late-cookie-notice';
    // The notice is inserted asynchronously and its visible label is styled uppercase.
    const accept=page.getByText(/^accept$/i,{exact:true});
    await accept.waitFor({state:'visible',timeout:5000}).catch(()=>{});
    if (await accept.isVisible()) await accept.click();
  }
  step='prepare-screenshot';
  // Retain the actual element during this bounded capture. Locator.evaluate
  // otherwise resolves and disposes a handle on every sample (three round trips).
  const videoHandle=await video.elementHandle();
  if (!videoHandle) fail('player-not-visible');
  const cdp=await page.context().newCDPSession(page);
  let clip=await renderedClip(videoHandle,cdp);
  if(samplingMode==='stationary') {
    let prior=null,priorAt=null,priorImage=null,repeats=0,shots=0;
    const selected=await selectStationaryBursts({now,wait,onProgress:async value=>{step=value;await onProgress(value);},
      onScoutReview:onScoutReview?async review=>{
        const sheet=await makeScoutContactSheet(page,review.frames);
        await onScoutReview({...review,sheet});
      }:undefined,
      captureFrame:async()=>{
        clip=await renderedClip(videoHandle,cdp);
        const requested=now(),state=await mediaState(videoHandle);lastMediaState=state;
        checkPlayback(prior,state,priorAt===null?0:(requested-priorAt)/1000);
        const {data:jpegBase64}=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:65,clip,captureBeyondViewport:true});
        const completed=now();
        if(completed-requested>2000) fail('sampling-too-slow');
        if(jpegBase64.length>600000) fail('frame-too-large');
        repeats=jpegBase64===priorImage?repeats+1:0;if(repeats>=2) fail('repeated-rendered-frames');
        prior=state;priorAt=requested;priorImage=jpegBase64;
        return {id:`scout-${++shots}`,captureRequestedAt:requested/1000,capturedAt:completed/1000,
          mediaTime:state.time,decodedFrames:state.decodedFrames,playbackEpoch:0,
          sourceAt:state.sourceAt??null,sourceClock:state.sourceClock??null,sourceLive:state.sourceLive===true,jpegBase64};
      },scoutQuality:frames=>measureCapturedViews(page,frames,'scout'),
      burstQuality:frames=>measureCapturedViews(page,frames)});
    if(selected.frames.reduce((n,f)=>n+f.jpegBase64.length,0)>12000000) fail('capture-too-large');
    step='independent-image-quality';await onProgress(step);
    const viewQuality=selected.frames.length?await measureCapturedViews(page,selected.frames):
      {version:'folly-camera-quality-v1',method:'distributed-patch-registration',status:'unknown',stableBursts:[],comparisons:[]};
    const freshness=assessFreshness(selected.frames,playlists);
    return {...selected,runId,cameraId,viewQuality,freshness,recoveries:[],playlists,
      captureMethod:'browser-page-v3',sourcePage:CAMERA_PAGES[cameraId],sourceTimeVerified:freshness.sourceTimeVerified,
      playbackChecks:{mediaAdvanced:true,decodedFramesChecked:selected.frames.every(f=>f.decodedFrames!==null),
        repeatedFrameCheckPassed:true,visualQuality:'awaiting-model-and-human-review'}};
  }
  const started=now(), frames=[];
  // Poll in the otherwise idle gaps. Recovery is allowed only outside image bursts.
  const maintainPlayback=async until=>{
    let last=null,stalledSince=null;
    while(now()<until) {
      const state=await mediaState(videoHandle);lastMediaState=state;
      const progressing=state.readyState>=2 && !state.paused && !state.ended && (!last||state.time>last.time+0.1);
      if(progressing) stalledSince=null;else stalledSince??=now();
      if(stalledSince!==null&&now()-stalledSince>=3000&&recoveries.length<2&&until-now()>4000) {
        const target=recoveryTarget(state);
        if(target!==null) {
          await videoHandle.evaluate((v,t)=>{v.currentTime=t;return v.play();},target);
          playbackEpoch++;recoveries.push({at:now()/1000,from:state.time,to:target,playbackEpoch,reason:'stranded-outside-buffer'});
          stalledSince=null;last=null;continue;
        }
      }
      last=state;await wait(Math.min(1000,Math.max(0,until-now())));
    }
  };
  let previous=null,previousAt=null,previousCompletedAt=null,previousImage=null,repeats=0,total=0;
  for (const offsetSeconds of SAMPLE_OFFSETS) {
    if (offsetSeconds>0 && offsetSeconds%30===0) {
      step='refresh-player-position';
      const epochBefore=playbackEpoch;
      await maintainPlayback(started+(offsetSeconds-2)*1000);
      if(playbackEpoch!==epochBefore) previous=null;
      clip=await renderedClip(videoHandle,cdp);
    }
    step=`frame-${offsetSeconds}`;
    await wait(Math.max(0,Math.max(started+offsetSeconds*1000,(previousAt ?? 0)+800,(previousCompletedAt ?? 0)+1)-now()));
    let before=now(),state;
    if (before-started-offsetSeconds*1000>4000) fail('sampling-too-slow');
    // HLS can briefly buffer at a segment boundary. Keep the real timestamps;
    // never substitute a frozen frame or compress a delayed burst into duplicates.
    while(true) {
      before=now();state=await mediaState(videoHandle);lastMediaState=state;
      try {checkPlayback(previous,state,previousAt===null ? 0 : (before-previousAt)/1000);break;}
      catch(error) {
        if (!['player-not-ready','video-not-decoding','player-stalled-or-reset'].includes(error.code) ||
            state.ended || (previous && state.time<previous.time) || now()+250>started+offsetSeconds*1000+4000) throw error;
        await wait(250);
      }
    }
    // One compositor screenshot command avoids Locator.screenshot's repeated
    // font/stability/scroll preparation. Cross-origin pixels remain browser-rendered.
    const screenshotStarted=now();
    const {data:jpegBase64}=await cdp.send('Page.captureScreenshot',{
      format:'jpeg',quality:65,clip,captureBeyondViewport:true,
    });
    const completed=now(),capturedAt=completed/1000;
    captureTimings.push({offsetSeconds,mediaCheckMs:screenshotStarted-before,screenshotMs:now()-screenshotStarted});
    if (capturedAt-before/1000>10) fail('screenshot-too-slow');
    if (jpegBase64.length>600000) fail('frame-too-large');
    total+=jpegBase64.length;
    if (total>12000000) fail('capture-too-large');
    repeats=jpegBase64===previousImage ? repeats+1 : 0;
    if (repeats>=2) fail('repeated-rendered-frames');
    frames.push({id:`frame-${String(offsetSeconds+1).padStart(4,'0')}`,offsetSeconds,
      capturedAt,captureRequestedAt:before/1000,mediaTime:state.time,decodedFrames:state.decodedFrames,playbackEpoch,
      sourceAt:state.sourceAt??null,sourceClock:state.sourceClock??null,sourceLive:state.sourceLive===true,jpegBase64});
    previous=state;previousAt=before;previousCompletedAt=completed;previousImage=jpegBase64;
  }
  const captureCompletedAt=now()/1000;
  step='independent-image-quality';
  await onProgress(step);
  const viewQuality=await measureCapturedViews(page,frames);
  const freshness=assessFreshness(frames,playlists);
  return {runId,cameraId,captureStartedAt:started/1000,captureCompletedAt,frames,viewQuality,freshness,recoveries,playlists,
    captureMethod:'browser-page-v2',sourcePage:CAMERA_PAGES[cameraId],sourceTimeVerified:freshness.sourceTimeVerified,
    playbackChecks:{mediaAdvanced:true,decodedFramesChecked:frames.every(f=>f.decodedFrames!==null),
      repeatedFrameCheckPassed:true,visualQuality:'awaiting-model-and-human-review'}};
  } catch(error) {
    const mediaEvents=diagnosticVideo ? await diagnosticVideo.evaluate(v=>v.ownerDocument.defaultView.__surfMediaDiagnostics??[]).catch(()=>[]) : [];
    // Capture the visible failure state, never browser storage or network credentials.
    const diagnostic=await page.screenshot({type:'jpeg',quality:60,timeout:5000}).catch(()=>null);
    await onDiagnostic({step,...safeErrorDetails(error),lastMediaState,captureTimings,network,mediaEvents,playlists,recoveries},diagnostic).catch(()=>{});
    throw error;
  } finally {
    page.off('response',onResponse);page.off('requestfailed',onFailed);
  }
}

export async function measureCapturedViews(page,frames,mode='capture') {
  if(!['capture','scout'].includes(mode)||(mode==='scout'&&frames.length!==3)) fail('invalid-quality-request');
  // Decode only our own compositor screenshots, never cross-origin video pixels.
  const measureImages=async frames=>{
    const out=[];const canvas=document.createElement('canvas');canvas.width=240;canvas.height=136;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    for(const f of frames) {
      const image=new Image();image.src='data:image/jpeg;base64,'+f.jpegBase64;await image.decode();
      ctx.drawImage(image,0,0,240,136);const rgba=ctx.getImageData(0,0,240,136).data,data=[];
      for(let i=0;i<rgba.length;i+=4)data.push(Math.round(0.299*rgba[i]+0.587*rgba[i+1]+0.114*rgba[i+2]));
      out.push({width:240,height:136,data});
    }
    return out;
  };
  // Return only 59 compact measurements. Sending 1.2 million grayscale numbers
  // through Playwright serialization can exhaust the Worker memory budget.
  return await page.evaluate(`(async frames => {
    const __name=value=>value; // Wrangler keep-names helper for serialized functions.
    const images=await (${measureImages.toString()})(frames);
    const analyzer=(${createViewAnalyzer.toString()})();
    if(${JSON.stringify(mode)}==='scout') {
      const pairs=[[0,1],[1,2],[0,2]].map(([a,b])=>({from:frames[a].id,to:frames[b].id,
        ...analyzer.compareViews(images[a],images[b])}));
      return {status:pairs.every(p=>p.status==='stable')?'stable':pairs.some(p=>p.status==='pan-or-zoom')?'pan-or-zoom':'unknown',comparisons:pairs};
    }
    return analyzer.summarizeViews(frames,images);
  })(${JSON.stringify(frames)})`);
}

export async function makeScoutContactSheet(page,frames) {
  if(frames.length!==3) fail('invalid-review-frames');
  // Render our already captured JPEGs; no new camera requests or pixel reads.
  const render=async frames=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=3*574;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#101820';ctx.fillRect(0,0,960,1722);
    for(const [i,frame] of frames.entries()) {
      const image=new Image();image.src='data:image/jpeg;base64,'+frame.jpegBase64;await image.decode();
      const scale=Math.min(960/image.width,540/image.height),width=image.width*scale,height=image.height*scale;
      ctx.drawImage(image,(960-width)/2,i*574+34,width,height);
      ctx.fillStyle='#ffffff';ctx.font='18px sans-serif';
      ctx.fillText(frame.id+' | capture '+new Date(frame.captureRequestedAt*1000).toISOString()+' | media '+frame.mediaTime.toFixed(3),12,i*574+24);
    }
    return canvas.toDataURL('image/jpeg',0.82).split(',')[1];
  };
  const sheet=await page.evaluate(`(${render.toString()})(${JSON.stringify(frames)})`);
  if(typeof sheet!=='string'||sheet.length>1500000) fail('invalid-review-sheet');
  return sheet;
}
