// Select windows by camera stability only, never by the apparent quality of the surf.
export const STATIONARY_POLICY=Object.freeze({watchSeconds:180,scoutIntervalMs:2000,
  framesPerBurst:6,maxBursts:6,maxCandidates:8,cooldownMs:10000});

export async function selectStationaryBursts({captureFrame,scoutQuality,burstQuality,now,wait,onProgress=async()=>{},onScoutReview}) {
  const started=now(),deadline=started+STATIONARY_POLICY.watchSeconds*1000;
  const frames=[],scouts=[],attempts=[],scoutChecks=[];
  let shots=0;
  const reviews=new Set();
  const take=async()=>{const frame=await captureFrame();shots++;return frame;};
  await onProgress('waiting-for-stationary-view');
  while(now()+15000<deadline && frames.length<36 && attempts.length<STATIONARY_POLICY.maxCandidates) {
    const frame=await take();scouts.push(frame);if(scouts.length>3) scouts.shift();
    if(scouts.length===3) {
      const quality=await scoutQuality(scouts);
      const check={at:now()/1000,status:quality.status,comparisons:quality.comparisons??[]};
      scoutChecks.push(check);
      // Three preassigned time bins; review selection never depends on the result.
      const bin=Math.floor((now()-started)/60000);
      let review;
      if(onScoutReview && bin<3 && !reviews.has(bin)) {
        reviews.add(bin);
        review={index:bin+1,offsetSeconds:(now()-started)/1000,check,frames:scouts.slice()};
      }
      if(quality.status==='stable') {
        await onProgress('checking-stationary-burst');
        const candidate=[frame];
        for(let i=1;i<6;i++) {
          await wait(Math.max(0,candidate.at(-1).captureRequestedAt*1000+1000-now()));
          candidate.push(await take());
        }
        const timely=candidate.every((f,i)=>{
          if(i===0) return true;
          const prior=candidate[i-1],gap=f.captureRequestedAt-prior.captureRequestedAt;
          const advance=f.mediaTime-prior.mediaTime;
          return gap>=0.8 && gap<=2 && f.captureRequestedAt>prior.capturedAt &&
            advance>=0.6*gap && advance<=gap+0.75;
        });
        const named=candidate.map((f,i)=>({...f,id:`frame-${String(frames.length+i+1).padStart(4,'0')}`,
          offsetSeconds:f.captureRequestedAt-started/1000}));
        const checked=await burstQuality(named);
        const accepted=timely && checked.stableBursts?.length===1 && checked.status==='stable';
        attempts.push({startAt:candidate[0].captureRequestedAt,endAt:candidate.at(-1).capturedAt,
          accepted,reason:accepted?'stable':!timely?'invalid-capture-or-playback-cadence':checked.status,
          ...(accepted?{frameIds:named.map(f=>f.id)}:{})});
        if(accepted) frames.push(...named);
        if(review) await onScoutReview(review);
        scouts.length=0;
        await onProgress(accepted?'stationary-burst-captured':'burst-rejected-view-moved-or-unknown');
        await wait(Math.min(STATIONARY_POLICY.cooldownMs,Math.max(0,deadline-now())));
        continue;
      }
      if(review) await onScoutReview(review);
    }
    await wait(STATIONARY_POLICY.scoutIntervalMs);
  }
  return {captureStartedAt:started/1000,captureCompletedAt:now()/1000,frames,
    sampling:{policy:'stationary-view-v1',watchLimitSeconds:180,shots,scoutChecks,attempts,reviewSamples:reviews.size,
      acceptedBursts:frames.length/6,selectionBasis:'camera-stability-only',
      outcome:frames.length?'stable-windows-captured':'no-stable-window'}};
}
