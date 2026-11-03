import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,joinHours,tideHeight,parseTides,windType,currentHour} from '../web/data.js';
test('Folly dates respect Eastern time and daylight saving changes',()=>{
 assert.equal(dayKey(Date.parse('2026-10-21T02:00:00Z')/1000),'2026-10-20');
 assert.equal(dayKey(Date.parse('2026-11-01T05:30:00Z')/1000),'2026-11-01');
 assert.equal(dayKey(Date.parse('2026-11-01T06:30:00Z')/1000),'2026-11-01');
});
test('unmatched feed hours stay missing; null waves never become zero',()=>{
 const rows=joinHours({hourly:{time:[1792512000,1792515600],wave_height:[null,0]}},{hourly:{time:[1792515600],wind_speed_10m:[12]}});
 assert.equal(rows[0].wave,null);assert.equal(rows[0].wind,null);assert.equal(rows[1].wave,0);assert.equal(rows[1].wind,12);
 assert.equal(currentHour(rows,1792600000),null);
});
test('NOAA timestamps parse as UTC and curve never extrapolates outside predictions',()=>{
 const events=parseTides({predictions:[{t:'2026-10-20 12:00',v:'1',type:'L'},{t:'2026-10-20 18:00',v:'5',type:'H'}]});
 assert.equal(events[0].t,Date.parse('2026-10-20T12:00:00Z')/1000);
 assert.equal(tideHeight(events,events[0].t-1),null);assert.equal(tideHeight(events,events[1].t+1),null);
 assert.equal(tideHeight(events,events[0].t),1);assert.ok(Math.abs(tideHeight(events,(events[0].t+events[1].t)/2)-3)<1e-9);
});
test('wind labels use source direction and handle missing values',()=>{
 assert.equal(windType(10,315),'Offshore');assert.equal(windType(10,135),'Onshore');assert.equal(windType(10,45),'Cross-shore');assert.equal(windType(0,135),'Light winds');assert.equal(windType(null,315),'Wind unavailable');
});

