export const TZ = 'America/New_York';
export const finite = n => typeof n === 'number' && Number.isFinite(n);
export const dayKey = t => new Intl.DateTimeFormat('en-CA', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000));
export const fmt = (t,opts) => new Intl.DateTimeFormat('en-US',{timeZone:TZ,...opts}).format(new Date(t*1000));
export const timeLabel = t => fmt(t,{hour:'numeric',minute:'2-digit'}).replace(':00','');
export const direction = d => finite(d) ? ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(((d%360)+360)%360/22.5)%16] : '—';
export function windType(speed,dir){
  if(!finite(speed)) return 'Wind unavailable';
  if(speed<5) return 'Light winds';
  if(!finite(dir)) return 'Direction unavailable';
  const delta=Math.abs((((dir-315)%360)+540)%360-180);
  return delta<=45?'Offshore':delta>=135?'Onshore':'Cross-shore';
}
export function joinHours(marine,weather){
  const marineHours=marine?.hourly,weatherHours=weather?.hourly;
  const mt=new Map((marineHours?.time??[]).map((t,i)=>[t,i]));
  const wt=new Map((weatherHours?.time??[]).map((t,i)=>[t,i]));
  const val=(obj,key,i)=>i!==undefined&&finite(obj?.[key]?.[i])?obj[key][i]:null;
  return [...new Set([...mt.keys(),...wt.keys()])].sort((a,b)=>a-b).map(t=>({
    t,day:dayKey(t),wave:val(marineHours,'wave_height',mt.get(t)),period:val(marineHours,'wave_period',mt.get(t)),waveDir:val(marineHours,'wave_direction',mt.get(t)),
    swell:val(marineHours,'swell_wave_height',mt.get(t)),swellPeriod:val(marineHours,'swell_wave_period',mt.get(t)),swellDir:val(marineHours,'swell_wave_direction',mt.get(t)),
    wind:val(weatherHours,'wind_speed_10m',wt.get(t)),windDir:val(weatherHours,'wind_direction_10m',wt.get(t)),gust:val(weatherHours,'wind_gusts_10m',wt.get(t)),
    temp:val(weatherHours,'temperature_2m',wt.get(t)),rain:val(weatherHours,'precipitation_probability',wt.get(t)),code:val(weatherHours,'weather_code',wt.get(t)),isDay:val(weatherHours,'is_day',wt.get(t))
  }));
}
export function parseTides(data){return (data?.predictions??[]).map(p=>({t:Date.parse(p.t.replace(' ','T')+'Z')/1000,height:p.v===null||p.v===''?null:Number(p.v),type:p.type})).filter(p=>finite(p.t)&&finite(p.height)&&['H','L'].includes(p.type)).sort((a,b)=>a.t-b.t);}
export function tideHeight(events,t){
  const i=events.findIndex(e=>e.t>=t);
  if(i<0)return null;
  if(events[i].t===t)return events[i].height;
  if(i===0)return null;
  const a=events[i-1],b=events[i],f=(t-a.t)/(b.t-a.t);
  return a.height+(b.height-a.height)*(1-Math.cos(f*Math.PI))/2;
}
export function currentHour(rows,now){return rows.find(r=>r.t<=now&&r.t+3600>now)??null;}
export function weatherLabel(code){
  if(!finite(code))return 'Weather unavailable';
  if(code===0)return 'Clear skies';if(code<=3)return ['','Mostly clear','Partly cloudy','Overcast'][code];
  if(code<=48)return 'Fog';if(code<=57)return 'Drizzle';if(code<=67)return 'Rain';if(code<=77)return 'Snow';if(code<=86)return 'Showers';return 'Thunderstorms';
}

// Resolve calendar boundaries in Eastern time, including 23/25-hour DST days.
export function easternDayBounds(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const date=Date.parse(day+'T00:00:00Z')/1000;
 if(!finite(date)||new Date(date*1000).toISOString().slice(0,10)!==day)return null;
 const midnight=key=>{
  const guess=Date.parse(key+'T00:00:00Z')/1000;
  let low=guess-12*3600,high=guess+36*3600;
  while(high-low>1){const mid=Math.floor((low+high)/2);if(dayKey(mid)<key)low=mid;else high=mid;}
  return high;
 };
 const next=new Date((date+86400)*1000).toISOString().slice(0,10);
 return {start:midnight(day),end:midnight(next)};
}
export function easternMidnights(start,end){
 if(!finite(start)||!finite(end)||end<start)return [];
 const result=[];let bounds=easternDayBounds(dayKey(start));
 while(bounds&&bounds.start<=end){
  if(bounds.start>=start)result.push(bounds.start);
  bounds=easternDayBounds(dayKey(bounds.end));
 }
 return result;
}
