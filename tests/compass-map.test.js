import test from 'node:test';
import assert from 'node:assert/strict';
import {mercatorWorld,mapTileLayout,FOLLY_MAP_AREAS,renderCompass} from '../web/compass.js';

test('Web Mercator aligns equator, cardinal axes, and tile zoom',()=>{
 assert.deepEqual(mercatorWorld(0,0,0),{x:128,y:128});
 const center=mercatorWorld(32.65,-79.94);
 assert.ok(mercatorWorld(32.66,-79.94).y<center.y);
 assert.ok(mercatorWorld(32.65,-79.93).x>center.x);
 assert.equal(mercatorWorld(32.65,-79.94,15).x,center.x*2);
 assert.throws(()=>mercatorWorld(NaN,0));
 assert.throws(()=>mercatorWorld(90,0));
});
test('Only visible tiles cover each selected point with exact centered alignment',()=>{
 for(const area of Object.values(FOLLY_MAP_AREAS)){
  const {center,tiles,width,height}=mapTileLayout(area.latitude,area.longitude);
  assert.ok(tiles.length>=2&&tiles.length<=9);
  for(const t of tiles){
   assert.ok(t.left<width&&t.top<height&&t.left+256>0&&t.top+256>0);
   assert.ok(Math.abs(t.x*256-t.left-(center.x-width/2))<1e-8);
   assert.ok(Math.abs(t.y*256-t.top-(center.y-height/2))<1e-8);
  }
  const covers=(x,y)=>tiles.some(t=>t.left<=x&&t.left+256>x&&t.top<=y&&t.top+256>y);
  for(const x of [0,160,319.99])for(const y of [0,105,209.99])assert.ok(covers(x,y));
 }
});
test('Map changes by area while wind and swell preserve incoming directions',()=>{
 const options={wind:10,windDir:0,gust:15,swellComponents:{primary:{heightM:1,periodS:10,directionFromDeg:90}}};
 const pier=renderCompass({...options,area:'pier'}),washout=renderCompass({...options,area:'washout'});
 assert.notEqual(pier.match(/src="[^"]+/g).join(),washout.match(/src="[^"]+/g).join());
 assert.match(pier,/M160.00,37.00 L160.00,74.00/); // north wind travels south
 assert.match(pier,/M213.00,105.00 L183.00,105.00/); // east swell travels west
 assert.match(pier,/openstreetmap.org\/copyright/);
 assert.match(pier,/referrerpolicy="strict-origin-when-cross-origin"/);
 assert.match(pier,/loading="lazy"/);
 assert.doesNotMatch(renderCompass({}),/NaN|undefined/);
 assert.doesNotMatch(pier,/fc-land|fc-shore/);
});
test('Distinct and nearly aligned primary/secondary arrows preserve provider bearings',()=>{
 for(const [primary,secondary] of [[79,76],[78,116],[90,90],[359,1]]){
  const html=renderCompass({swellComponents:{primary:{heightM:.88,periodS:5.8,directionFromDeg:primary},secondary:{heightM:.24,periodS:8.15,directionFromDeg:secondary}}});
  assert.match(html,new RegExp(`fc-vector-swell" data-from="${primary}"`));
  assert.match(html,new RegExp(`fc-vector-secondary" data-from="${secondary}"`));
  const groups=[...html.matchAll(/<g class="fc-vector [^"]+"[^>]*><path d="M([\d.,]+) L([\d.,]+)"/g)];
  assert.equal(groups.length,2);
  groups.forEach((g,i)=>{const a=g[1].split(',').map(Number),b=g[2].split(',').map(Number),from=[primary,secondary][i]*Math.PI/180;
   // Shaft points toward travel direction (opposite FROM), even with the parallel offset.
   const dx=b[0]-a[0],dy=b[1]-a[1];
   assert.ok(Math.abs(dx*Math.cos(from)+dy*Math.sin(from))<.02);
   assert.ok(dx*Math.sin(from)-dy*Math.cos(from)<0);
  });
  if(primary===secondary)assert.notEqual(groups[0][1],groups[1][1]);
  assert.match(html,/Primary swell/);assert.match(html,/Secondary swell/);assert.match(html,/Offshore swell forecast/);
 }
});
test('Unknown or zero secondary components never become an arrow',()=>{
 for(const secondary of [null,{heightM:0,periodS:8,directionFromDeg:90},{heightM:.2,periodS:null,directionFromDeg:90},{heightM:.2,periodS:8,directionFromDeg:null}]){
  assert.doesNotMatch(renderCompass({swellComponents:{secondary}}),/class="fc-vector fc-vector-secondary"/);
 }
 assert.match(renderCompass({swellComponents:{secondary:{heightM:0,periodS:8,directionFromDeg:90}}}),/None reported/);
 assert.match(renderCompass({}),/Unavailable/);
 const html=renderCompass({units:'metric',swellComponents:{secondary:{heightM:.24,periodS:8.15,directionFromDeg:76}}});
 assert.match(html,/0.2 m · 8.2 s/);assert.doesNotMatch(html,/peak/i);
});
