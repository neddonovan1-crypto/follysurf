/**
 * Server-only Google Routes / TomTom adapters. Keys must never reach the browser.
 * The HTTP route wrapping this module must send Cache-Control: no-store.
 * Do not persist responses in R2, logs, localStorage, or a shared cache.
 * Docs: https://developers.google.com/maps/documentation/routes/policies
 */
const TRAFFIC_REFRESH_SECONDS = 600;
const TRAFFIC_MAX_AGE_SECONDS = 600;
export const TRAFFIC_ORIGINS = Object.freeze([
  Object.freeze({id:'downtown',label:'Downtown Charleston',origin:'329 Meeting Street, Charleston, SC 29403',originLabel:'Marion Square'}),
  Object.freeze({id:'mount-pleasant',label:'Mount Pleasant',origin:'1218 Belk Drive, Mount Pleasant, SC 29464',originLabel:'Towne Centre'}),
  Object.freeze({id:'west-ashley',label:'West Ashley',origin:'Savannah Highway & Magnolia Road, Charleston, SC'})
]);
const TRAFFIC_DESTINATIONS = Object.freeze({
  pier:'101 E Arctic Avenue, Folly Beach, SC 29439',
  washout:'1563 E Ashley Avenue, Folly Beach, SC 29439'
});
// Source-verified addresses; no route endpoints are invented map coordinates.
// https://www.loc.gov/pictures/item/sc1226/ (Marion Square, 329 Meeting Street)
// https://www.mtpleasanttownecentre.com/about-us/ (1218 Belk Drive)
// https://cityoffollybeach.com/parking___maps.php (Pier and Washout beach accesses)
// The Washout is also a restaurant near Center Street: always use the beach address.
const ADDRESS_MATCHES=Object.freeze({
  downtown:{number:'329',words:['meeting'],city:'charleston'},
  'mount-pleasant':{number:'1218',words:['belk'],city:'mount pleasant'},
  'west-ashley':{number:null,words:['savannah','magnolia'],city:'charleston'},
  pier:{number:'101',words:['arctic'],city:'folly beach'},
  washout:{number:'1563',words:['ashley'],city:'folly beach'}
});
const ENDPOINT='https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const FIELD_MASK='originIndex,destinationIndex,status,condition,duration,staticDuration,distanceMeters,fallbackInfo';
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const millis=clock=>typeof clock==='function'?clock():clock;
const iso=t=>new Date(t).toISOString();

/** Google protobuf duration, seconds; invalid and nonpositive values stay missing. */
export function durationSeconds(value){
  if(typeof value!=='string'||!/^\d+(?:\.\d{1,9})?s$/.test(value))return null;
  const seconds=Number(value.slice(0,-1));
  return positive(seconds)?seconds:null;
}

/** Display rounding only: a five-minute band containing the provider's ETA.
 * This is not an uncertainty interval or two independently predicted bounds.
 */
export function roundedEta(seconds){
  if(!positive(seconds))return null;
  const low=Math.floor(seconds/300)*5;
  return {low,high:low+5};
}

/** Product-defined delay bands, not Google's congestion categories.
 * Green <20% and <5min extra; red >=50% or >=15min extra; yellow between.
 * The comparison uses the returned route's staticDuration (no current traffic),
 * not an observed calm-day measurement or a retained historical average.
 */
export function congestionFor(duration,baseline){
  if(!positive(duration)||!positive(baseline))return 'unknown';
  const delay=Math.max(0,duration-baseline),ratio=delay/baseline;
  if(ratio>=0.5||delay>=900)return 'red';
  if(ratio>=0.2||delay>=300)return 'yellow';
  return 'green';
}

const emptyRoute=(origin,destination,reason)=>({
  ...origin,destination,status:'unavailable',reason,
  durationSeconds:null,baselineSeconds:null,delaySeconds:null,delayRatio:null,
  etaMinutes:null,congestion:'unknown',distanceMeters:null
});

