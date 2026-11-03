import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNearshoreAreas} from '../web/nearshore-areas.js';
const at=1800000000;
function fixture(heights=[.5,1.2,.8]){
 return {sources:{weather:{status:'fresh',issuedAt:at,data:{}},nwps:{status:'fresh',issuedAt:at,data:{points:['pier','washout','west'].map((id,i)=>({id,rows:[{t:at,waveM:heights[i],peakPeriodS:10}]}))}}},rows:[{t:at,wind:4,windDir:315,gust:6}]};
}
function rank(f){return evaluateNearshoreAreas(f.sources,f.rows,at);}
const leaders=f=>rank(f).filter(a=>a.best).map(a=>a.id);
test('leader follows computed index and changes with forecast',()=>{
 assert.deepEqual(leaders(fixture()),['washout']);
 assert.deepEqual(leaders(fixture([1.2,.5,.8])),['pier']);
});
test('two-way and three-way ties mark all leaders, including zero',()=>{
 assert.deepEqual(leaders(fixture([1.2,1.2,.8])),['pier','washout']);
 const all=rank(fixture([0,0,0]));
 assert.ok(all.every(a=>a.best&&a.tied&&a.outlook.score===0));
});
test('missing scores are excluded and comparison needs two available spots',()=>{
 const f=fixture([null,1.2,.8]);
 assert.deepEqual(leaders(f),['washout']);
 assert.ok(rank(f).find(a=>a.best).incomplete);
 assert.deepEqual(leaders(fixture([null,1.2,null])),[]);
 assert.deepEqual(leaders(fixture([null,null,null])),[]);
});
test('stale weather, stale waves, missing current hour and partial scores do not rank',()=>{
 for(const source of ['weather','nwps']){
  const f=fixture();f.sources[source].issuedAt=at-24*3600;
  assert.deepEqual(leaders(f),[]);
 }
 const f=fixture();f.rows[0].gust=null;assert.deepEqual(leaders(f),[]);
 f.rows=[];assert.deepEqual(leaders(f),[]);
 const g=fixture();g.sources.nwps.data.points.forEach(p=>p.rows[0].t=at-3600);
 assert.deepEqual(leaders(g),[]);
});
test('usable cached forecasts retain the same scoring behavior',()=>{
 const f=fixture();f.sources.weather.status='cached';f.sources.nwps.status='cached';
 assert.deepEqual(leaders(f),['washout']);
});
test('tomorrow is scored using forecast-hour inputs and freshness at the actual present time',()=>{
 const f=fixture();
 f.rows[0].t+=86400;f.sources.nwps.data.points.forEach(p=>p.rows[0].t+=86400);
 assert.deepEqual(evaluateNearshoreAreas(f.sources,f.rows,at+86400,at).filter(a=>a.best).map(a=>a.id),['washout']);
 f.sources.weather.issuedAt=at-7*3600;
 assert.ok(evaluateNearshoreAreas(f.sources,f.rows,at+86400,at).every(a=>a.outlook.score===null));
});
