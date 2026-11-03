/**
 * Verification of archived offshore forecasts against NDBC 41004.
 * This module does not estimate, calibrate, or validate breaking surf at Folly.
 * All times are Unix seconds. Heights are metres.
 */
export const BUOY_STATION = Object.freeze({
  id: '41004', name: 'EDISTO', latitude: 32.501, longitude: -79.099,
});

const LEAD_BINS = Object.freeze([
  {id:'6-24h',label:'6–24 hours',minHours:6,maxHours:24},
  {id:'24-48h',label:'24–48 hours',minHours:24,maxHours:48},
  {id:'48-72h',label:'48–72 hours',minHours:48,maxHours:72},
  {id:'72-120h',label:'3–5 days',minHours:72,maxHours:120},
  {id:'120-168h',label:'5–7 days',minHours:120,maxHours:168},
].map(Object.freeze));

const numeric = n => typeof n === 'number' && Number.isFinite(n);
const wave = n => numeric(n) && n >= 0;
const radians = d => d * Math.PI / 180;
const MAX_GRID_DISTANCE_KM = 30;
const MATCH_TOLERANCE_SECONDS = 30 * 60;

function stationDistanceKm(latitude, longitude) {
  if (!numeric(latitude) || !numeric(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return null;
  const a = Math.sin(radians(latitude-BUOY_STATION.latitude)/2)**2 +
    Math.cos(radians(latitude))*Math.cos(radians(BUOY_STATION.latitude))*
    Math.sin(radians(longitude-BUOY_STATION.longitude)/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}

/** A separate forecast request at the buoy, never the Folly offshore cell. */
export function buoyForecastURL() {
  return 'https://marine-api.open-meteo.com/v1/marine?' + new URLSearchParams({
    latitude:BUOY_STATION.latitude,longitude:BUOY_STATION.longitude,
    hourly:'wave_height',forecast_days:7,timeformat:'unixtime',timezone:'UTC',
    cell_selection:'sea',
  });
}

/**
 * Preserve an API response at download time, before any observations are joined.
 * `retrievedAt` is deliberately not called a model issue time.
 */
export function createBuoySnapshot(model, retrievedAt) {
  if (!numeric(retrievedAt) || model?.error || model?.hourly_units?.wave_height !== 'm') return null;
  const distance = stationDistanceKm(model?.latitude,model?.longitude);
  if (distance === null || distance > MAX_GRID_DISTANCE_KM) return null;
  const h = model?.hourly;
  if (!Array.isArray(h?.time) || !Array.isArray(h?.wave_height) || h.time.length !== h.wave_height.length) return null;
  const pairs = h.time.map((t,i)=>({t,wave:h.wave_height[i]})).filter(p=>numeric(p.t)&&wave(p.wave));
  if (!pairs.length) return null;
  return {
    schemaVersion:1,source:'open-meteo-buoy',station:BUOY_STATION.id,
    requestedLatitude:BUOY_STATION.latitude,requestedLongitude:BUOY_STATION.longitude,
    latitude:model.latitude,longitude:model.longitude,gridDistanceKm:distance,
    retrievedAt,modelSelection:'best_match',heightUnit:'m',
    hourly:{time:pairs.map(p=>p.t),wave_height:pairs.map(p=>p.wave)},
  };
}

function closestObservation(observations, t) {
  let lo=0,hi=observations.length;
  while (lo<hi) {
    const mid=(lo+hi)>>>1;
    if (observations[mid].t<t) lo=mid+1; else hi=mid;
  }
  // Earlier observations win an exact tie, consistently across repeated runs.
  const choices=[observations[lo-1],observations[lo]].filter(Boolean);
  choices.sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t)||a.t-b.t);
  const match=choices[0];
  return match && Math.abs(match.t-t)<=MATCH_TOLERANCE_SECONDS ? match : null;
}

/**
 * Compare forecasts that were actually available before their valid hour.
 *
 * snapshots: {source:'open-meteo-buoy',retrievedAt,latitude,longitude,
 *             hourly:{time:[],wave_height:[]}}
 * buoyRows: {t,waveM}[] (a row's optional station must be '41004').
 *
 * Each valid hour appears at most once in each lead bin. The earliest downloaded
 * snapshot in that bin wins, so repeatedly polling cannot inflate the sample
 * count. A buoy observation is also used at most once per bin.
 */
export function compareSnapshots(snapshots, buoyRows, {now=Date.now()/1000}={}) {
  const current=typeof now==='function'?now():now;
  if (!numeric(current)) throw new TypeError('now must be Unix seconds');
  const rejected={invalidSnapshot:0,wrongLocation:0,hindsightOrFuture:0,outsideLeadBins:0};
  const observationMap=new Map();
  for (const row of Array.isArray(buoyRows)?buoyRows:[]) {
    if (!numeric(row?.t)||row.t>current||!wave(row.waveM)||(row.station&&row.station!==BUOY_STATION.id)) continue;
    observationMap.set(row.t,{t:row.t,waveM:row.waveM});
  }
  const observations=[...observationMap.values()].sort((a,b)=>a.t-b.t);
  const targets=LEAD_BINS.map(()=>new Map());
  const modelPoints=new Map();
  for (const snapshot of Array.isArray(snapshots)?snapshots:[]) {
    const h=snapshot?.hourly;
    if (snapshot?.source!=='open-meteo-buoy'||!numeric(snapshot.retrievedAt)||snapshot.retrievedAt>current||
        (snapshot.station&&snapshot.station!==BUOY_STATION.id)||(snapshot.heightUnit&&snapshot.heightUnit!=='m')||
        !Array.isArray(h?.time)||!Array.isArray(h?.wave_height)||h.time.length!==h.wave_height.length) {
      rejected.invalidSnapshot++;continue;
    }
    const distance=stationDistanceKm(snapshot.latitude,snapshot.longitude);
    if (distance===null||distance>MAX_GRID_DISTANCE_KM) {rejected.wrongLocation++;continue;}
    modelPoints.set(`${snapshot.latitude},${snapshot.longitude}`,{
      latitude:snapshot.latitude,longitude:snapshot.longitude,distanceKm:distance,
    });
    for (let i=0;i<h.time.length;i++) {
      const t=h.time[i],predictedM=h.wave_height[i];
      if (!numeric(t)||!wave(predictedM)) continue;
      if (snapshot.retrievedAt>=t||t>current) {rejected.hindsightOrFuture++;continue;}
      const leadHours=(t-snapshot.retrievedAt)/3600;
      const bin=LEAD_BINS.findIndex(b=>leadHours>=b.minHours&&leadHours<b.maxHours);
      if (bin<0) {rejected.outsideLeadBins++;continue;}
      const previous=targets[bin].get(t);
      if (!previous||snapshot.retrievedAt<previous.retrievedAt) targets[bin].set(t,{
        t,predictedM,retrievedAt:snapshot.retrievedAt,leadHours,
      });
    }
  }
  const matchedHours=new Set();
  const bins=LEAD_BINS.map((bin,i)=>{
    const candidates=[...targets[i].values()].map(prediction=>{
      const observation=closestObservation(observations,prediction.t);
      return observation?{...prediction,observationTime:observation.t,observedM:observation.waveM,
        timeDifferenceSeconds:Math.abs(observation.t-prediction.t),errorM:prediction.predictedM-observation.waveM}:null;
    }).filter(Boolean).sort((a,b)=>a.timeDifferenceSeconds-b.timeDifferenceSeconds||a.t-b.t);
    const used=new Set();
    const matches=candidates.filter(candidate=>{
      if (used.has(candidate.observationTime)) return false;
      used.add(candidate.observationTime);matchedHours.add(candidate.t);return true;
    });
    const count=matches.length;
    return {...bin,count,eligibleForecastHours:targets[i].size,
      meanAbsoluteErrorM:count?matches.reduce((sum,p)=>sum+Math.abs(p.errorM),0)/count:null,
      meanBiasM:count?matches.reduce((sum,p)=>sum+p.errorM,0)/count:null,
      firstValidAt:count?Math.min(...matches.map(p=>p.t)):null,
      lastValidAt:count?Math.max(...matches.map(p=>p.t)):null,
    };
  });
  return {
    station:BUOY_STATION,status:matchedHours.size?'offshore-only':'awaiting-matches',
    generatedAt:current,uniqueMatchedHours:matchedHours.size,bins,
    availableObservations:observations.length,modelPoints:[...modelPoints.values()],rejected,
    matchToleranceSeconds:MATCH_TOLERANCE_SECONDS,maxGridDistanceKm:MAX_GRID_DISTANCE_KM,
    leadBasis:'Time from forecast retrieval to valid hour; model issue time is not supplied.',
    scope:'Offshore significant wave height at the model sea cell near NDBC 41004. This does not validate breaking surf at Folly Beach.',
    note:matchedHours.size?'Error statistics describe the matched offshore forecast hours only. They are not a confidence interval or a beach surf rating.':'Waiting for archived forecasts to reach their valid time and match buoy observations. No accuracy estimate is available yet.',
  };
}
