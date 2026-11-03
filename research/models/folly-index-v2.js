// Folly Index v2: an original, unvalidated model-setup heuristic, not a safety score.
export const FORMULA_VERSION=2;
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
 const periodFactor=clamp((period-3)/10);
 // Known directions retain a continuous response through 3 mph; zero wind is direction independent.
 // Unknown light-wind direction produces a range across all possible alignments.
 const directionKnown=valid(windDir)||wind===0;
 const onshore=valid(windDir)?(1-Math.cos(angle(windDir,315)*Math.PI/180))/2:1;
 const windSurface=o=>clamp(1-wind*(0.012+0.040*o)-Math.max(0,wind-12)*0.025);
 const surface=windSurface(onshore);
 const bestSurface=directionKnown?surface:windSurface(0);
 const worstSurface=directionKnown?surface:windSurface(1);
 // Allow 1 mph rounding tolerance between wind and gust products.
 const gustKnown=nonnegative(gust)&&gust+1>=wind;
 const steadiness=gustKnown?clamp(1-Math.max(0,gust-wind)/20-Math.max(0,gust-20)/35):null;
 const gustCeiling=gustKnown?(gust<=20?1:gust<=30?1-(gust-20)*.061:clamp(.39*(45-gust)/15)):null;
 const gustFactor=gustKnown ? .7+.3*steadiness : null;
 const components=[
  {id:'size',label:'Wave potential',value:size,available:true},
  {id:'period',label:'Peak period',value:periodFactor,available:true},
  {id:'wind',label:'Wind alignment',value:directionKnown?surface:null,available:directionKnown},
  {id:'gust',label:'Gust steadiness',value:gustFactor,available:gustKnown},
 ];
 const missing=[!directionKnown?'Wind direction':null,!gustKnown?'Gusts':null].filter(Boolean);
 const confidence=missing.length?missing.join(' and ')+' unavailable':'Model outlook';
 const coverage=components.filter(c=>c.available).length/components.length;
 // Unknown inputs span all possible alignments and gust effects. This is a possibility
 // range, not a confidence interval, and never becomes a numeric rating or band.
 if(missing.length){
  const potential=100*size*periodFactor;
  const scoreRange=gustKnown?{
   min:Math.round(Math.min(potential*worstSurface*gustFactor,100*gustCeiling)),
   max:Math.round(Math.min(potential*bestSurface*gustFactor,100*gustCeiling)),
  }:{min:0,max:Math.round(potential*bestSurface)};
  return {version:FORMULA_VERSION,score:null,scoreRange,label:'Partial forecast',level:0,confidence,coverage,components,basis:'nearshore',
   reason:!gustKnown&&nonnegative(gust)?'Wind readings disagree; no single score is available.':'Some wind data is missing; showing a score range.'};
 }
 // Every component is a multiplier: calm wind cannot manufacture wave potential.
 const modelScore=100*size*periodFactor*surface*gustFactor;
 const ceiling=100*gustCeiling;
 const score=Math.round(Math.min(modelScore,ceiling));
 const level=Math.min(5,Math.floor(score/20)+1);
 const limiting=components.reduce((lowest,c)=>c.value<lowest.value?c:lowest);
 let reason;
 if(h<.3)reason='Very small waves expected.';
 else if(ceiling<modelScore)reason='Strong wind gusts expected.';
 else if(score>=80)reason='Well-spaced waves with favourable winds.';
 else if(limiting.id==='size')reason=h>1.8?'Very large waves expected.':h>=.6&&surface>=.8&&gustFactor>=.8?'Small waves with favourable winds.':'Small waves expected.';
 else if(limiting.id==='period')reason=`Waves about ${Math.round(period*10)/10} seconds apart.`;
 else if(limiting.id==='gust')reason='Gusty winds may roughen the water.';
 else if(onshore>.75)reason=wind<5?'Light onshore winds.':'Onshore winds; likely choppy.';
 else if(onshore<.25)reason='Strong offshore winds.';
 else reason='Cross-shore winds; likely choppy.';
 return {version:FORMULA_VERSION,score,modelScore,gustCeiling:ceiling,label:BANDS[level-1],level,confidence,coverage,components,basis:'nearshore',reason};
}
export function sourceUsable(source,at,maxAge){
 if(!source?.data||!['fresh','cached'].includes(source.status))return false;
 const t=source.issuedAt??source.retrievedAt;
 return Number.isFinite(t)&&at-t>=-3600&&at-t<=maxAge;
}