/** Parses indexed REST matrix elements independently; response order is arbitrary. */
export function parseTrafficMatrix(elements,destination){
  if(!Object.hasOwn(TRAFFIC_DESTINATIONS,destination))throw new RangeError('Unsupported traffic destination');
  const entries=new Map(),duplicates=new Set();
  if(Array.isArray(elements))for(const element of elements){
    if(!element||typeof element!=='object')continue;
    // ProtoJSON may omit default numeric fields. Their defaults are zero.
    const originIndex=element.originIndex??0,destinationIndex=element.destinationIndex??0;
    if(!Number.isInteger(originIndex)||originIndex<0||originIndex>=TRAFFIC_ORIGINS.length||destinationIndex!==0)continue;
    if(entries.has(originIndex))duplicates.add(originIndex);
    entries.set(originIndex,element);
  }
  return TRAFFIC_ORIGINS.map((origin,index)=>{
    const fail=reason=>emptyRoute(origin,destination,reason),element=entries.get(index);
    if(duplicates.has(index))return fail('ambiguous_response');
    if(!element)return fail('route_missing');
    const code=element.status?.code??0;
    if(code!==0||element.condition!=='ROUTE_EXISTS')return fail('route_unavailable');
    // A fallback may have dropped traffic data. Do not label it a live estimate.
    if(element.fallbackInfo&&Object.keys(element.fallbackInfo).length)return fail('traffic_fallback');
    const duration=durationSeconds(element.duration),baseline=durationSeconds(element.staticDuration);
    if(!duration)return fail('duration_missing');
    const delay=baseline?Math.max(0,duration-baseline):null;
    return {
      ...origin,destination,status:'ready',reason:null,durationSeconds:duration,
      baselineSeconds:baseline,delaySeconds:delay,delayRatio:baseline?delay/baseline:null,
      etaMinutes:roundedEta(duration),congestion:congestionFor(duration,baseline),
      distanceMeters:positive(element.distanceMeters)?element.distanceMeters:null
    };
  });
}

/** Display gate. Remove times/colors after ten minutes or any failed refresh. */
export function trafficIsFresh(payload,at=Date.now()){
  if(!['ready','partial'].includes(payload?.status))return false;
  const retrieved=Date.parse(payload.retrievedAt),expires=Date.parse(payload.expiresAt);
  return Number.isFinite(at)&&Number.isFinite(retrieved)&&Number.isFinite(expires)&&
    retrieved<=at&&at<expires&&at-retrieved<TRAFFIC_MAX_AGE_SECONDS*1000;
}

/**
 * @param {{destination?:'pier'|'washout',apiKey?:string,fetchImpl?:Function,
 *   now?:Function|number}} options now returns epoch milliseconds (injectable).
 * No external request is sent without a nonempty key. Omit departureTime so the
 * provider uses the actual request time; do not transmit a potentially past time.
 * Return errors are intentionally generic: provider bodies/keys never leak.
 */
