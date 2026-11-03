/** Public NOAA ingestion. All times are UTC epoch seconds; displayed days are Eastern.
 * No conversion from offshore/nearshore significant wave height to breaking surf.
 * No sandbar calibration or beach observations are implied by these sources.
 */
const FORECAST_TZ = 'America/New_York';
const SOURCE_URLS = Object.freeze({
  nwsIndex: 'https://api.weather.gov/products/types/SRF/locations/CHS',
  nwsPage: 'https://forecast.weather.gov/product.php?site=CHS&issuedby=CHS&product=SRF&format=TXT&version=1&glossary=0',
  buoy: 'https://www.ndbc.noaa.gov/data/realtime2/41004.txt',
  buoyPage: 'https://www.ndbc.noaa.gov/station_page.php?station=41004',
  nwpsBase: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod/'
});
const FOLLY_POINTS = Object.freeze([
  {id:'west',label:'West Folly nearshore',latitude:32.6389,longitude:-79.955},
  {id:'pier',label:'Central Folly nearshore',latitude:32.6489,longitude:-79.938},
  {id:'east',label:'East Folly nearshore',latitude:32.6578,longitude:-79.920},
  {id:'washout',label:'Northeast Folly nearshore',latitude:32.6677,longitude:-79.903}
]);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const numeric = v => typeof v==='string' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(v) ? Number(v) : null;
const bounded = (v,lo,hi) => finite(v)&&v>=lo&&v<=hi?v:null;
const seconds = s => typeof s==='string' && finite(Date.parse(s))?Date.parse(s)/1000:null;
const dateFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:FORECAST_TZ,year:'numeric',month:'2-digit',day:'2-digit'});
const localDate = t => dateFormatter.format(new Date(t*1000));
const dateAdd = (date,days) => new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const weekdays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

/** Calendar boundaries, not a claim of an NWS hourly validity interval. */
export function easternMidnight(date){
  const target=Date.parse(date+'T00:00:00Z');
  if(!finite(target))return null;
  let guess=target;
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:FORECAST_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
    const represented=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    guess+=target-represented;
  }
  return guess/1000;
}

function issueFromText(text){
  const m=text.match(/^\s*(\d{1,4})\s+(AM|PM)\s+(EDT|EST)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\s*$/m);
  if(!m)return null;
  const n=Number(m[1]),h=Math.floor(n/100),minutes=n%100;
  if(h<1||h>12||minutes>59)return null;
  const hour=h%12+(m[2]==='PM'?12:0);
  return seconds(`${m[5]} ${m[4]} ${m[6]} ${String(hour).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00 GMT${m[3]==='EDT'?'-0400':'-0500'}`);
}

function zoneSegment(text,target='SCZ150'){
  for(const section of text.split(/\$\$/)){
    // UGC lists may group zones, use ranges, or wrap across lines.
    const header=section.match(/^\s*([A-Z]{2}[CZ]\d{3}[\s\S]{0,200}?-\d{6}-)\s*$/m)?.[1];
    if(!header)continue;
    let prefix='';let found=false;
    for(const token of header.replace(/\s/g,'').split('-')){
      const m=token.match(/^([A-Z]{2}[CZ])?(\d{3})(?:>(\d{3}))?$/);
      if(!m)continue;
      if(m[1])prefix=m[1];
      const a=Number(m[2]),b=Number(m[3]??m[2]);
      if(prefix===target.slice(0,3)&&Number(target.slice(3))>=a&&Number(target.slice(3))<=b)found=true;
    }
    if(found)return section.split(/^\s*&&/m)[0].trim();
  }
  return null;
}

