import {currentHour,finite} from './data.js';
import {evaluateOutlook,sourceUsable} from './outlook.js';

const AREAS=[['pier','Pier'],['washout','Washout'],['west','West Folly']];

// Use the same current hour, freshness rules and integer score as the main index.
export function evaluateNearshoreAreas(sources,rows,at,checkedAt=at){
 const weatherReady=sourceUsable(sources.weather,checkedAt,6*3600);
 const nearshoreReady=sourceUsable(sources.nwps,checkedAt,18*3600);
 const weather=currentHour(rows,at);
 const areas=AREAS.map(([id,label])=>{
  const point=nearshoreReady?sources.nwps.data.points?.find(point=>point.id===id):null;
  const nearshore=currentHour(point?.rows??[],at);
  const outlook=evaluateOutlook({nearshore,wind:weatherReady?weather?.wind:null,windDir:weatherReady?weather?.windDir:null,gust:weatherReady?weather?.gust:null,sourceFresh:weatherReady&&!!nearshore});
  return {id,label,outlook};
 });
 const available=areas.filter(area=>finite(area.outlook.score));
 const highest=Math.max(...available.map(area=>area.outlook.score));
 const leaders=available.filter(area=>area.outlook.score===highest);
 return areas.map(area=>({...area,
  // A single available spot cannot establish a comparative winner.
  best:available.length>=2&&leaders.includes(area),
  tied:leaders.length>1,
  incomplete:available.length<areas.length,
 }));
}

export function renderNearshoreLeaders(container,areas,{future=false}={}){
 for(const area of areas){
  const button=container.querySelector(`[data-nearshore-area="${area.id}"]`);
  if(!button)continue;
  let badge=button.querySelector('.nearshore-best');
  if(!badge){
   badge=button.ownerDocument.createElement('span');
   badge.className='nearshore-best';
   badge.setAttribute('aria-hidden','true');
   button.append(badge);
  }
  badge.textContent=area.tied?'TIED BEST':future?'BEST':'BEST NOW';
  badge.hidden=!area.best;
  const score=finite(area.outlook.score)?`Folly Index ${area.outlook.score} out of 100`:'Folly Index unavailable';
  const best=area.best?`, ${area.tied?'tied for highest':'highest'} ${future?'forecast':'current'} score${area.incomplete?' among available spots':''}`:'';
  button.setAttribute('aria-label',`${area.label}, ${score}${best}`);
  button.title=`${area.label}: ${score}${best}`;
 }
}
