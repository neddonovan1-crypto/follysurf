/** Offline, descriptive evaluation only. No fitting, public submissions, or rating changes. */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const text=s=>typeof s==='string'&&s.trim().length>0;
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
const median=a=>{const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null;};
const required=(ok,message)=>{if(!ok)throw new TypeError(message);};
const point=p=>finite(p?.latitude)&&Math.abs(p.latitude)<=90&&finite(p?.longitude)&&Math.abs(p.longitude)<=180;
function distanceM(a,b){const rad=n=>n*Math.PI/180,dlat=rad(a.latitude-b.latitude),dlon=rad(a.longitude-b.longitude);const q=Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2;return 12742000*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));}

/** A manifest is frozen before collection; split units are whole physical swell/storm events. */
export function validateObservationPlan(plan){
 required(plan?.schemaVersion===1,'Plan schemaVersion must be 1');
 required(text(plan.planId)&&finite(plan.frozenAt),'A planId and frozenAt Unix timestamp are required');
 required(Number.isInteger(plan.formulaVersion)&&plan.formulaVersion>0,'Predeclare the formula version to evaluate');
 required(text(plan.protocol)&&finite(plan.sessionMinutes)&&plan.sessionMinutes>=5&&plan.sessionMinutes<=120,'Declare the observation protocol and 5–120 minute session duration');
 required(Array.isArray(plan.locations)&&plan.locations.length>0,'Declare exact observation locations');
 required(Array.isArray(plan.events),'Declare whole-event split assignments');
 required(finite(plan.leadMinHours)&&finite(plan.leadMaxHours)&&plan.leadMinHours>=0&&plan.leadMaxHours>plan.leadMinHours,'Invalid forecast lead window');
 const locations=new Map(),events=new Map(),groups=new Map();
 for(const site of plan.locations){
  required(text(site.id)&&point(site)&&!locations.has(site.id),'Locations need unique IDs and coordinates');
  required(finite(site.matchRadiusM)&&site.matchRadiusM>0&&site.matchRadiusM<=1000,'Location match radius must be explicit and <=1000 m');
  locations.set(site.id,site);
 }
 for(const event of plan.events){
  required(text(event.id)&&text(event.eventGroup)&&!events.has(event.id),'Events need unique IDs and a physical eventGroup');
  required(finite(event.startAt)&&finite(event.endAt)&&event.startAt<event.endAt,'Event timestamps are invalid');
  required(['development','holdout'].includes(event.split),'Split must be development or holdout');
  required(['pre','post','unknown'].includes(event.nourishmentEra),'Nourishment era must be explicit');
  if(event.nourishmentEra!=='unknown'){
   const work=event.nourishmentWindow;
   required(finite(work?.startAt)&&finite(work?.endAt)&&work.startAt<=work.endAt&&/^https:\/\//.test(work.sourceUrl??''),'Pre/post eras require a documented nourishment work window');
   required(event.nourishmentEra==='pre'?event.endAt<=work.startAt:event.startAt>=work.endAt,'Event crosses nourishment work; use unknown era');
  }
  required(event.startAt>=plan.frozenAt,'Freeze split assignments before the event begins');
  if(groups.has(event.eventGroup))required(groups.get(event.eventGroup)===event.split,'A physical eventGroup cannot cross development and holdout');
  groups.set(event.eventGroup,event.split);events.set(event.id,event);
 }
 // Overlapping event windows cannot be put on opposing sides of a split.
 for(const a of plan.events)for(const b of plan.events)if(a.id!==b.id&&a.startAt<b.endAt&&b.startAt<a.endAt)required(a.split===b.split,'Overlapping event windows cannot cross evaluation splits');
 return {locations,events};
}

/** Accept immutable combined rating exports, including the history API records envelope. */
export function importRatingSnapshots(input){
 required(input?.truncated!==true,'History export is truncated; collect all cursor pages before evaluation');
 const objects=Array.isArray(input)?input:Array.isArray(input?.snapshots)?input.snapshots:Array.isArray(input?.records)?input.records:[input];
 const rows=[],rejected=[];
 for(const wrapper of objects){
  const envelope=wrapper?.snapshot??wrapper;
  const snapshot=envelope?.type==='folly-index'?envelope:envelope?.data;
  if(snapshot?.type!=='folly-index'){rejected.push({reason:'not-a-rating-snapshot'});continue;}
  if(snapshot.schemaVersion!==1||!Number.isInteger(snapshot.version)||!finite(snapshot.firstSeenAt)||!Array.isArray(snapshot.rows)){rejected.push({reason:'invalid-snapshot'});continue;}
  for(const row of snapshot.rows){
   const issueTimes=[snapshot.issuedAt,...Object.values(snapshot.inputs??{}).map(v=>v?.issuedAt)].filter(v=>v!==null&&v!==undefined);
   const retrievalTimes=Object.values(snapshot.inputs??{}).map(v=>v?.retrievedAt).filter(v=>v!==null&&v!==undefined);
   if(!text(row.locationId)||!finite(row.validAt)||!finite(row.score)||row.score<0||row.score>100||row.basis!=='nearshore'||row.heightKind!=='nearshore-significant'){
    rejected.push({reason:'unscored-or-incompatible-row'});continue;
   }
   if(snapshot.firstSeenAt>=row.validAt||issueTimes.some(t=>!finite(t)||t>snapshot.firstSeenAt)||retrievalTimes.some(t=>!finite(t)||t>snapshot.firstSeenAt)){
    rejected.push({reason:'hindsight-or-invalid-timing'});continue;
   }
   rows.push({...row,version:snapshot.version,firstSeenAt:snapshot.firstSeenAt,issuedAt:snapshot.issuedAt??null,snapshotId:snapshot.id??envelope?.id??null,inputSources:snapshot.inputs??{}});
  }
 }
 return {rows,rejected};
}

function summary(matches){
 const gaps=matches.map(m=>m.predictedBand-m.observedQuality);
 const observerGaps=matches.flatMap(m=>m.observerPairGaps);
 return {sessions:matches.length,eventGroups:new Set(matches.map(m=>m.eventGroup)).size,
  meanAbsoluteBandGap:mean(gaps.map(Math.abs)),meanSignedBandGap:mean(gaps),
  exactBandAgreement:mean(gaps.map(n=>n===0?1:0)),observerPairs:observerGaps.length,
  observerMeanAbsoluteDifference:mean(observerGaps),observerExactAgreement:mean(observerGaps.map(n=>n===0?1:0))};
}

export function evaluateFollyObservations({plan,observations,snapshots,now=Date.now()/1000}){
 const {locations,events}=validateObservationPlan(plan);
 required(finite(now),'now must be Unix seconds');required(Array.isArray(observations),'Observations must be an array');
 const imported=importRatingSnapshots(snapshots),rejected=[...imported.rejected],sessions=new Map(),ids=new Set();
 for(const o of observations){
  const reject=reason=>rejected.push({observationId:o?.id??null,reason});
  const event=events.get(o?.eventId),site=locations.get(o?.locationId);
  if(!text(o?.id)||ids.has(o.id)){reject('missing-or-duplicate-observation-id');continue;}ids.add(o.id);
  if(!event||!site||!text(o.sessionId)||!text(o.observerId)||!point(o)){reject('invalid-location-or-session');continue;}
  if(distanceM(o,site)>site.matchRadiusM){reject('observation-outside-declared-location');continue;}
  if(!finite(o.observedAt)||!finite(o.recordedAt)||o.observedAt-plan.sessionMinutes*60<event.startAt||o.observedAt>=event.endAt||o.recordedAt<o.observedAt||o.recordedAt>now||o.recordedAt-o.observedAt>3600){reject('invalid-or-retrospective-observation-time');continue;}
  if(o.durationMinutes!==plan.sessionMinutes){reject('observation-protocol-duration-mismatch');continue;}
  if(o.independent!==true||o.blindToForecast!==true){reject('not-independent-and-blinded');continue;}
  if(o.qualityScale!=='folly-observer-v1'||!Number.isInteger(o.quality)||o.quality<1||o.quality>5||!text(o.boardClass)||!text(o.skillClass)){reject('missing-quality-rubric-or-surfer-assumptions');continue;}
  if(o.height!==null&&o.height!==undefined&&(!['breaking-face-range','nearshore-significant','offshore-significant'].includes(o.height.kind)||o.height.unit!=='m'||!finite(o.height.min)||!finite(o.height.max)||o.height.min<0||o.height.max<o.height.min)){reject('invalid-height-definition');continue;}
  const key=JSON.stringify([event.id,site.id,o.sessionId,o.boardClass,o.skillClass]);
  const session=sessions.get(key)??{event,site,observedAt:o.observedAt,sessionId:o.sessionId,boardClass:o.boardClass,skillClass:o.skillClass,observers:new Map()};
  if(session.observedAt!==o.observedAt){reject('session-time-disagreement');continue;}
  if(session.observers.has(o.observerId)){reject('repeat-observer-in-session');continue;}
  session.observers.set(o.observerId,o);sessions.set(key,session);
 }
 const matches=[],unmatched=[];
 for(const s of sessions.values()){
  if(s.observers.size<2){unmatched.push({sessionId:s.sessionId,reason:'needs-two-independent-observers'});continue;}
  const candidates=imported.rows.filter(r=>r.version===plan.formulaVersion&&r.locationId===s.site.id&&r.firstSeenAt<s.observedAt&&Math.abs(r.validAt-s.observedAt)<=1800&&(r.validAt-r.firstSeenAt)/3600>=plan.leadMinHours&&(r.validAt-r.firstSeenAt)/3600<plan.leadMaxHours);
  // Predeclared deterministic selection: nearest valid hour, then earliest archived issuance.
  candidates.sort((a,b)=>Math.abs(a.validAt-s.observedAt)-Math.abs(b.validAt-s.observedAt)||a.firstSeenAt-b.firstSeenAt||a.version-b.version);
  const f=candidates[0];if(!f){unmatched.push({sessionId:s.sessionId,reason:'no-prospective-forecast-in-lead-window'});continue;}
  const obs=[...s.observers.values()],qualities=obs.map(o=>o.quality),observerPairGaps=[];
  for(let i=0;i<qualities.length;i++)for(let j=i+1;j<qualities.length;j++)observerPairGaps.push(Math.abs(qualities[i]-qualities[j]));
  matches.push({sessionId:s.sessionId,eventId:s.event.id,eventGroup:s.event.eventGroup,split:s.event.split,nourishmentEra:s.event.nourishmentEra,locationId:s.site.id,
   boardClass:s.boardClass,skillClass:s.skillClass,observedAt:s.observedAt,forecastValidAt:f.validAt,forecastFirstSeenAt:f.firstSeenAt,formulaVersion:f.version,leadHours:(f.validAt-f.firstSeenAt)/3600,
   predictedScore:f.score,predictedBand:Math.min(5,Math.floor(f.score/20)+1),observedQuality:median(qualities),observerCount:obs.length,observerPairGaps,
   forecastSnapshotId:f.snapshotId,forecastSources:f.inputSources,
   forecastInputs:Object.fromEntries(['waveM','peakPeriodS','relativeDirectionDeg','windMph','windDirectionDeg','gustMph'].map(key=>[key,finite(f[key])?f[key]:null])),
   heightObservations:obs.filter(o=>o.height).map(o=>({kind:o.height.kind,min:o.height.min,max:o.height.max,unit:'m'})),
   heightComparison:null});
 }
 const strata=new Map();
 for(const match of matches){const key=JSON.stringify([match.formulaVersion,match.split,match.nourishmentEra,match.locationId,match.boardClass,match.skillClass]);const a=strata.get(key)??[];a.push(match);strata.set(key,a);}
 return {schemaVersion:1,planId:plan.planId,formulaVersion:plan.formulaVersion,protocol:plan.protocol,sessionMinutes:plan.sessionMinutes,generatedAt:now,status:matches.length?'descriptive-only':'awaiting-matched-observations',
  note:'No parameters were fitted. Observer quality is subjective; band gaps are exploratory, not evidence of forecast accuracy or safety. Heights with different physical definitions are never compared.',
  eligibleSessions:sessions.size,matchedSessions:matches.length,unmatched,rejected,
  strata:[...strata].map(([key,rows])=>{const [formulaVersion,split,nourishmentEra,locationId,boardClass,skillClass]=JSON.parse(key);return {formulaVersion,split,nourishmentEra,locationId,boardClass,skillClass,...summary(rows)};}),matches};
}
