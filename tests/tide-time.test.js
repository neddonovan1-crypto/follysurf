import test from 'node:test';
import assert from 'node:assert/strict';
import {easternDayBounds,easternMidnights} from '../web/data.js';

test('Eastern calendar day boundaries follow daylight-saving transitions',()=>{
 const spring=easternDayBounds('2026-03-08');
 assert.equal(spring.start,Date.parse('2026-03-08T05:00:00Z')/1000);
 assert.equal(spring.end-spring.start,23*3600);
 const fall=easternDayBounds('2026-11-01');
 assert.equal(fall.start,Date.parse('2026-11-01T04:00:00Z')/1000);
 assert.equal(fall.end-fall.start,25*3600);
 assert.equal(easternDayBounds('2026-10-21').end-easternDayBounds('2026-10-21').start,24*3600);
 assert.equal(easternDayBounds('2026-02-30'),null);
});
test('Rolling tide range marks actual local midnights including both edges',()=>{
 const {start,end}=easternDayBounds('2026-11-01');
 assert.deepEqual(easternMidnights(start,end),[start,end]);
 assert.deepEqual(easternMidnights(start+18*3600,end+18*3600),[end]);
 assert.deepEqual(easternMidnights(end,start),[]);
});
