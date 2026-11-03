// Deterministic image registration. Unknown is deliberately different from stable.
// No model, forecast or playback clock is used to decide whether the view moved.
export const QUALITY_VERSION='folly-camera-quality-v1';
// Self-contained so image registration can run beside the screenshots in Chromium.
export function createViewAnalyzer() {
const median=a=>{const s=a.slice().sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
function patch(image,x,y) {
  const a=[];let sum=0,square=0;
  for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++) {
    const n=image.data[(y+dy)*image.width+x+dx];a.push(n);sum+=n;square+=n*n;
  }
  const mean=sum/a.length,sd=Math.sqrt(square/a.length-mean*mean);
  return {a,mean,sd};
}
function correlation(p,q) {
  if(q.sd<6) return -1;
  let s=0;for(let i=0;i<p.a.length;i++) s+=(p.a[i]-p.mean)*(q.a[i]-q.mean);
  return s/(p.a.length*p.sd*q.sd);
}
function compareViews(a,b) {
  if(!a || !b || a.width!==b.width || a.height!==b.height || a.data.length!==a.width*a.height || b.data.length!==b.width*b.height)
    return {status:'unknown',reason:'invalid-image'};
  const matches=[],correlations=[];let textured=0,highCorrelation=0;
  // Exclude player controls and border/branding areas. Require spatial support,
  // not a single horizon or a cluster of moving people/water.
  for(let y=24;y<a.height-22;y+=16) for(let x=24;x<a.width-20;x+=24) {
    const p=patch(a,x,y);if(p.sd<12) continue;textured++;
    let best={c:-1},second=-1;
    const candidates=[];
    for(let dy=-16;dy<=16;dy+=2) for(let dx=-16;dx<=16;dx+=2) {
      const c=correlation(p,patch(b,x+dx,y+dy));candidates.push({c,dx,dy});
      if(c>best.c) best={c,dx,dy};
    }
    const coarse=best;
    for(let dy=coarse.dy-1;dy<=coarse.dy+1;dy++) for(let dx=coarse.dx-1;dx<=coarse.dx+1;dx++) {
      const c=correlation(p,patch(b,x+dx,y+dy));if(c>best.c) best={c,dx,dy};
    }
    for(const c of candidates) if(Math.hypot(c.dx-best.dx,c.dy-best.dy)>3) second=Math.max(second,c.c);
    correlations.push(best.c);if(best.c>=0.94) highCorrelation++;
    if(best.c>=0.94 && best.c-second>=0.025) matches.push({x,y,...best});
  }
  const evidence={matches:matches.length,textured,highCorrelation,medianBestCorrelation:correlations.length?median(correlations):null};
  if(matches.length<8) return {status:'unknown',reason:'insufficient-trackable-landmarks',...evidence};
  // Fit a similarity transform with a bounded, deterministic RANSAC search.
  let fit=null;
  for(let i=0;i<matches.length;i++) for(let j=i+1;j<matches.length;j++) {
    const p=matches[i],q=matches[j],vx=q.x-p.x,vy=q.y-p.y,d=vx*vx+vy*vy;
    if(d<900) continue;
    const ux=vx+q.dx-p.dx,uy=vy+q.dy-p.dy;
    const scaleX=(vx*ux+vy*uy)/d,rotation=(vx*uy-vy*ux)/d;
    const tx=p.x+p.dx-scaleX*p.x+rotation*p.y,ty=p.y+p.dy-rotation*p.x-scaleX*p.y;
    const inliers=matches.filter(p=>Math.hypot(scaleX*p.x-rotation*p.y+tx-p.x-p.dx,rotation*p.x+scaleX*p.y+ty-p.y-p.dy)<1.5);
    if(!fit || inliers.length>fit.inliers.length) fit={scaleX,rotation,tx,ty,inliers};
  }
  if(!fit || fit.inliers.length<8 || fit.inliers.length<matches.length*0.65)
    return {status:'unknown',reason:'inconsistent-landmark-motion',...evidence,inliers:fit?.inliers.length??0};
  const xs=fit.inliers.map(p=>p.x),ys=fit.inliers.map(p=>p.y);
  if(Math.max(...xs)-Math.min(...xs)<a.width*0.35 || Math.max(...ys)-Math.min(...ys)<a.height*0.2)
    return {status:'unknown',reason:'insufficient-spatial-support',...evidence,inliers:fit.inliers.length,
      spanX:Math.max(...xs)-Math.min(...xs),spanY:Math.max(...ys)-Math.min(...ys)};
  const scale=Math.hypot(fit.scaleX,fit.rotation),rotationDegrees=Math.atan2(fit.rotation,fit.scaleX)*180/Math.PI;
  const displacement=median(fit.inliers.map(p=>Math.hypot(p.dx,p.dy)));
  const moved=displacement>1.25 || Math.abs(scale-1)>0.012 || Math.abs(rotationDegrees)>0.75;
  return {status:moved?'pan-or-zoom':'stable',...evidence,inliers:fit.inliers.length,
    displacementPx:displacement,scale,rotationDegrees};
}
function summarizeViews(frames,images) {
  const comparisons=[];
  for(let i=1;i<frames.length;i++) comparisons.push({from:frames[i-1].id,to:frames[i].id,...compareViews(images[i-1],images[i])});
  // Compare every frame with its burst's first frame too: catches accumulated slow pan.
  for(let i=0;i<frames.length;i+=6) for(let j=i+2;j<i+6;j++)
    comparisons.push({from:frames[i].id,to:frames[j].id,...compareViews(images[i],images[j])});
  const stableBursts=[];
  for(let i=0;i<frames.length;i+=6) {
    const ids=frames.slice(i,i+6).map(f=>f.id);
    const pairs=comparisons.filter(p=>ids.includes(p.from)&&ids.includes(p.to));
    if(pairs.length===9 && pairs.every(p=>p.status==='stable') && new Set(frames.slice(i,i+6).map(f=>f.playbackEpoch??0)).size===1)
      stableBursts.push(ids);
  }
  const status=comparisons.some(p=>p.status==='pan-or-zoom')?'pan-or-zoom'
    : comparisons.length && comparisons.every(p=>p.status==='stable')?'stable':'unknown';
  return {version:'folly-camera-quality-v1',method:'distributed-patch-registration',status,stableBursts,comparisons};
}

return {compareViews,summarizeViews};
}
export const {compareViews,summarizeViews}=createViewAnalyzer();

