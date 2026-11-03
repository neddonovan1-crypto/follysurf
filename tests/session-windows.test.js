import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSessionWindows} from '../web/session-windows.js';
const at=Date.parse('2026-10-21T12:00:00Z')/1000;
const rows=Array.from({length:8},(_,i)=>({t:at+i*3600,isDay:1,wind:4,windDir:315,gust:6}));
const nearshoreRows=rows.map(row=>({t:row.t,waveM:1.2,peakPeriodS:13}));
const daily={sunrise:[at-1800],sunset:[at+9*3600]};
const base={rows,nearshoreRows,daily,now:at,day:'2026-10-21',weatherFresh:true,nearshoreFresh:true};

test('rates complete nearshore and wind windows without an NWS dependency',()=>{
 const result=rankSessionWindows(base);
 assert.equal(result.status,'rated');
 assert.equal(result.best.start,at);
 assert.equal(result.best.end,at+7200);
 assert.ok(Number.isFinite(result.best.score));
 assert.equal(result.best.hourlyScoreRange.min,result.best.score);
 assert.equal(result.ratedWindows,7);
});
test('best session considers wave potential, not merely the lightest wind',()=>{
 const result=rankSessionWindows({...base,rows:rows.map((r,i)=>({...r,wind:i<2?0:5,gust:i<2?0:7})),nearshoreRows:nearshoreRows.map((r,i)=>({...r,waveM:i<2?.05:1.2}))});
 assert.equal(result.best.start,at+2*3600);
 assert.equal(result.best.avgWind,5);
});
test('conservative ranking rejects a single excellent hour paired with poor surf',()=>{
 const waves=[1.2,.05,.05,.8,.8,.05,.05,.05];
 const result=rankSessionWindows({...base,nearshoreRows:nearshoreRows.map((r,i)=>({...r,waveM:waves[i]}))});
 assert.equal(result.best.start,at+3*3600);
 assert.equal(result.best.score,result.best.hourlyScoreRange.min);
});
test('requires full future daylight hours, including completion before sunset',()=>{
 const result=rankSessionWindows({...base,now:at+1,daily:{sunrise:[at+1800],sunset:[at+4.5*3600]}});
 assert.deepEqual(result.candidates.map(r=>r.start),[at+3600,at+2*3600]);
 assert.ok(result.candidates.every(r=>r.end<=at+4.5*3600));
 assert.equal(rankSessionWindows({...base,daily:null}).status,'unavailable');
});
test('no interpolation across missing forecast hours or accidental missing-gust high score',()=>{
 const gap=rankSessionWindows({...base,rows:[rows[0],rows[2]]});
 assert.equal(gap.status,'unavailable');
 const noGust=rankSessionWindows({...base,rows:rows.map(r=>({...r,gust:null}))});
 assert.equal(noGust.status,'wind-only');assert.equal(noGust.best.score,null);
 const noDirection=rankSessionWindows({...base,rows:rows.map(r=>({...r,wind:2,windDir:null}))});
 assert.equal(noDirection.status,'wind-only');assert.equal(noDirection.best.score,null);
});
test('beyond nearshore horizon or stale nearshore falls back explicitly to wind only',()=>{
 for(const overrides of [{nearshoreRows:[]},{nearshoreFresh:false}]){
  const result=rankSessionWindows({...base,...overrides});
  assert.equal(result.status,'wind-only');assert.equal(result.best.label,'Lightest wind window');
  assert.equal(result.best.hourlyScoreRange,null);assert.equal(result.best.waveRangeM,null);
 }
 assert.equal(rankSessionWindows({...base,weatherFresh:false}).status,'unavailable');
});
test('tides explain the session but never increase its quality score',()=>{
 const tides=[{t:at-3600,height:1,type:'L'},{t:at+3600,height:5,type:'H'},{t:at+3*3600,height:1,type:'L'}];
 const result=rankSessionWindows({...base,tides});
 assert.equal(result.best.tide.trend,'rising then falling');
 assert.equal(result.best.score,rankSessionWindows(base).best.score);
 assert.match(result.best.explanation,/tide rising then falling/);
 assert.equal(rankSessionWindows(base).best.tide,null);
});
test('duplicate weather timestamps and unmatched model times cannot manufacture a session',()=>{
 assert.equal(rankSessionWindows({...base,rows:[rows[0],rows[0],rows[1]]}).status,'unavailable');
 const result=rankSessionWindows({...base,nearshoreRows:nearshoreRows.map(r=>({...r,t:r.t+1800}))});
 assert.equal(result.status,'wind-only');
});

test('inconsistent or missing gusts remain unknown in wind-only session facts',()=>{
 for(const gust of [11,null]){
  const result=rankSessionWindows({...base,rows:rows.map(r=>({...r,wind:13,gust}))});
  assert.equal(result.status,'wind-only');
  assert.equal(result.best.maxGust,null);
  assert.equal(result.best.score,null);
 }
 const rounding=rankSessionWindows({...base,rows:rows.map(r=>({...r,wind:13,gust:12}))});
 assert.equal(rounding.best.maxGust,12);
 assert.equal(rounding.status,'rated');
});