export function parseSurfHeight(text){
  const phrase=text.match(/surf\s+height[.\s]*([^\n]+)/i)?.[1]?.trim()??null;
  if(!phrase)return {surfMinFt:null,surfMaxFt:null,surfText:null,surfQualifier:null};
  const range=phrase.match(/\b(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)\b/i);
  let min=null,max=null,qualifier=null;
  if(range){min=Number(range[1]);max=Number(range[2]);qualifier='range';}
  else {
    const single=phrase.match(/\b(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)\b/i);
    if(single){
      max=Number(single[1]);
      if(/(?:less than|up to|or less|or lower|below)/i.test(phrase)){min=0;qualifier=/less than|below/i.test(phrase)?'less-than':'at-most';}
      else {min=max;qualifier=/around|about/i.test(phrase)?'around':'value';}
    } else if(/^flat\b/i.test(phrase)){min=0;max=0;qualifier='flat';}
  }
  if(!finite(min)||!finite(max)||min<0||max<min||max>100){min=null;max=null;qualifier=null;}
  return {surfMinFt:min,surfMaxFt:max,surfText:phrase,surfQualifier:qualifier};
}

function periodDay(label,issueDate,previousDate){
  const normalized=label.replace(/\s+/g,' ').trim().toUpperCase();
  if(/^(?:TODAY|TONIGHT|REST OF TODAY|REST OF TONIGHT|THIS AFTERNOON|THIS MORNING|THIS EVENING)$/.test(normalized))return issueDate;
  if(/^TOMORROW(?: NIGHT)?$/.test(normalized))return dateAdd(issueDate,1);
  const weekday=weekdays.findIndex(w=>normalized===w||normalized===w+' NIGHT'||normalized===w+' AND '+w+' NIGHT');
  if(weekday<0)return null;
  let date=previousDate&&previousDate>issueDate?previousDate:issueDate;
  for(let i=0;i<8;i++,date=dateAdd(date,1))if(new Date(date+'T12:00:00Z').getUTCDay()===weekday)return date;
  return null;
}

export function parseNwsSurf(product){
  const text=typeof product==='string'?product:product?.productText;
  if(typeof text!=='string')return null;
  const clean=text.replace(/\r/g,'');
  const issuedAt=seconds(product?.issuanceTime)??issueFromText(clean);
  const segment=zoneSegment(clean);
  if(!finite(issuedAt)||!segment)return null;
  const issueDate=localDate(issuedAt),matches=[...segment.matchAll(/^\s*\.([A-Z][A-Z /-]*?)\.{3}([^]*?)(?=^\s*\.[A-Z][A-Z /-]*?\.{3}|$(?![^]))/gm)];
  let previousDate=null;
  const periods=[];
  for(const match of matches){
    const label=match[1].trim();
    if(label==='EXTENDED')continue;
    const day=periodDay(label,issueDate,previousDate);
    if(!day)continue; // Unsupported labels remain in the source text, never guessed.
    previousDate=day;
    const body=match[2].trim();
    const surf=parseSurfHeight(body);
    if(!finite(surf.surfMaxFt))continue;
    const risk=body.match(/rip\s+current\s+risk\*?\s*\.*\s*(Low|Moderate|High)\b/i)?.[1]??null;
    periods.push({label,day,start:easternMidnight(day),end:easternMidnight(dateAdd(day,1)),intervalBasis:'calendar-day',timeOfDay:/AND .*NIGHT/.test(label)?'day-and-night':/NIGHT|EVENING/.test(label)?'night':'day',...surf,ripRisk:risk,text:body});
  }
  if(!periods.length)return null;
  return {issuedAt,sourceUrl:SOURCE_URLS.nwsPage,productId:typeof product?.id==='string'?product.id:null,zone:'SCZ150',scope:'Charleston County beaches including Folly Beach',periods};
}

function parseNwpsTime(value){
  const m=value.match(/^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})$/);
  if(!m)return null;
  const [,year,month,day,hour,minute]=m;
  const t=seconds(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  if(!finite(t)||new Date(t*1000).toISOString().slice(0,16)!==`${year}-${month}-${day}T${hour}:${minute}`)return null;
  return t;
}

