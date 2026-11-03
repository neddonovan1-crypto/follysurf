import {evaluateOutlook} from './outlook.js';
import {dayKey,finite,tideHeight,windType} from './data.js';

const sessionRange=values=>({min:Math.min(...values),max:Math.max(...values)});
function uniqueSessionRows(rows){
 const counts=new Map();
 for(const row of rows??[])if(finite(row?.t))counts.set(row.t,(counts.get(row.t)??0)+1);
 return (rows??[]).filter(row=>finite(row?.t)&&counts.get(row.t)===1).sort((a,b)=>a.t-b.t);
}
function sessionTide(events,start,end){
 const clean=(events??[]).filter(e=>finite(e?.t)&&finite(e?.height)).sort((a,b)=>a.t-b.t);
 const startFt=tideHeight(clean,start),endFt=tideHeight(clean,end);
 if(!finite(startFt)||!finite(endFt))return null;
 const turn=clean.find(e=>e.t>start&&e.t<end&&['H','L'].includes(e.type));
 const trend=turn?(turn.type==='H'?'rising then falling':'falling then rising'):Math.abs(endFt-startFt)<.05?'nearly level':endFt>startFt?'rising':'falling';
 return {startFt,endFt,trend,turnAt:turn?.t??null,turnType:turn?.type??null};
}
function sessionFacts(rows,tides){
 const start=rows[0].t,end=rows.at(-1).t+3600;
 const descriptions=rows.map(row=>windType(row.wind,row.windDir));
 const windDescription=descriptions.every(label=>label===descriptions[0])?descriptions[0].toLowerCase():'changing winds';
 const tide=sessionTide(tides,start,end);
 return {start,end,rows,avgWind:rows.reduce((sum,row)=>sum+row.wind,0)/rows.length,
  maxGust:rows.every(row=>finite(row.gust)&&row.gust>=0&&row.gust+1>=row.wind)?Math.max(...rows.map(row=>row.gust)):null,
  windDescription,tide,explanation:`${windDescription.charAt(0).toUpperCase()+windDescription.slice(1)}${tide?' · tide '+tide.trend:''}.`};
}
/**
 * Two complete future daylight hours, ranked by the weaker hourly Folly Index.
 * Average index breaks ties, followed by earlier start. This favours a consistent
 * window without allowing one strong hour to cancel a poor one. Tide is context,
 * never an unsupported quality bonus. Native units: wind mph; waves metres.
 * A wind-only fallback is explicitly unrated when nearshore inputs are absent.
 */
export function rankSessionWindows({rows=[],nearshoreRows=[],daily,now,day,weatherFresh=false,nearshoreFresh=false,tides=[]}={}){
 const unavailable=reason=>({status:'unavailable',best:null,candidates:[],eligibleWindows:0,ratedWindows:0,reason});
 if(!finite(now)||weatherFresh!==true)return unavailable('Current wind guidance is unavailable.');
 const selectedDay=day??dayKey(now);
 const rises=(daily?.sunrise??[]).filter(t=>finite(t)&&dayKey(t)===selectedDay);
 const sets=(daily?.sunset??[]).filter(t=>finite(t)&&dayKey(t)===selectedDay);
 if(rises.length!==1||sets.length!==1||sets[0]<=rises[0])return unavailable('Daylight times are unavailable for this day.');
 const sunrise=rises[0],sunset=sets[0];
 const hours=uniqueSessionRows(rows).filter(row=>row.t>=now&&dayKey(row.t)===selectedDay);
 const nearshore=new Map(uniqueSessionRows(nearshoreRows).map(row=>[row.t,row]));
 const eligible=[],rated=[];
 for(let i=0;i<hours.length-1;i++){
  const pair=hours.slice(i,i+2),[a,b]=pair;
  if(b.t-a.t!==3600||a.t<sunrise||b.t+3600>sunset||pair.some(row=>row.isDay!==1||!finite(row.wind)||row.wind<0))continue;
  const facts=sessionFacts(pair,tides);
  eligible.push({...facts,score:null,averageScore:null,hourlyScoreRange:null,label:'Lightest wind window',level:0,waveRangeM:null,periodRangeS:null});
  if(nearshoreFresh!==true)continue;
  const forecasts=pair.map(row=>nearshore.get(row.t));
  const outlooks=pair.map((row,j)=>evaluateOutlook({nearshore:forecasts[j],wind:row.wind,windDir:row.windDir,gust:row.gust,sourceFresh:true}));
  if(outlooks.some(outlook=>!finite(outlook.score)))continue;
  const limiting=outlooks.reduce((lowest,outlook)=>outlook.score<lowest.score?outlook:lowest);
  rated.push({...facts,score:limiting.score,label:limiting.label,level:limiting.level,outlookReason:limiting.reason,
   averageScore:outlooks.reduce((sum,outlook)=>sum+outlook.score,0)/outlooks.length,
   hourlyScoreRange:sessionRange(outlooks.map(outlook=>outlook.score)),
   waveRangeM:sessionRange(forecasts.map(row=>row.waveM)),periodRangeS:sessionRange(forecasts.map(row=>row.peakPeriodS)),
   hourlyOutlooks:outlooks});
 }
 if(rated.length){
  rated.sort((a,b)=>b.score-a.score||b.averageScore-a.averageScore||a.start-b.start);
  return {status:'rated',best:rated[0],candidates:rated,eligibleWindows:eligible.length,ratedWindows:rated.length,
   reason:rated.length<eligible.length?'Best among windows with complete wave and wind forecasts.':'Most consistent two-hour outlook for this day.'};
 }
 if(eligible.length){
  eligible.sort((a,b)=>a.avgWind-b.avgWind||a.start-b.start);
  return {status:'wind-only',best:eligible[0],candidates:eligible,eligibleWindows:eligible.length,ratedWindows:0,
   reason:'Lightest wind only; a complete nearshore rating is unavailable.'};
 }
 return unavailable('No complete two-hour daylight window remains.');
}