async function getGoogleTraffic({destination='pier',apiKey,fetchImpl=globalThis.fetch,now=Date.now}={}){
  if(!Object.hasOwn(TRAFFIC_DESTINATIONS,destination))throw new RangeError('Unsupported traffic destination');
  const start=millis(now);
  if(!Number.isFinite(start))throw new TypeError('Invalid traffic clock');
  const base={
    provider:'Google Maps',providerId:'google',providerUrl:'https://maps.google.com/',
    attribution:'Google Maps',destination,destinationLabel:TRAFFIC_DESTINATIONS[destination],
    status:'unavailable',retrievedAt:null,expiresAt:null,
    refreshAfterSeconds:TRAFFIC_REFRESH_SECONDS,baselineKind:'provider-static-duration',
    baselineDescription:'Same route without current traffic; not a measured calm-day average.',
    rangeDescription:'ETA rounded into a five-minute band, not an uncertainty interval.',
    routes:TRAFFIC_ORIGINS.map(origin=>emptyRoute(origin,destination,'feed_unavailable'))
  };
  if(typeof apiKey!=='string'||!apiKey.trim())return {...base,status:'not_configured',reason:'provider_not_connected'};
  try{
    const response=await fetchImpl(ENDPOINT,{
      method:'POST',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':FIELD_MASK},
      body:JSON.stringify({
        origins:TRAFFIC_ORIGINS.map(origin=>({waypoint:{address:origin.origin}})),
        destinations:[{waypoint:{address:TRAFFIC_DESTINATIONS[destination]}}],
        travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE_OPTIMAL',trafficModel:'BEST_GUESS',
        languageCode:'en-US',regionCode:'us',units:'IMPERIAL'
      })
    });
    if(!response.ok)return {...base,reason:response.status===429?'provider_rate_limited':'provider_unavailable'};
    const elements=await response.json();
    if(!Array.isArray(elements))return {...base,reason:'invalid_provider_response'};
    const retrieved=millis(now);
    if(!Number.isFinite(retrieved)||retrieved<start||retrieved-start>=TRAFFIC_MAX_AGE_SECONDS*1000)return {...base,reason:'response_expired'};
    const routes=parseTrafficMatrix(elements,destination),available=routes.filter(route=>route.status==='ready').length;
    return {...base,status:available===3?'ready':available?'partial':'unavailable',
      reason:available?null:'routes_unavailable',retrievedAt:iso(retrieved),
      expiresAt:iso(retrieved+TRAFFIC_MAX_AGE_SECONDS*1000),routes};
  }catch{
    return {...base,reason:'provider_unavailable'};
  }
}

const normalized=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\bmt\b/g,'mount');

/** Require an address/intersection match in the requested city, never a city center.
 * Coordinates come solely from the provider's matching response, not a guessed pin.
 * A textual confidence threshold is a matching guard, not an accuracy probability.
 */
export function selectTomTomPosition(data,id){
  const expected=ADDRESS_MATCHES[id];
  if(!expected||!Array.isArray(data?.results))return null;
  const candidates=data.results.filter(result=>{
    const a=result.address??{},p=result.position??{},text=normalized(a.freeformAddress||a.streetName);
    const state=normalized(a.countrySubdivision),city=normalized(a.municipality||a.localName);
    return ['Point Address','Address Range','Cross Street'].includes(result.type)&&
      a.countryCode==='US'&&['sc','south carolina'].includes(state)&&city.includes(expected.city)&&
      typeof p.lat==='number'&&Number.isFinite(p.lat)&&p.lat>32&&p.lat<34&&
      typeof p.lon==='number'&&Number.isFinite(p.lon)&&p.lon>-81&&p.lon<-79&&
      typeof result.matchConfidence?.score==='number'&&result.matchConfidence.score>=.85&&
      (!expected.number||String(a.streetNumber)===expected.number)&&
      (expected.number||result.type==='Cross Street')&&expected.words.every(word=>text.includes(word));
  });
  const unique=[...new Map(candidates.map(result=>[`${result.position.lat},${result.position.lon}`,result.position])).values()];
  return unique.length===1?unique[0]:null;
}

function parseTomTomRoute(data,origin,destination){
  const summary=data?.routes?.[0]?.summary,duration=summary?.travelTimeInSeconds;
  if(!positive(duration))return emptyRoute(origin,destination,'route_unavailable');
  const baseline=positive(summary.noTrafficTravelTimeInSeconds)?summary.noTrafficTravelTimeInSeconds:null;
  const delay=baseline?Math.max(0,duration-baseline):null;
  return {...origin,destination,status:'ready',reason:null,durationSeconds:duration,
    baselineSeconds:baseline,delaySeconds:delay,delayRatio:baseline?delay/baseline:null,
    etaMinutes:roundedEta(duration),congestion:congestionFor(duration,baseline),
    distanceMeters:positive(summary.lengthInMeters)?summary.lengthInMeters:null};
}