export function nwpsUrl(cycle){
  if(!finite(cycle))throw new Error('Invalid NWPS cycle');
  const d=new Date(cycle*1000),date=d.toISOString().slice(0,10).replaceAll('-',''),hour=String(d.getUTCHours()).padStart(2,'0');
  if(d.getUTCMinutes()||d.getUTCSeconds()||d.getUTCHours()%6)throw new Error('Invalid NWPS cycle');
  return `${SOURCE_URLS.nwpsBase}er.${date}/chs/${hour}/CG1/nwps.t${hour}z.5m_CG1_ripprob.chs.txt`;
}

export function nwpsCycles(now=Date.now()/1000,count=5){
  const start=Math.floor(now/21600)*21600;
  return Array.from({length:Math.min(8,Math.max(1,Math.floor(count)))},(_,i)=>start-i*21600);
}

export function parseNwps(text,{cycle=null,points=FOLLY_POINTS,tolerance=0.003}={}){
  if(typeof text!=='string')return null;
  const selected=new Map(points.map(p=>[p.id,{...p,rows:new Map(),distance:Infinity}]));
  for(const line of text.split(/\r?\n/)){
    const trim=line.trim();if(!trim||trim.startsWith('%')||trim.startsWith('#'))continue;
    const fields=trim.split(/\s+/);if(fields.length<9)continue;
    const x=numeric(fields[1]),latitude=numeric(fields[2]);
    if(!finite(x)||!finite(latitude))continue;
    const longitude=x>180?x-360:x;
    if(!points.some(p=>Math.abs(p.latitude-latitude)<=tolerance&&Math.abs(p.longitude-longitude)<=tolerance))continue;
    const t=parseNwpsTime(fields[0]);
    if(!finite(t)||finite(cycle)&&(t<cycle||t>cycle+144*3600))continue;
    for(const point of selected.values()){
      const distance=Math.hypot(latitude-point.latitude,longitude-point.longitude);
      if(distance>tolerance||distance>point.distance+1e-8)continue;
      if(distance<point.distance-1e-8){point.rows.clear();point.distance=distance;point.sourceLatitude=latitude;point.sourceLongitude=longitude;}
      // NOAA preprocessing can turn missing SWAN values into zero. Never call them calm.
      const h=bounded(numeric(fields[4]),0.0001,30),p=bounded(numeric(fields[5]),0.0001,60);
      const usable=finite(h)&&finite(p);
      point.rows.set(t,{t,day:localDate(t),waveM:usable?h:null,peakPeriodS:usable?p:null,relativeDirectionDeg:usable?bounded(numeric(fields[6]),-90,90):null,quality:usable?'modeled':'missing-or-zero'});
    }
  }
  const output=[...selected.values()].filter(p=>p.rows.size).map(({distance,rows,sourceLatitude,sourceLongitude,...p})=>({...p,latitude:sourceLatitude,longitude:sourceLongitude,rows:[...rows.values()].sort((a,b)=>a.t-b.t)}));
  if(!output.some(p=>p.rows.some(r=>finite(r.waveM))))return null;
  return {cycle,issuedAt:cycle,sourceUrl:finite(cycle)?nwpsUrl(cycle):null,contourDepthM:5,heightType:'nearshore-significant-wave-height',directionType:'relative-to-shore-normal',points:output};
}

