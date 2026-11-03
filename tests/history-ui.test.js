import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historySelection,waveChange} from '../web/history-ui.js';
test('history picks oldest comparable retrieval in period and excludes hindsight or missing heights',()=>{
 const saved=(id,retrievedAt,recordedAt= retrievedAt,height=1)=>({id,retrievedAt,recordedAt,comparison:{forecastAt:500,values:{wave_height:height}}});
 const rows=[saved('late',300),saved('early',200),saved('outside',50),saved('hindsight',510),saved('recorded-late',250,510),saved('missing',220,220,null),{...saved('wrong-hour',230),comparison:{forecastAt:400,values:{wave_height:1}}}];
 assert.deepEqual(historySelection(rows,500,100,400).map(r=>r.id),['early','late']);
});
test('wave revision copy preserves missingness and converts actual differences',()=>{
 assert.equal(waveChange(null,1),null);assert.equal(waveChange(1,1),'Wave height is unchanged');
 assert.equal(waveChange(1,1.2),'Waves are forecast 0.7 ft higher');assert.equal(waveChange(1,.8,true),'Waves are forecast 0.2 m lower');
});
