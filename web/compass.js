// Direction values use the meteorological convention: where wind/waves come FROM.
const compassNumber = value => typeof value === 'number' && Number.isFinite(value);
// Public NOAA NWPS nearshore sample locations; the marker is the selected model point.
export const FOLLY_MAP_AREAS=Object.freeze({
 pier:{latitude:32.6489,longitude:-79.938,label:'Pier area'},
 washout:{latitude:32.6677,longitude:-79.903,label:'Washout'},
 west:{latitude:32.6389,longitude:-79.955,label:'West Folly'},
 east:{latitude:32.6578,longitude:-79.920,label:'East Folly'}
});
// OSM XYZ tiles use Web Mercator; unrotated x=east, y=south, true north stays up.
export function mercatorWorld(latitude,longitude,zoom=14){
 if(!compassNumber(latitude)||!compassNumber(longitude)||Math.abs(latitude)>85.05112878||Math.abs(longitude)>180||!Number.isInteger(zoom)||zoom<0||zoom>19)throw new RangeError('Invalid map coordinates');
 const scale=256*2**zoom,radians=latitude*Math.PI/180;
 return {x:(longitude+180)/360*scale,y:(1-Math.asinh(Math.tan(radians))/Math.PI)/2*scale};
}
export function mapTileLayout(latitude,longitude,{zoom=14,width=320,height=210}={}){
 if(!compassNumber(width)||!compassNumber(height)||width<=0||height<=0||width>512||height>512)throw new RangeError('Invalid map viewport');
 const center=mercatorWorld(latitude,longitude,zoom),left=center.x-width/2,top=center.y-height/2,tiles=[];
 const count=2**zoom;
 for(let y=Math.floor(top/256);y<=Math.floor((top+height-1e-7)/256);y++){
  if(y<0||y>=count)continue;
  for(let x=Math.floor(left/256);x<=Math.floor((left+width-1e-7)/256);x++){
   tiles.push({x:((x%count)+count)%count,y,z:zoom,left:x*256-left,top:y*256-top,width:256});
  }
 }
 return {center,tiles,width,height};
}
function compassMap(area,latitude,longitude){
 const selected=FOLLY_MAP_AREAS[area]??FOLLY_MAP_AREAS.pier;
 const lat=compassNumber(latitude)?latitude:selected.latitude,lon=compassNumber(longitude)?longitude:selected.longitude;
 const map=mapTileLayout(lat,lon);
 const tiles=map.tiles.map(tile=>`<img class="fc-map-tile" alt="" aria-hidden="true" src="https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png" width="256" height="256" loading="lazy" decoding="async" referrerpolicy="strict-origin-when-cross-origin" style="left:${tile.left/map.width*100}%;top:${tile.top/map.height*100}%;width:${tile.width/map.width*100}%;height:${tile.width/map.height*100}%">`).join('');
 return {tiles,label:selected.label+' nearshore',latitude:lat,longitude:lon};
}
const compassBearing = value => ((value % 360) + 360) % 360;
const compassCardinal = value => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(compassBearing(value)/22.5)%16];
const compassPosition = (bearing,radius) => {
 const radians=bearing*Math.PI/180;
 return [160+Math.sin(radians)*radius,105-Math.cos(radians)*radius];
};
const compassPoint = point => point.map(n=>n.toFixed(2)).join(',');
const compassFormat = (value,digits=0) => compassNumber(value)?value.toFixed(digits):'—';
const compassFrom = bearing => compassNumber(bearing)?`${compassCardinal(bearing)} ${Math.round(compassBearing(bearing))%360}°`:'Unavailable';
function compassArrow(bearing,kind){
 if(!compassNumber(bearing))return '';
 const radius=kind==='wind'?68:kind==='secondary'?62:53,tipRadius=kind==='wind'?21:kind==='secondary'?24:13;
 // Parallel offset keeps coincident components visible without changing either bearing.
 const offset=kind==='secondary'?12:0,angle=bearing*Math.PI/180;
 const shift=p=>[p[0]+Math.cos(angle)*offset,p[1]+Math.sin(angle)*offset];
 const start=shift(compassPosition(bearing,radius)),tip=shift(compassPosition(bearing,tipRadius));
 const base=shift(compassPosition(bearing,tipRadius+10)),half=kind==='wind'?6:5;
 const left=[base[0]+Math.cos(angle)*half,base[1]+Math.sin(angle)*half],right=[base[0]-Math.cos(angle)*half,base[1]-Math.sin(angle)*half];
 return `<g class="fc-vector fc-vector-${kind}" data-from="${compassBearing(bearing)}"><path d="M${compassPoint(start)} L${compassPoint(base)}"/><path class="fc-arrowhead" d="M${compassPoint(tip)} L${compassPoint(left)} L${compassPoint(right)} Z"/><circle cx="${start[0].toFixed(2)}" cy="${start[1].toFixed(2)}" r="3"/></g>`;
}
export function renderCompass({wind,windDir,gust,swellComponents=null,swellLoading=false,units='imperial',area='pier',latitude,longitude}={}){
 const map=compassMap(area,latitude,longitude);
 const metric=units==='metric',speedFactor=metric?1.609344:1,heightFactor=metric?1:3.280839895;
 const speedUnit=metric?'km/h':'mph',heightUnit=metric?'m':'ft';
 const windValid=compassNumber(wind)&&wind>=0,windBearing=windValid?windDir:null;
 const component=(key,label)=>{
  const value=swellComponents?.[key],height=value?.heightM,period=value?.periodS,direction=value?.directionFromDeg;
  const heightValid=compassNumber(height)&&height>=0,periodValid=compassNumber(period)&&period>0;
  const bearing=heightValid&&height>0&&periodValid&&compassNumber(direction)&&direction>=0&&direction<360?direction:null;
  const text=!heightValid?(swellLoading?'Loading…':'Unavailable'):height===0?'None reported':`${compassFormat(height*heightFactor,1)} ${heightUnit}${periodValid?' · '+compassFormat(period,1)+' s':''}`;
  return {bearing,text,label};
 };
 const primary=component('primary','Primary swell'),secondary=component('secondary','Secondary swell');
 const relative=compassNumber(windBearing)?Math.abs(((compassBearing(windBearing)-315+540)%360)-180):null;
 const relation=!windValid?'Wind unavailable':wind<5?'Light wind':relative===null?'Direction unavailable':relative<=45?'Offshore':relative>=135?'Onshore':'Cross-shore';
 const windText=windValid?`${compassFormat(wind*speedFactor)} ${speedUnit}`:'Unavailable';
 const description=`Map of ${map.label}, Folly Beach, north up. Compass centered at nearshore point ${map.latitude.toFixed(4)}, ${map.longitude.toFixed(4)}. Wind from ${compassFrom(windBearing)}, ${windText}${windValid&&compassNumber(gust)?', gusts '+compassFormat(gust*speedFactor)+' '+speedUnit:''}. ${relation}. ${[primary,secondary].map(s=>s.label+' offshore model forecast from '+compassFrom(s.bearing)+', '+s.text).join('. ')}. Arrows point toward the direction of travel. Secondary arrow is offset for visibility; bearings are unchanged.`;
 const ticks=Array.from({length:24},(_,i)=>{const a=compassPosition(i*15,73),b=compassPosition(i*15,i%3===0?79:76);return `<path d="M${compassPoint(a)}L${compassPoint(b)}"/>`;}).join('');
 const labels=Array.from({length:8},(_,i)=>{const angle=i*45,p=compassPosition(angle,94),cardinal=['N','NE','E','SE','S','SW','W','NW'][i];return `<text x="${p[0].toFixed(2)}" y="${p[1].toFixed(2)}" class="${i%2===0?'fc-cardinal':'fc-intercardinal'}"><tspan x="${p[0].toFixed(2)}" dy="-1">${cardinal}</tspan><tspan class="fc-degrees" x="${p[0].toFixed(2)}" dy="10">${angle}°</tspan></text>`;}).join('');
 const reading=(s,kind)=>`<div class="fc-reading fc-${kind}"><span class="fc-key"></span><div><strong>${s.label} <span>${compassFrom(s.bearing)}</span></strong><p>${s.text}</p></div></div>`;
 return `<div class="fc-map-caption">${map.label}<span>North up</span></div><div class="fc-diagram fc-map-diagram"><div class="fc-map-tiles" aria-hidden="true"><span class="fc-map-unavailable">Map loading or unavailable</span>${map.tiles}</div><svg viewBox="0 0 320 210" role="img" aria-label="${description}"><circle class="fc-face" cx="160" cy="105" r="73"/><g class="fc-rings"><circle cx="160" cy="105" r="73"/><circle class="fc-inner-ring" cx="160" cy="105" r="42"/>${ticks}</g><g class="fc-labels">${labels}</g>${compassArrow(primary.bearing,'swell')}${compassArrow(secondary.bearing,'secondary')}${compassArrow(windBearing,'wind')}<circle class="fc-origin" cx="160" cy="105" r="5"/></svg></div><div class="fc-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div><div class="fc-reading fc-wind"><span class="fc-key"></span><div><strong>Wind <span>${compassFrom(windBearing)}</span></strong><p>${windText}${windValid&&compassNumber(gust)&&gust>=0?' · gusts '+compassFormat(gust*speedFactor):''}</p></div></div>${reading(primary,'swell')}${reading(secondary,'secondary')}<p class="fc-swell-source">Offshore swell forecast · MFWAM via <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noopener">Open-Meteo</a>. Periods are means. Arrows show travel direction.</p>`;
}