export function parseBuoy(text,{now=Date.now()/1000,historyHours=24*35}={}){
  if(typeof text!=='string')return null;
  const lines=text.split(/\r?\n/),header=lines.find(l=>/^#(?:YY|YYYY)\s+MM\s+DD\s+hh\s+mm\b/.test(l));
  if(!header)return null;
  const names=header.replace(/^#/,'').trim().split(/\s+/),index=Object.fromEntries(names.map((n,i)=>[n,i]));
  if(!['WVHT','WSPD','WTMP'].every(k=>Number.isInteger(index[k])))return null;
  const byTime=new Map();
  for(const line of lines){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const fields=line.trim().split(/\s+/);if(fields.length<5)continue;
    let year=Number(fields[0]);if(year<100)year+=year>=70?1900:2000;
    const month=Number(fields[1]),day=Number(fields[2]),hour=Number(fields[3]),minute=Number(fields[4]);
    if(![year,month,day,hour,minute].every(Number.isInteger)||year<1900||month<1||month>12||day<1||day>31||hour<0||hour>23||minute<0||minute>59)continue;
    const t=Date.UTC(year,month-1,day,hour,minute)/1000,d=new Date(t*1000);
    if(d.getUTCDate()!==day||t>now+300||t<now-historyHours*3600)continue;
    const value=(key,min,max)=>bounded(numeric(fields[index[key]]),min,max);
    byTime.set(t,{t,waveM:value('WVHT',0,30),dominantPeriodS:value('DPD',0.0001,60),averagePeriodS:value('APD',0.0001,60),waveDirectionDeg:value('MWD',0,360),windMs:value('WSPD',0,100),windDirectionDeg:value('WDIR',0,360),gustMs:value('GST',0,150),waterC:value('WTMP',-5,50),airC:value('ATMP',-60,60)});
  }
  const rows=[...byTime.values()].sort((a,b)=>b.t-a.t);
  if(!rows.length)return null;
  return {station:'41004',name:'EDISTO — 41 nautical miles southeast of Charleston',sourceUrl:SOURCE_URLS.buoyPage,rows,latestWave:rows.find(r=>finite(r.waveM))??null,latestWind:rows.find(r=>finite(r.windMs))??null,latestWater:rows.find(r=>finite(r.waterC))??null};
}

/** Conservative display-age policy, not a statistical forecast confidence. */
export function sourceFreshness(kind,issuedAt,now=Date.now()/1000){
  const limits={nws:[24,48],nwps:[18,36],buoy:[3,6]};
  const policy=limits[kind];
  if(!policy||!finite(issuedAt)||!finite(now)||issuedAt>now+300)return 'unavailable';
  const age=Math.max(0,now-issuedAt)/3600;
  return age<=policy[0]?'fresh':age<=policy[1]?'stale':'unavailable';
}

async function request(url,{fetchImpl,timeoutMs,userAgent,format='text',deadline=Infinity}){
  const remaining=Math.min(timeoutMs,deadline-Date.now());
  if(remaining<=0)throw new Error('Source collection deadline reached');
  const controller=new AbortController();
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
    controller.abort();reject(new Error('Source request timed out'));
  },remaining);});
  try{
    return await Promise.race([timeout,(async()=>{
      const response=await fetchImpl(url,{headers:{'User-Agent':userAgent,'Accept':format==='json'?'application/ld+json, application/json':'text/plain'},signal:controller.signal});
      if(!response.ok){
        // Release the response connection before trying an older NOAA cycle.
        await response.body?.cancel();
        throw new Error(`Upstream HTTP ${response.status}`);
      }
      const body=await response.text();if(body.length>8_000_000)throw new Error('Upstream response too large');
      return format==='json'?JSON.parse(body):body;
    })()]);
  } finally {clearTimeout(timer);}
}

const fail=(error,now)=>({status:'unavailable',data:null,retrievedAt:now,issuedAt:null,error:error?.name==='AbortError'?'Upstream request timed out':String(error?.message??'Source unavailable')});
function envelope(kind,data,issuedAt,now){
  const status=sourceFreshness(kind,issuedAt,now);
  return {status,data:status==='unavailable'?null:data,retrievedAt:now,issuedAt,error:status==='unavailable'?'Source is too old or has an invalid timestamp':null};
}

