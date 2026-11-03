import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTideSamples,nearestTideSampleIndex,tidePlotPoint} from '../web/tide-inspection.js';
const samples=[{t:100,value:2},{t:200,value:4},{t:300,value:3}];
test('inspection uses real samples, snaps to nearest, and clamps to available ends',()=>{
 assert.equal(nearestTideSampleIndex(samples,99),0);
 assert.equal(nearestTideSampleIndex(samples,999),2);
 assert.equal(nearestTideSampleIndex(samples,151),1);
 assert.equal(nearestTideSampleIndex(samples,150),0);
 assert.equal(nearestTideSampleIndex(samples,200),1);
 assert.equal(nearestTideSampleIndex([],200),-1);
 assert.equal(nearestTideSampleIndex(samples,NaN),-1);
});
test('missing tide values are never converted into zero or interpolated by inspection',()=>{
 assert.deepEqual(prepareTideSamples([{t:300,value:3},{t:200,value:null},{t:100,value:2},{t:400,value:NaN}]),[samples[0],samples[2]]);
 const gap=prepareTideSamples([{t:100,value:2},{t:500,value:4}]);
 assert.deepEqual(gap[nearestTideSampleIndex(gap,350)],{t:500,value:4});
});
test('point coordinates use actual chart domains and padded plot, including negative tides',()=>{
 const plot={left:27,right:528,top:29,bottom:120,width:540,height:145,timeStart:0,timeEnd:400,valueMin:-1,valueMax:5};
 assert.deepEqual(tidePlotPoint({t:0,value:-1},plot),{x:27,y:120});
 assert.deepEqual(tidePlotPoint({t:400,value:5},plot),{x:528,y:29});
 assert.deepEqual(tidePlotPoint({t:200,value:2},plot),{x:277.5,y:74.5});
});
