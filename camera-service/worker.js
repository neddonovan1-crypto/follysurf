import {DurableObject} from 'cloudflare:workers';
import {launch,sessions} from '@cloudflare/playwright';
import {BrowserCaptureFault,captureBrowserPage,measureCapturedViews,makeScoutContactSheet,safeErrorDetails} from './browser-capture.mjs';
import {validateCapture} from '../server/camera-analysis.js';
import {assessFreshness} from './camera-quality.mjs';
import {dueValidationWindow} from './validation-schedule.mjs';

export class CameraCapture extends DurableObject {
  currentRun;
  run(cameraId, pilotId) {
    if (!['washout','tides-pier'].includes(cameraId) || !/^[a-z0-9-]{8,50}$/.test(pilotId)) throw new Error('Invalid pilot');
    this.currentRun ??= this.runOnce(cameraId,pilotId).finally(() => {this.currentRun=undefined;});
    return this.currentRun;
  }
  async runOnce(cameraId,pilotId) {
    const runId = `${pilotId}-${cameraId}`, key = `pilot:${runId}`;
    if (await this.ctx.storage.get(key)) return {status:'already-attempted',runId};
    // Persist BEFORE capture: restarts, duplicate crons and failures never restart a pilot automatically.
    await this.ctx.storage.put(key,{status:'started',at:Date.now()});
    const statusKey = `camera-research/status/${cameraId}.json`;
    const save = async value => {
      const record = {runId,cameraId,updatedAt:Date.now()/1000,...value};
      await this.env.BUCKET.put(statusKey,JSON.stringify(record),{httpMetadata:{contentType:'application/json'}});
      return record;
    };
    let browser, timer, stage='browser-start';
    try {
      if(this.env.PILOT_SURFACE_REVIEW_FROM) {
        stage='historical-surface-review';
        const sourcePilot=this.env.PILOT_SURFACE_REVIEW_FROM;
        if(!/^[a-z0-9-]{8,50}$/.test(sourcePilot)||sourcePilot===pilotId) throw new Error('Invalid surface review source');
        const sourceRunId=`${sourcePilot}-${cameraId}`;
        const saved=await this.env.BUCKET.get(`camera-research/${cameraId}/${sourceRunId}/capture.json`);
        if(!saved) throw new Error('Saved surface capture missing');
        const job=await saved.json();
        if(job.runId!==sourceRunId||job.cameraId!==cameraId) throw new Error('Surface capture identity mismatch');
        await save({status:'reviewing-historical-surface',sourceCaptureRunId:sourceRunId,scoreEligible:false});
        const result=await this.env.ANALYSIS.reviewSurface({...job,runId,sourceCaptureRunId:sourceRunId});
        await this.ctx.storage.put(key,result);
        return await save({...result,sourceCaptureRunId:sourceRunId});
      }
      if(this.env.PILOT_QUALITY_FROM && this.env.PILOT_CAPTURE_ONLY==='true') {
        stage='saved-quality-check';
        const sourcePilot=this.env.PILOT_QUALITY_FROM;
        if(!/^[a-z0-9-]{8,50}$/.test(sourcePilot)||sourcePilot===pilotId) throw new Error('Invalid quality source');
        const sourceRunId=`${sourcePilot}-${cameraId}`;
        const saved=await this.env.BUCKET.get(`camera-research/${cameraId}/${sourceRunId}/capture.json`);
        if(!saved) throw new Error('Saved capture missing');
        const job=await saved.json();
        if(job.runId!==sourceRunId||job.cameraId!==cameraId||job.frames?.length!==36) throw new Error('Saved capture identity mismatch');
        await this.closeOwnedBrowser();await this.ctx.storage.setAlarm(Date.now()+120000);
        browser=await launch(this.env.BROWSER,{keep_alive:60000});
        await this.ctx.storage.put('browserSessionId',browser.sessionId());
        const page=await browser.newPage();
        const viewQuality=await measureCapturedViews(page,job.frames);
        if(!viewQuality?.status) throw new Error('Image quality result missing');
        const repaired={...job,runId,sourceCaptureRunId:sourceRunId,viewQuality};
        await this.env.BUCKET.put(`camera-research/${cameraId}/${runId}/capture.json`,JSON.stringify(repaired),
          {httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
        const result={status:'captured',sourceCaptureRunId:sourceRunId,frames:job.frames.length,freshness:job.freshness,
          viewStatus:viewQuality.status,stableBursts:viewQuality.stableBursts.length,recoveries:job.recoveries.length,scoreEligible:false};
        await this.ctx.storage.put(key,result);return await save(result);
      }
      if (this.env.PILOT_REANALYZE_FROM) {
        stage='saved-capture';
        const sourcePilot=this.env.PILOT_REANALYZE_FROM;
        if (!/^[a-z0-9-]{8,50}$/.test(sourcePilot) || sourcePilot===pilotId) throw new Error('Invalid source pilot');
        const sourceRunId=`${sourcePilot}-${cameraId}`;
        const saved=await this.env.BUCKET.get(`camera-research/${cameraId}/${sourceRunId}/capture.json`);
        if (!saved) throw new Error('Saved capture missing');
        const job=await saved.json();
        if (job.runId!==sourceRunId || job.cameraId!==cameraId) throw new Error('Saved capture identity mismatch');
        validateCapture(job);
        if(this.env.PILOT_REVIEW_SHEETS==='true') {
          stage='saved-review-export';
          await save({status:'exporting-review',sourceCaptureRunId:sourceRunId,scoreEligible:false});
          await this.closeOwnedBrowser();await this.ctx.storage.setAlarm(Date.now()+120000);
          browser=await launch(this.env.BROWSER,{keep_alive:60000});
          await this.ctx.storage.put('browserSessionId',browser.sessionId());
          const page=await browser.newPage(),sheets=[];
          for(let i=0;i<job.frames.length;i+=3) {
            const frames=job.frames.slice(i,i+3),index=i/3+1;
            const objectKey=`camera-research/${cameraId}/${runId}/burst-review-${index}.jpg`;
            const sheet=await makeScoutContactSheet(page,frames);
            await this.env.BUCKET.put(objectKey,Uint8Array.from(atob(sheet),c=>c.charCodeAt(0)),
              {httpMetadata:{contentType:'image/jpeg'},onlyIf:new Headers({'If-None-Match':'*'})});
            sheets.push({index,burst:Math.floor(i/6)+1,part:i%6===0?1:2,objectKey,
              frames:frames.map(({jpegBase64,...metadata})=>metadata)});
          }
          await this.env.BUCKET.put(`camera-research/${cameraId}/${runId}/review.json`,
            JSON.stringify({runId,cameraId,sourceCaptureRunId:sourceRunId,sheets,freshness:job.freshness,
              viewQuality:job.viewQuality,sampling:job.sampling,scoreEligible:false}),
            {httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
          await browser.close();browser=undefined;await this.forgetClosedBrowser();
        }
        stage='vision-analysis';
        await save({status:'reanalyzing',sourceCaptureRunId:sourceRunId,scoreEligible:false});
        // Preserve original clocks and pixels. Freshness validation and the daily
        // model budget apply again under this new, once-only analysis attempt ID.
        const result=await this.env.ANALYSIS.analyze({...job,runId,sourceCaptureRunId:sourceRunId});
        await this.ctx.storage.put(key,{status:result.status,at:Date.now()});
        return await save({...result,sourceCaptureRunId:sourceRunId});
      }
      const samplingMode=this.env.PILOT_SAMPLING_MODE??'fixed';
      const captureMethod=samplingMode==='stationary'?'browser-page-v3':'browser-page-v2';
      await save({status:'starting',captureMethod,scoreEligible:false});
      // Recover only our own previous session; never close other account sessions.
      await this.closeOwnedBrowser();
      await this.ctx.storage.setAlarm(Date.now()+330000);
      browser=await launch(this.env.BROWSER,{keep_alive:60000});
      await this.ctx.storage.put('browserSessionId',browser.sessionId());
      stage='page-capture';
      await save({status:'capturing',captureMethod,scoreEligible:false});
      const job=await Promise.race([
        captureBrowserPage(browser,cameraId,runId,{samplingMode,onProgress:async step=>{
          stage=step;await save({status:'capturing',stage,captureMethod,scoreEligible:false});
        },onScoutReview:this.env.PILOT_SCOUT_REVIEW==='true'?async review=>{
          const prefix=`camera-research/${cameraId}/${runId}/scout-review-${review.index}`;
          const frames=[];
          for(const [i,frame] of review.frames.entries()) {
            const {jpegBase64,...metadata}=frame,objectKey=`${prefix}-frame-${i+1}.jpg`;
            await this.env.BUCKET.put(objectKey,Uint8Array.from(atob(jpegBase64),c=>c.charCodeAt(0)),
              {httpMetadata:{contentType:'image/jpeg'},onlyIf:new Headers({'If-None-Match':'*'})});
            frames.push({...metadata,objectKey});
          }
          await this.env.BUCKET.put(`${prefix}.jpg`,Uint8Array.from(atob(review.sheet),c=>c.charCodeAt(0)),
            {httpMetadata:{contentType:'image/jpeg'},onlyIf:new Headers({'If-None-Match':'*'})});
          await this.env.BUCKET.put(`${prefix}.json`,JSON.stringify({runId,cameraId,index:review.index,
            offsetSeconds:review.offsetSeconds,check:review.check,frames,freshness:assessFreshness(review.frames),
            contactSheet:`${prefix}.jpg`,selectionBasis:'first-check-in-each-60-second-bin',scoreEligible:false}),
            {httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
        }:undefined,onDiagnostic:async(details,image)=>{
          const prefix=`camera-research/${cameraId}/${runId}`;
          await this.env.BUCKET.put(`${prefix}/capture-failure.json`,JSON.stringify(details),
            {httpMetadata:{contentType:'application/json'}});
          if(image) await this.env.BUCKET.put(`${prefix}/capture-failure.jpg`,image,
            {httpMetadata:{contentType:'image/jpeg'}});
        }}),
        new Promise((_,reject) => {timer=setTimeout(()=>reject(new BrowserCaptureFault('capture-timeout')),285000);}),
      ]);
      clearTimeout(timer);
      stage='save-capture';
      await save({status:'capturing',stage,scoreEligible:false});
      // Persist evidence before waiting for browser shutdown.
      // Preserve exact timing/transport evidence even with an older analysis deployment.
      await this.env.BUCKET.put(`camera-research/${cameraId}/${runId}/capture.json`,JSON.stringify(job),
        {httpMetadata:{contentType:'application/json'},onlyIf:new Headers({'If-None-Match':'*'})});
      if(this.env.PILOT_CAPTURE_ONLY==='true') {
        const result={status:job.frames.length?'captured':'no-stable-window',frames:job.frames.length,sampling:job.sampling??null,freshness:job.freshness,viewStatus:job.viewQuality.status,
          stableBursts:job.viewQuality.stableBursts.length,recoveries:job.recoveries.length,scoreEligible:false};
        await this.ctx.storage.put(key,result);return await save(result);
      }
      if(!job.frames.length) return await save({status:'no-stable-window',sampling:job.sampling,scoreEligible:false});
      await browser.close();browser=undefined;
      await this.forgetClosedBrowser();
      stage='vision-analysis';
      await save({status:'analyzing',scoreEligible:false});
      const result = await this.env.ANALYSIS.analyze(job);
      await this.ctx.storage.put(key,{status:result.status,at:Date.now()});
      return await save(result);
    } catch (error) {
      const result = {status:'failed',errorCode:error instanceof BrowserCaptureFault ? error.code : `${stage}-failed`,
        stage,...safeErrorDetails(error),scoreEligible:false};
      await this.ctx.storage.put(key,result);
      await save(result);
      console.error(JSON.stringify({cameraId,runId,...result}));
      return result;
    } finally {
      clearTimeout(timer);
      try {
        if(browser) {await browser.close();await this.forgetClosedBrowser();}
        else await this.closeOwnedBrowser();
      } catch { /* Persisted alarm retries cleanup; browser idle timeout remains active. */ }
    }
  }
  async closeOwnedBrowser() {
    const id=await this.ctx.storage.get('browserSessionId');
    // A previously closed session may already be absent. Listing active sessions
    // avoids turning an expired-session lookup into a failure of the next pilot.
    if (id && (await sessions(this.env.BROWSER)).some(session=>session.sessionId===id)) {
      await this.env.BROWSER.closeSession(id);
    }
    await this.forgetClosedBrowser();
  }
  async forgetClosedBrowser() {
    await this.ctx.storage.delete('browserSessionId');
    await this.ctx.storage.deleteAlarm();
  }
  async alarm() {await this.closeOwnedBrowser();}
}

export default {
  fetch() {return new Response('Not found',{status:404});},
  async scheduled(_event,env) {
    // No repeating camera collection: one immutable pilot ID, one attempt per camera.
    if (env.PILOT_ENABLED !== 'true') return;
    if(env.PILOT_VALIDATION_PLAN) {
      const window=dueValidationWindow(env);
      if(window) await env.CAPTURE.getByName('tides-pier').run('tides-pier',window.id);
      return;
    }
    // Only attempt the pilot with daylight in Charleston. Do not infer source freshness from this clock.
    const hour = Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date()));
    const expires=Date.parse(env.PILOT_RUN_UNTIL??'');
    const boundedNow=Number.isFinite(expires)&&expires>Date.now()&&expires-Date.now()<=3600000;
    if (!boundedNow && (hour<10 || hour>=16)) return;
    if(Number.isFinite(expires)&&Date.now()>=expires) return;
    // Serial launches also respect the free-tier launch-rate limit.
    for (const cameraId of env.PILOT_CAMERA ? [env.PILOT_CAMERA] : ['washout','tides-pier']) {
      await env.CAPTURE.getByName(cameraId).run(cameraId,env.PILOT_ID);
    }
  },
};