async function getTomTomTraffic({destination='pier',apiKey,fetchImpl=globalThis.fetch,now=Date.now}={}){
  const start=millis(now);
  if(!Number.isFinite(start))throw new TypeError('Invalid traffic clock');
  const base={
    provider:'TomTom',providerId:'tomtom',providerUrl:'https://www.tomtom.com/',attribution:'© TomTom',
    destination,destinationLabel:TRAFFIC_DESTINATIONS[destination],status:'unavailable',
    retrievedAt:null,expiresAt:null,refreshAfterSeconds:TRAFFIC_REFRESH_SECONDS,
    baselineKind:'provider-no-traffic-duration',
    baselineDescription:'Same route without traffic delays; not a measured calm-day average.',
    rangeDescription:'ETA rounded into a five-minute band, not an uncertainty interval.',
    routes:TRAFFIC_ORIGINS.map(origin=>emptyRoute(origin,destination,'feed_unavailable'))
  };
  if(typeof apiKey!=='string'||!apiKey.trim())return {...base,status:'not_configured',reason:'provider_not_connected'};
  const request=async url=>{
    const response=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Provider unavailable');
    return response.json();
  };
  const geocode=async(id,address)=>{
    try{
      const query=new URLSearchParams({key:apiKey,countrySet:'US',limit:'3'});
      const data=await request(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json?${query}`);
      return selectTomTomPosition(data,id);
    }catch{return null;}
  };
  // No retained geocodes: storage rights vary by plan. Each user-visible refresh
  // makes 4 geocoding +3 routing calls, subject to both products' quotas.
  const [target,...starts]=await Promise.all([
    geocode(destination,TRAFFIC_DESTINATIONS[destination]),
    ...TRAFFIC_ORIGINS.map(origin=>geocode(origin.id,origin.origin))
  ]);
  if(!target)return {...base,reason:'destination_unresolved'};
  const routes=await Promise.all(TRAFFIC_ORIGINS.map(async(origin,index)=>{
    if(!starts[index])return emptyRoute(origin,destination,'origin_unresolved');
    try{
      const from=starts[index],query=new URLSearchParams({
        key:apiKey,traffic:'true',departAt:'now',travelMode:'car',routeType:'fastest',
        computeTravelTimeFor:'all',routeRepresentation:'summaryOnly',maxAlternatives:'0'
      });
      const data=await request(`https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${target.lat},${target.lon}/json?${query}`);
      // The route's departure should describe this request, not an old cached run.
      const departure=Date.parse(data?.routes?.[0]?.summary?.departureTime);
      const current=millis(now);
      if(!Number.isFinite(departure)||departure<start-60000||departure>current+60000)return emptyRoute(origin,destination,'response_expired');
      return parseTomTomRoute(data,origin,destination);
    }catch{return emptyRoute(origin,destination,'provider_unavailable');}
  }));
  const retrieved=millis(now),available=routes.filter(route=>route.status==='ready').length;
  if(!Number.isFinite(retrieved)||retrieved<start||retrieved-start>=TRAFFIC_MAX_AGE_SECONDS*1000)return {...base,reason:'response_expired'};
  return {...base,status:available===3?'ready':available?'partial':'unavailable',reason:available?null:'routes_unavailable',
    retrievedAt:iso(retrieved),expiresAt:iso(retrieved+TRAFFIC_MAX_AGE_SECONDS*1000),routes};
}

/** Normalized public server API. Choose provider server-side from configured keys;
 * do not let visitors supply an arbitrary provider URL, origin, or credential.
 */
export async function getTraffic({provider='google',destination='pier',...options}={}){
  if(!Object.hasOwn(TRAFFIC_DESTINATIONS,destination))throw new RangeError('Unsupported traffic destination');
  if(!['google','tomtom'].includes(provider))throw new RangeError('Unsupported traffic provider');
  return provider==='tomtom'?getTomTomTraffic({...options,destination}):getGoogleTraffic({...options,destination});
}
