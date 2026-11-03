// Deterministic formula diagnostics. No beach observations, fitting or network calls.
import {readFileSync} from 'node:fs';
import {evaluateOutlook as v2} from '../research/models/folly-index-v2.js';
import {evaluateOutlook as v3} from '../research/models/folly-index-v3.js';
import {evaluateOutlook as v4} from '../web/outlook.js';
const saved=JSON.parse(readFileSync(new URL('../research/models/sunday-forecast.json',import.meta.url),'utf8'));
const ideal={nearshore:{waveM:1.2,peakPeriodS:8},wind:0,windDir:315,gust:0,sourceFresh:true};
const scenarios=[
 {name:'Pier rounded inputs, Oct 21',input:{nearshore:{waveM:3.1*.3048,peakPeriodS:10.9},wind:10,windDir:17,gust:13,sourceFresh:true}},
 ...saved.hours.map((hour,i)=>({name:`Captured Sunday ${8+i} AM ET`,input:{...hour,sourceFresh:true}})),
 ...[3,6,7,8,10,13,16].map(period=>({name:`Synthetic calm, ${period}s`,input:{...ideal,nearshore:{waveM:1.2,peakPeriodS:period}}})),
 {name:'Synthetic 0.5m, 8s, calm',input:{...ideal,nearshore:{waveM:.5,peakPeriodS:8}}},
 {name:'Synthetic onshore 15 mph',input:{...ideal,wind:15,windDir:135,gust:15}},
 {name:'Synthetic offshore 5, gust 30',input:{...ideal,wind:5,gust:30}},
 {name:'Synthetic offshore 5, gust 40',input:{...ideal,wind:5,gust:40}},
];
console.log('Formula comparison only; no observed surf quality or demonstrated accuracy improvement.');
console.table(scenarios.map(({name,input})=>{
 const old=v2(input),revised=v3(input),compromise=v4(input);
 const a=Object.fromEntries(old.components.map(c=>[c.id,c.value])),b=Object.fromEntries(revised.components.map(c=>[c.id,c.value]));
 const periodOnly=Math.round(Math.min(100*a.size*b.period*a.wind*a.gust,old.gustCeiling));
 const windOnly=Math.round(100*a.size*a.period*b.wind);
 return {scenario:name,v2:old.score,periodOnly,windOnly,v3:revised.score,v4:compromise.score,reason:compromise.reason};
}));
console.log('Captured Sunday v4 factors:');
console.table(saved.hours.map((h,i)=>{const r=v4({...h,sourceFresh:true});return {hourET:8+i,...Object.fromEntries(r.components.map(c=>[c.id,Number(c.value.toFixed(4))])),score:r.score};}));
// Translate alternate gust weights through the same single wind response, holding every
// other assumption fixed. These alternatives are NOT uncertainty intervals.
console.log('Sunday 8 AM gust-weight sensitivity; hypothetical coefficients, not probabilities:');
console.table([.5,.6,.7,.8,.9,1].map(weight=>{
 const h=saved.hours[0];
 const equivalentInput={...h,gust:h.gust*weight/.7,sourceFresh:true};
 return {gustWeight:weight,score:v4(equivalentInput).score};
}));