// Parse only timing flags from responses the normal player already requested.
// Segment names, tokens, request headers and response bodies are never retained.
export function parsePlaylistTiming(text,receivedAt) {
  if(typeof text!=='string'||text.length>65536||!text.trimStart().startsWith('#EXTM3U')||!text.includes('#EXTINF:')) return null;
  let edgeAt=null,duration=0,segments=0;
  for(const line of text.split(/\r?\n/)) {
    if(line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const t=Date.parse(line.slice(25))/1000;if(Number.isFinite(t)) edgeAt=t;
    } else if(line.startsWith('#EXTINF:')) {
      const n=Number.parseFloat(line.slice(8));if(Number.isFinite(n)&&n>0&&n<=120){duration+=n;segments++;if(edgeAt!==null)edgeAt+=n;}
    }
  }
  return {receivedAt,edgeAt,duration,segments,ended:text.includes('#EXT-X-ENDLIST'),vod:/#EXT-X-PLAYLIST-TYPE:VOD/.test(text),
    mediaSequence:Number(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1]??0)};
}
export function assessFreshness(frames,playlists=[]) {
  // Only per-frame program timestamps from the actual attached player can verify images.
  const mapped=frames.every(f=>Number.isFinite(f.sourceAt)&&f.sourceClock==='hls-program-date-time'&&f.sourceLive===true);
  const epochs=new Set(frames.map(f=>f.playbackEpoch??0));
  if(mapped&&frames.length>1&&epochs.size===1) {
    const ages=frames.map(f=>f.captureRequestedAt-f.sourceAt);
    const continuous=frames.slice(1).every((f,i)=>f.sourceAt>frames[i].sourceAt &&
      Math.abs((f.sourceAt-frames[i].sourceAt)-(f.mediaTime-frames[i].mediaTime))<2);
    if(continuous&&ages.every(n=>n>=-5&&n<=120)) return {status:'verified',sourceTimeVerified:true,
      sourceStartAt:frames[0].sourceAt,sourceEndAt:frames.at(-1).sourceAt,maxAgeSeconds:Math.max(...ages),method:'attached-player-program-date-time'};
    return {status:'stale-or-discontinuous',sourceTimeVerified:false,sourceStartAt:null,sourceEndAt:null};
  }
  const live=playlists.filter(p=>!p.ended&&!p.vod&&Number.isFinite(p.edgeAt));
  const advancing=live.some((p,i)=>live.slice(i+1).some(q=>p.streamId===q.streamId&&q.edgeAt>p.edgeAt&&q.mediaSequence>p.mediaSequence&&q.receivedAt-q.edgeAt>=-5&&q.receivedAt-q.edgeAt<=120));
  return {status:advancing?'recent-live-manifest-unmapped':playlists.length&&playlists.every(p=>p.ended||p.vod)?'recorded-playlist':'unverified',
    sourceTimeVerified:false,sourceStartAt:null,sourceEndAt:null,
    reason:'No continuous program timestamp mapping for the sampled video frames'};
}

export function recoveryTarget(state) {
  if(state.ended||state.errorCode||!Number.isFinite(state.time)||!Array.isArray(state.buffered)) return null;
  // Only a demonstrably stranded playhead. Never seek speculatively to an unbuffered live edge.
  if(state.buffered.some(([a,b])=>state.time>=a&&state.time<b-0.5)) return null;
  const ranges=state.buffered.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b-a>=9);
  if(!ranges.length) return null;
  const [a,b]=ranges.at(-1),target=Math.max(a+1,b-8);
  // Never replay older footage to make a stalled live player look healthy.
  return target-state.time>2?target:null;
}
