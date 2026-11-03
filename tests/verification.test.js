import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BUOY_STATION,buoyForecastURL,createBuoySnapshot,compareSnapshots} from '../server/verification.js';

const T=Date.parse('2026-10-21T12:00:00Z')/1000;
const snap=(lead,wave=2,t=T,extra={})=>({source:'open-meteo-buoy',retrievedAt:t-lead*3600,
  latitude:BUOY_STATION.latitude,longitude:BUOY_STATION.longitude,
  hourly:{time:[t],wave_height:[wave]},...extra});

test('buoy forecast uses a separate sea-cell request and preserves actual model coordinates',()=>{
  const url=new URL(buoyForecastURL());
  assert.equal(url.searchParams.get('longitude'),'-79.099');
  assert.equal(url.searchParams.get('cell_selection'),'sea');
  const model={latitude:32.5,longitude:-79.1,hourly_units:{wave_height:'m'},hourly:{time:[T,T+3600],wave_height:[null,1.6]}};
  const snapshot=createBuoySnapshot(model,T-3600);
  assert.equal(snapshot.retrievedAt,T-3600);
  assert.equal(snapshot.longitude,-79.1);
  assert.deepEqual(snapshot.hourly,{time:[T+3600],wave_height:[1.6]});
  assert.ok(snapshot.gridDistanceKm<1);
  assert.equal(createBuoySnapshot({...model,hourly_units:{wave_height:'ft'}},T),null);
  assert.equal(createBuoySnapshot({...model,longitude:-79.91,latitude:32.64},T),null);
});

test('scores signed bias and absolute error only for forecasts obtained before the valid hour',()=>{
  const result=compareSnapshots([snap(12,2),snap(-1,8),snap(12,1,T+3600)],
    [{t:T,waveM:1},{t:T+3600,waveM:3}],{now:T+7200});
  assert.equal(result.bins[0].count,2);
  assert.equal(result.bins[0].meanAbsoluteErrorM,1.5);
  assert.equal(result.bins[0].meanBiasM,-.5);
  assert.equal(result.rejected.hindsightOrFuture,1);
});

test('repeat downloads do not inflate counts and earliest snapshot within each lead bin wins',()=>{
  const result=compareSnapshots([snap(12,2),snap(20,4),snap(20,4),snap(36,3)],
    [{t:T,waveM:1}],{now:T});
  assert.equal(result.bins[0].count,1);
  assert.equal(result.bins[0].meanBiasM,3);
  assert.equal(result.bins[1].count,1);
  assert.equal(result.bins[1].meanBiasM,2);
  assert.equal(result.uniqueMatchedHours,1);
});

test('observations must be within 30 minutes and cannot be future, missing or from another station',()=>{
  const result=compareSnapshots([snap(12)],
    [{t:T-1801,waveM:1},{t:T,waveM:null},{t:T,waveM:2,station:'99999'},{t:T+1,waveM:3}],{now:T});
  assert.equal(result.bins[0].count,0);
  assert.equal(result.bins[0].meanBiasM,null);
  assert.equal(result.status,'awaiting-matches');
  assert.equal(compareSnapshots([snap(12)],[{t:T-1800,waveM:1}],{now:T}).bins[0].count,1);
});

test('nearest observation wins and a half-hour observation is not counted twice per bin',()=>{
  const result=compareSnapshots([snap(12,2),snap(12,4,T+3600)],
    [{t:T+1800,waveM:1}],{now:T+7200});
  assert.equal(result.bins[0].count,1);
  assert.equal(result.bins[0].meanBiasM,1);
  const nearest=compareSnapshots([snap(12,2)],
    [{t:T-1200,waveM:8},{t:T-600,waveM:1.5}],{now:T});
  assert.equal(nearest.bins[0].meanBiasM,.5);
});

test('Folly offshore forecasts, invalid units and wrong-source snapshots cannot validate the distant buoy',()=>{
  const result=compareSnapshots([
    snap(12,2,T,{latitude:32.64,longitude:-79.91}),
    snap(12,2,T,{source:'folly-marine'}),
    snap(12,2,T,{heightUnit:'ft'}),
    snap(12,2,T,{latitude:null}),
  ],[{t:T,waveM:2}],{now:T});
  assert.equal(result.uniqueMatchedHours,0);
  assert.equal(result.rejected.wrongLocation,2);
  assert.equal(result.rejected.invalidSnapshot,2);
});

test('lead-bin boundaries do not double count and forecast hours beyond now are not scored',()=>{
  const result=compareSnapshots([snap(6),snap(24),snap(48),snap(72),snap(120),snap(168),snap(12,2,T+3600)],
    [{t:T,waveM:1},{t:T+3600,waveM:1}],{now:T});
  assert.deepEqual(result.bins.map(b=>b.count),[1,1,1,1,1]);
  assert.equal(result.rejected.outsideLeadBins,1);
  assert.equal(result.rejected.hindsightOrFuture,1);
});

test('an observed or forecast zero remains a valid offshore calm observation',()=>{
  const result=compareSnapshots([snap(12,0)],[{t:T,waveM:0}],{now:T});
  assert.equal(result.bins[0].count,1);
  assert.equal(result.bins[0].meanAbsoluteErrorM,0);
});
