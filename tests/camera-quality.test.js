import test from 'node:test';
import assert from 'node:assert/strict';
import {compareViews,summarizeViews,createViewAnalyzer,parsePlaylistTiming,assessFreshness,recoveryTarget} from '../camera-service/camera-quality.mjs';
function scene(shift=0,scale=1) {
  const width=240,height=136,data=[];let seed=123456;
  const base=Array.from({length:width*height},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;});
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sx=Math.round((x-width/2-shift)/scale+width/2),sy=Math.round((y-height/2)/scale+height/2);
    data.push(sx>=0&&sx<width&&sy>=0&&sy<height?base[sy*width+sx]:0);
  }
  return {width,height,data};
}
test('independent registration distinguishes stable, pan, zoom and untrackable views',()=>{
  const a=scene();assert.equal(compareViews(a,a).status,'stable');
  assert.equal(compareViews(a,scene(6)).status,'pan-or-zoom');
  assert.notEqual(compareViews(a,scene(0,1.06)).status,'stable');
  assert.equal(compareViews({width:240,height:136,data:Array(32640).fill(128)},a).status,'unknown');
  assert.equal(compareViews(a,scene(80)).status,'unknown');
});
test('accumulating slow movement and inter-burst changes cannot certify a complete stable view',()=>{
  const frames=Array.from({length:36},(_,i)=>({id:String(i),playbackEpoch:0}));
  const images=frames.map((_,i)=>scene(Math.floor((i%6)/2)));
  const result=summarizeViews(frames,images);
  assert.notEqual(result.status,'stable');assert.equal(result.stableBursts.length,0);
  assert.equal(result.comparisons.length,59);
});
test('moving media clocks and a recent manifest alone never verify sampled footage',()=>{
  const frames=[{captureRequestedAt:1000,mediaTime:1},{captureRequestedAt:1030,mediaTime:31}];
  const p=[{streamId:1,edgeAt:990,receivedAt:1000,mediaSequence:1},{streamId:1,edgeAt:1020,receivedAt:1030,mediaSequence:4}];
  assert.equal(assessFreshness(frames,p).status,'recent-live-manifest-unmapped');
  assert.equal(assessFreshness(frames,p).sourceTimeVerified,false);
  assert.equal(assessFreshness(frames,p.map((v,i)=>({...v,streamId:i}))).status,'unverified');
});
test('freshness requires current continuous program timestamps tied to the attached player',()=>{
  const frames=[0,30,60].map(t=>({captureRequestedAt:1000+t,sourceAt:990+t,mediaTime:t,sourceClock:'hls-program-date-time',sourceLive:true,playbackEpoch:0}));
  assert.equal(assessFreshness(frames).sourceTimeVerified,true);
  for(const mutate of [f=>f.forEach(v=>v.sourceAt-=600),f=>f[1].sourceAt+=10,f=>f[1].sourceLive=false,f=>f[2].playbackEpoch=1]) {
    const copy=structuredClone(frames);mutate(copy);assert.equal(assessFreshness(copy).sourceTimeVerified,false);
  }
});
test('playlist telemetry retains only timing and distinguishes ended recordings',()=>{
  const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:20\n#EXT-X-PROGRAM-DATE-TIME:2026-10-21T20:00:00Z\n#EXTINF:10,\nsecret.ts?token=hidden\n#EXTINF:10,\nother.ts\n';
  const p=parsePlaylistTiming(text,1792612825);
  assert.equal(p.edgeAt,Date.parse('2026-10-21T20:00:20Z')/1000);assert.equal(p.duration,20);
  assert.ok(!JSON.stringify(p).includes('secret'));assert.equal(p.mediaSequence,20);
  assert.equal(parsePlaylistTiming(text+'#EXT-X-ENDLIST',0).ended,true);
  assert.equal(parsePlaylistTiming('not a playlist',0),null);
});
test('recovery only seeks inside an actual buffered range when the playhead is stranded',()=>{
  assert.equal(recoveryTarget({time:60,buffered:[[0,10]],ended:false}),null);
  assert.equal(recoveryTarget({time:10,buffered:[[20,30]],ended:false}),22);
  assert.equal(recoveryTarget({time:9.91,buffered:[[0,9.997]],ended:false}),null);
  assert.equal(recoveryTarget({time:9,buffered:[[0,10]],ended:false}),null);
  assert.equal(recoveryTarget({time:60,buffered:[[0,4]],ended:false}),null);
  assert.equal(recoveryTarget({time:60,buffered:[[0,10]],ended:true}),null);
  assert.equal(recoveryTarget({time:60,buffered:[[0,10]],errorCode:3}),null);
});

test('browser-side analyzer is self-contained and returns only compact quality measurements',()=>{
  const browserAnalyzer=Function('return ('+createViewAnalyzer.toString()+')()')();
  const a=scene();assert.deepEqual(browserAnalyzer.compareViews(a,a),compareViews(a,a));
  const frames=Array.from({length:36},(_,i)=>({id:String(i),playbackEpoch:0}));
  const result=browserAnalyzer.summarizeViews(frames,frames.map(()=>a));
  assert.equal(result.stableBursts.length,6);assert.ok(JSON.stringify(result).length<20000);
});
