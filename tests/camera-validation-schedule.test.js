import test from 'node:test';
import assert from 'node:assert/strict';
import {dueValidationWindow} from '../camera-service/validation-schedule.mjs';
import {readFileSync} from 'node:fs';
const plan=[{id:'validation-20261023-1005',start:'2026-10-23T14:05:00Z',end:'2026-10-23T14:20:00Z'},
 {id:'validation-20261025-1405',start:'2026-10-25T18:05:00Z',end:'2026-10-25T18:20:00Z'}];
const config=p=>({PILOT_VALIDATION_PLAN:JSON.stringify(p),PILOT_CAPTURE_ONLY:'true',PILOT_CAMERA:'tides-pier',PILOT_SAMPLING_MODE:'stationary'});
test('finite plan dispatches only within explicit windows and stops after final expiry',()=>{
 const env=config(plan);assert.equal(dueValidationWindow(env,Date.parse('2026-10-22T18:10:00Z')),null);
 assert.equal(dueValidationWindow(env,Date.parse(plan[0].start)).id,plan[0].id);
 assert.equal(dueValidationWindow(env,Date.parse('2026-10-23T14:10:00Z')).id,plan[0].id);
 assert.equal(dueValidationWindow(env,Date.parse(plan[0].end)),null);
 assert.equal(dueValidationWindow(env,Date.parse(plan[1].end)),null);
 assert.equal(dueValidationWindow(env,Date.parse('2030-10-23T14:10:00Z')),null);
});
test('finite plans reject analysis, broad schedules, overlap, invalid IDs and nighttime',()=>{
 for(const p of [[...plan,...plan],Array.from({length:7},()=>plan[0]),[{...plan[0],end:'2026-10-23T15:20:00Z'}],
   [{...plan[0],id:'../escape'}],[{...plan[0],start:'2026-10-23T02:00:00Z',end:'2026-10-23T02:10:00Z'}],
   [plan[0],{...plan[1],start:'2026-11-25T18:05:00Z',end:'2026-11-25T18:20:00Z'}]]) assert.throws(()=>dueValidationWindow(config(p)));
 for(const patch of [{PILOT_CAPTURE_ONLY:'false'},{PILOT_SURFACE_REVIEW_FROM:'pilot-previous'},{PILOT_CAMERA:'washout'}])
   assert.throws(()=>dueValidationWindow({...config(plan),...patch}));
});
test('worker dispatches only due validation identities and never falls back to the normal pilot',async()=>{
 const code=readFileSync(new URL('../camera-service/worker.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export class CameraCapture','class CameraCapture').replace('export default','const handler=');
 let due=null,dispatches=[];
 const handler=Function('DurableObject','dueValidationWindow','return (()=>{'+code+';return handler;})()')(class{},()=>due);
 const env={...config(plan),PILOT_ENABLED:'true',CAPTURE:{getByName:name=>({run:async(cam,id)=>dispatches.push([name,cam,id])})}};
 await handler.scheduled({},env);assert.equal(dispatches.length,0);
 due=plan[0];await handler.scheduled({},env);assert.deepEqual(dispatches,[['tides-pier','tides-pier',plan[0].id]]);
 await handler.scheduled({},{...env,PILOT_ENABLED:'false'});assert.equal(dispatches.length,1);
});