export async function fetchNwsSurf(options={}){
  const {now=Date.now()/1000,fetchImpl=fetch,timeoutMs=7000,userAgent='FollySurf/1.0 (regional surf dashboard)'}=options;
  const config={fetchImpl,timeoutMs,userAgent,format:'json',deadline:options.deadline??Infinity};
  try{
    const index=await request(SOURCE_URLS.nwsIndex,config);
    const products=(index?.['@graph']??[]).filter(p=>finite(seconds(p.issuanceTime))&&seconds(p.issuanceTime)<=now+300).sort((a,b)=>seconds(b.issuanceTime)-seconds(a.issuanceTime)).slice(0,3);
    let error=new Error('No NWS surf products available');
    for(const p of products){
      const id=typeof p.id==='string'?p.id:typeof p['@id']==='string'?p['@id'].split('/').at(-1):'';
      if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id))continue;
      try{
        const product=await request(`https://api.weather.gov/products/${id}`,config),data=parseNwsSurf(product);
        if(!data||!data.periods.some(p=>p.end>now)){error=new Error('No current Charleston surf periods');continue;}
        return {...envelope('nws',data,data.issuedAt,options.clock?.()??now),sourceUrl:`https://api.weather.gov/products/${id}`,rawResponse:{format:'json',body:product}};
      }catch(e){error=e;}
    }
    return fail(error,now);
  }catch(error){return fail(error,now);}
}

export async function fetchNwps(options={}){
  const {now=Date.now()/1000,fetchImpl=fetch,timeoutMs=7000,userAgent='FollySurf/1.0 (regional surf dashboard)',nwpsAttempts=5}=options;
  let error=new Error('No completed NWPS cycle available');
  const cycles=nwpsCycles(now,nwpsAttempts);
  // Probe two adjacent cycles together: a slow publishing cycle cannot make
  // every older-cycle fallback wait in turn. Keep NOAA concurrency bounded,
  // and choose the newest usable cycle, not whichever response wins the race.
  for(let offset=0;offset<cycles.length;offset+=2){
    const results=await Promise.all(cycles.slice(offset,offset+2).map(async cycle=>{
      try{
        const text=await request(nwpsUrl(cycle),{fetchImpl,timeoutMs,userAgent,deadline:options.deadline??Infinity}),data=parseNwps(text,{cycle});
        if(!data||!data.points.some(p=>p.rows.some(r=>finite(r.waveM)&&r.t>=now)))throw new Error('NWPS cycle has no usable upcoming Folly data');
        return {data,cycle,text,retrievedAt:options.clock?.()??now};
      }catch(error){return {error};}
    }));
    for(const result of results){
      if(result.data)return {...envelope('nwps',result.data,result.cycle,result.retrievedAt),sourceUrl:nwpsUrl(result.cycle),rawResponse:{format:'text',body:result.text}};
      error=result.error;
    }
  }
  return fail(error,now);
}

export async function fetchBuoy(options={}){
  const {now=Date.now()/1000,fetchImpl=fetch,timeoutMs=7000,userAgent='FollySurf/1.0 (regional surf dashboard)'}=options;
  try{
    const text=await request(SOURCE_URLS.buoy,{fetchImpl,timeoutMs,userAgent,deadline:options.deadline??Infinity}),data=parseBuoy(text,{now});
    if(!data)return fail(new Error('No usable buoy observations'),now);
    data.fieldStatus={};
    for(const [name,key] of [['wave','latestWave'],['wind','latestWind'],['water','latestWater']]){
      data.fieldStatus[name]=sourceFreshness('buoy',data[key]?.t,now);
      if(data.fieldStatus[name]==='unavailable')data[key]=null;
    }
    const issuedAt=data.latestWave?.t??null;
    // Wave status governs the envelope; the individual observation times remain explicit.
    const status=sourceFreshness('buoy',issuedAt,now);
    return {status,data,retrievedAt:options.clock?.()??now,issuedAt,sourceUrl:SOURCE_URLS.buoy,rawResponse:{format:'text',body:text},error:status==='unavailable'?'No wave observation within six hours':null};
  }catch(error){return fail(error,now);}
}

export async function collectForecastSources(options={}){
  const now=options.now??Date.now()/1000;
  // One budget covers all retries, rather than granting every cycle a new timeout.
  options={...options,deadline:Date.now()+(options.collectionTimeoutMs??12000)};
  const [nws,nwps,buoy]=await Promise.all([fetchNwsSurf({...options,now}),fetchNwps({...options,now}),fetchBuoy({...options,now})]);
  return {nws,nwps,buoy};
}
