import test from 'node:test';
import assert from 'node:assert/strict';
import {quickForecastDays,forecastTarget} from '../web/forecast-day.js';
import {dayKey} from '../web/data.js';
const epoch=date=>Date.parse(date)/1000;
test('quick days use Eastern calendar boundaries through DST and year changes',()=>{
 for(const [date,today,tomorrow] of [
  ['2026-10-25T02:52:00Z','2026-10-24','2026-10-25'],
  ['2026-03-08T05:30:00Z','2026-03-08','2026-03-09'],
  ['2026-11-02T04:30:00Z','2026-11-01','2026-11-02'],
  ['2027-01-01T04:30:00Z','2026-12-31','2027-01-01'],
 ])assert.deepEqual(quickForecastDays(epoch(date)),{today,tomorrow});
});
test('today stays current, future days use their own best daylight window and never another day',()=>{
 const at=epoch('2026-10-25T02:52:00Z'),night=epoch('2026-10-25T04:00:00Z'),morning=epoch('2026-10-25T12:00:00Z'),best=epoch('2026-10-25T15:00:00Z');
 const rows=[{t:night,day:'2026-10-25',isDay:0},{t:morning,day:'2026-10-25',isDay:1}];
 assert.equal(forecastTarget('2026-10-24',at,rows,best),at);
 assert.equal(forecastTarget('2026-10-25',at,rows,best),best);
 assert.equal(forecastTarget('2026-10-25',at,rows,null),morning);
 assert.equal(forecastTarget('2026-10-25',at,rows,at),morning);
 assert.equal(dayKey(forecastTarget('2026-10-26',at,rows,null)),'2026-10-26');
});
