// Folly Index v4: provisional ranking preferences, not a validated surf or safety score.
// NWPS already transforms waves nearshore. These factors rank inputs; they do not
// recalculate wave arrival, shoaling or breaking height. See research/NEARSHORE-TO-SURF.md.
export const FORMULA_VERSION=4;
const clamp=n=>Math.max(0,Math.min(1,n));
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const nonnegative=n=>valid(n)&&n>=0;
const angle=(a,b)=>Math.abs(((a-b)%360+540)%360-180);
const BANDS=['Low','Marginal','Fair','Promising','Standout'];
export function evaluateOutlook({nearshore=null,wind,windDir,gust,sourceFresh=false}={}){
 const h=nearshore?.waveM,period=nearshore?.peakPeriodS;
 if(sourceFresh!==true||!nonnegative(h)||!valid(period)||period<=0||!nonnegative(wind)||(wind>=3&&!valid(windDir)))return {
  version:FORMULA_VERSION,score:null,label:'Awaiting conditions',level:0,confidence:'Unavailable',coverage:0,components:[],basis:null,
  reason:'Waiting for wave and wind data.'
 };
 // H is nearshore significant wave height in metres, never breaking-wave faces.
 const size=h<=1.2?clamp(h/1.2):h<=1.8?1:clamp(1-(h-1.8)/3);
 // Provisional 50/50 compromise between v2's linear period preference and
 // v3's seven-second plateau. The blend is a policy choice, not a fitted weight.
 const oldPeriodFactor=clamp((period-3)/10);
 const periodPosition=clamp((period-3)/4);
 const plateauPeriodFactor=periodPosition*periodPosition*(3-2*periodPosition);
 const periodFactor=.5*oldPeriodFactor+.5*plateauPeriodFactor;
 // Gusts enter the wind response once. 0.7 is a provisional ranking weight,
 // not a conversion from gust speed to a measured sustained wind speed.
 const gustKnown=nonnegative(gust)&&gust+1>=wind;
 const effectiveWind=gustKnown?Math.max(wind,.7*gust):null;
 const directionKnown=valid(windDir)||effectiveWind===0;
 const onshore=valid(windDir)?(1-Math.cos(angle(windDir,315)*Math.PI/180))/2:1;
 const windSurface=(v,o)=>clamp(1-v*(0.012+0.040*o)-Math.max(0,v-12)*0.025);
 const surface=gustKnown?windSurface(effectiveWind,onshore):null;
 const bestSurface=windSurface(effectiveWind??wind,directionKnown?onshore:0);
 const worstSurface=gustKnown?windSurface(effectiveWind,directionKnown?onshore:1):0;
 const components=[
  {id:'size',label:'Wave potential',value:size,available:true},
  {id:'period',label:'Peak period',value:periodFactor,available:true},
  {id:'wind',label:'Wind and gusts',value:directionKnown?surface:null,available:directionKnown&&gustKnown},
 ];
 const missing=[!directionKnown?'Wind direction':null,!gustKnown?'Gusts':null].filter(Boolean);
 const confidence=missing.length?missing.join(' and ')+' unavailable':'Model outlook';
 // Coverage counts required input groups, not the number of score multipliers.
 const coverage=(2+Number(directionKnown)+Number(gustKnown))/4;
 // Unknown inputs span all possible alignments and gust effects. This is a possibility
 // range, not a confidence interval, and never becomes a numeric rating or band.
 if(missing.length){
  const potential=100*size*periodFactor;
  const scoreRange=gustKnown?{
   min:Math.round(potential*worstSurface),
   max:Math.round(potential*bestSurface),
  }:{min:0,max:Math.round(potential*bestSurface)};
  return {version:FORMULA_VERSION,score:null,scoreRange,label:'Partial forecast',level:0,confidence,coverage,components,basis:'nearshore',
   reason:!gustKnown&&nonnegative(gust)?'Wind readings disagree; no single score is available.':'Some wind data is missing; showing a score range.'};
 }
 // Every component is a multiplier: calm wind cannot manufacture wave potential.
 const modelScore=100*size*periodFactor*surface;
 const score=Math.round(modelScore);
 const level=Math.min(5,Math.floor(score/20)+1);
 const limiting=components.reduce((lowest,c)=>c.value<lowest.value?c:lowest);
 let reason;
 if(h<.3)reason='Very small waves expected.';
 else if(limiting.id==='wind'&&effectiveWind>wind&&gust>=15)reason=gust>=30?'Strong wind gusts expected.':'Gusty winds may roughen the water.';
 else if(limiting.id==='period')reason=`Peak period about ${Math.round(period*10)/10} seconds.`;
 else if(score>=80)reason='Well-spaced waves with favourable winds.';
 else if(limiting.id==='size')reason=h>1.8?'Very large waves expected.':h>=.6&&surface>=.8?'Small waves with favourable winds.':'Small waves expected.';
 else if(effectiveWind>wind)reason=gust>=30?'Strong wind gusts expected.':'Gusty winds may roughen the water.';
 else if(onshore>.75)reason=wind<5?'Light onshore winds.':'Onshore winds; likely choppy.';
 else if(onshore<.25)reason='Strong offshore winds.';
 else reason='Cross-shore winds; likely choppy.';
 return {version:FORMULA_VERSION,score,modelScore,effectiveWindMph:effectiveWind,periodGuidance:period>11?'beyond-guidance-range-unvalidated':'provisional-period-preference',label:BANDS[level-1],level,confidence,coverage,components,basis:'nearshore',reason};
}
export function sourceUsable(source,at,maxAge){
 if(!source?.data||!['fresh','cached'].includes(source.status))return false;
 const t=source.issuedAt??source.retrievedAt;
 return Number.isFinite(t)&&at-t>=-3600&&at-t<=maxAge;
}
