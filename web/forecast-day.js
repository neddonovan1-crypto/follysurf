import {dayKey,easternDayBounds,finite} from './data.js';

export function quickForecastDays(at){
 const today=dayKey(at);
 return {today,tomorrow:dayKey(easternDayBounds(today).end)};
}

// Today retains the live hour. Future days show the start of their best
// daylight window, or the first daylight hour when a window is unavailable.
export function forecastTarget(day,at,rows,bestStart){
 if(!day||day===dayKey(at))return at;
 if(finite(bestStart)&&dayKey(bestStart)===day)return bestStart;
 const selected=rows.filter(row=>row.day===day);
 return (selected.find(row=>row.isDay===1)??selected[0])?.t??easternDayBounds(day)?.start??at;
}
