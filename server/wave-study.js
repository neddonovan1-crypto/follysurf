// Offline candidates only. Nothing here is imported by the production rating.
import {evaluateFollyObservations} from './calibration.js';
import {evaluateOutlook} from '../research/models/folly-index-v3.js';
const finite=Number.isFinite;
const requireValue=(ok,message)=>{if(!ok)throw new TypeError(message);};
const rad=n=>n*Math.PI/180;
const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
export const WAVE_CANDIDATE_SET='incoming-waves-v1';
const allowedPoints=['CHSHB','NAVB6','41004'];
const groupCount=rows=>new Set(rows.map(r=>r.eventGroup)).size;
function weights(rows){const counts=new Map();for(const r of rows)counts.set(r.eventGroup,(counts.get(r.eventGroup)??0)+1);return rows.map(r=>1/counts.get(r.eventGroup));}
function spectralExports(input){
 requireValue(input?.truncated!==true,'Complete all spectral history pages before evaluating');
 const objects=Array.isArray(input)?input:input?.snapshots??[input];
 const records=[];
 for(const wrapper of objects){
  requireValue(wrapper?.truncated!==true,'Truncated spectral history page');
  const s=wrapper?.snapshot??wrapper;
  if(s?.source!=='nwpsSpectra'||s.schemaVersion!==1||s.data?.scope!=='regional-model-points'||s.data?.scoreEligible!==false||s.status!=='fresh')continue;
  if(!finite(s.retrievedAt)||!finite(s.recordedAt)||!finite(s.issuedAt)||s.issuedAt!==s.data?.cycle||s.issuedAt>s.retrievedAt||s.retrievedAt>s.recordedAt)continue;
  records.push(s);
 }
 return records;
}
function features(r,s){
 const f=r.forecastInputs,{waveM:h,peakPeriodS:t,windMph:v,windDirectionDeg:d,gustMph:g,relativeDirectionDeg:a}=f??{};
 if(![h,t,v,d,g,a].every(finite)||h<0||t<=0||v<0||g<0||g+1<v||Math.abs(a)>90)return null;
 const effective=Math.max(v,.7*g),onshore=(1-Math.cos(rad(d-315)))/2;
 const b=s?.bands;if(!Array.isArray(b)||!finite(s.meanDirectionFromDeg))return null;
 const shares=['6to8','8to12','12plus'].map(id=>b.find(x=>x.id===id)?.varianceShare);
 const spectrum=[s.spectralHeightM,s.energyPeriodS,s.frequencyBandwidth,s.directionalConcentration,
  s.directionalConcentration*Math.sin(rad(s.meanDirectionFromDeg)),s.directionalConcentration*Math.cos(rad(s.meanDirectionFromDeg)),...shares];
 if(!spectrum.every(finite)||shares.some(n=>n<0||n>1)||s.directionalConcentration<0||s.directionalConcentration>1)return null;
 return {bulk:[h,t,t*t,effective,onshore,effective*onshore],angle:[Math.sin(rad(a)),Math.cos(rad(a)),t*Math.sin(rad(a)),t*Math.cos(rad(a))],spectrum};
}
export function buildWaveStudyRows({plan,observations,snapshots,spectra,now=Date.now()/1000}){
 const spec=plan?.waveStudy;
 requireValue(spec?.candidateSet===WAVE_CANDIDATE_SET&&allowedPoints.includes(spec.referencePointId),'Freeze an incoming-waves-v1 plan and one regional reference point');
 requireValue([3,4].includes(plan.formulaVersion),'This candidate set requires archived v3 or v4 inputs, evaluated separately');
 requireValue(Array.isArray(spec.ridgePenalties)&&spec.ridgePenalties.length>0&&spec.ridgePenalties.length<=8&&spec.ridgePenalties.every(n=>finite(n)&&n>0),'Predeclare positive ridge penalties');
 requireValue(Number.isInteger(spec.minDevelopmentEvents)&&spec.minDevelopmentEvents>=3&&Number.isInteger(spec.minHoldoutEvents)&&spec.minHoldoutEvents>=2,'Predeclare event-count gates (at least 3 development and 2 holdout)');
 const evaluated=evaluateFollyObservations({plan,observations,snapshots,now}),records=spectralExports(spectra),rows=[],excluded=[];
 for(const m of evaluated.matches){
  const cycle=m.forecastSources?.nwps?.issuedAt;
  const candidates=[];
  for(const s of records){
   // Same cycle, exact valid hour, and available before the original rating.
   // No older forecast substitution, interpolation, or retrospective backfill.
   if(s.issuedAt!==cycle||s.recordedAt>m.forecastFirstSeenAt||s.retrievedAt>m.forecastFirstSeenAt)continue;
   const point=s.data.points?.find(p=>p.id===spec.referencePointId);
   if(!finite(point?.retrievedAt)||point.retrievedAt>s.retrievedAt)continue;
   const row=point.rows?.find(r=>r.t===m.forecastValidAt&&r.status==='modeled');
   if(row)candidates.push({snapshot:s,point,row});
  }
  candidates.sort((a,b)=>a.snapshot.recordedAt-b.snapshot.recordedAt||String(a.snapshot.id).localeCompare(String(b.snapshot.id)));
  const chosen=candidates[0],values=chosen?features(m,chosen.row.features):null;
  if(!values){excluded.push({sessionId:m.sessionId,eventGroup:m.eventGroup,reason:chosen?'missing-candidate-inputs':'no-prospective-same-cycle-spectrum'});continue;}
  rows.push({...m,featureSets:values,spectralSource:{snapshotId:chosen.snapshot.id,referencePointId:chosen.point.id,latitude:chosen.point.latitude,longitude:chosen.point.longitude,
   cycle,validAt:chosen.row.t,retrievedAt:chosen.point.retrievedAt,recordedAt:chosen.snapshot.recordedAt,sourceUrl:chosen.point.sourceUrl}});
 }
 return {rows,excluded,observationEvaluation:evaluated};
}
const vector=(r,kind)=>[...r.featureSets.bulk,...(kind.includes('angle')?r.featureSets.angle:[]),...(kind.includes('spectrum')?r.featureSets.spectrum:[])];
function solve(a,b){
 const m=a.map((r,i)=>[...r,b[i]]),n=b.length;
 for(let c=0;c<n;c++){
  let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
  requireValue(Math.abs(m[pivot][c])>1e-12,'Singular development fit');[m[c],m[pivot]]=[m[pivot],m[c]];
  const v=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=v;
  for(let r=0;r<n;r++)if(r!==c){const factor=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=factor*m[c][k];}
 }
 return m.map(r=>r[n]);
}
function ridge(train,kind,penalty){
 const w=weights(train),total=w.reduce((a,b)=>a+b),x=train.map(r=>vector(r,kind)),p=x[0].length;
 const centers=Array.from({length:p},(_,j)=>x.reduce((s,r,i)=>s+w[i]*r[j],0)/total);
 const scales=centers.map((c,j)=>Math.sqrt(x.reduce((s,r,i)=>s+w[i]*(r[j]-c)**2,0)/total)||1);
 const design=x.map(r=>[1,...r.map((v,j)=>(v-centers[j])/scales[j])]);
 const a=Array.from({length:p+1},()=>Array(p+1).fill(0)),b=Array(p+1).fill(0);
 for(let i=0;i<train.length;i++)for(let j=0;j<=p;j++){
  b[j]+=w[i]*design[i][j]*train[i].observedQuality/total;
  for(let k=0;k<=p;k++)a[j][k]+=w[i]*design[i][j]*design[i][k]/total;
 }
 for(let j=1;j<=p;j++)a[j][j]+=penalty;
 const coefficients=solve(a,b);
 return {kind,penalty,centers,scales,coefficients,predict:r=>clamp(coefficients[0]+vector(r,kind).reduce((s,v,j)=>s+coefficients[j+1]*(v-centers[j])/scales[j],0),1,5)};
}
function meanError(rows,predictions){const w=weights(rows),total=w.reduce((s,v)=>s+v,0);return total?rows.reduce((s,r,i)=>s+w[i]*Math.abs(predictions[i]-r.observedQuality),0)/total:null;}
function choosePenalty(train,kind,penalties){
 const groups=[...new Set(train.map(r=>r.eventGroup))];
 const cv=penalties.map(penalty=>{
  const predictions=new Map();
  for(const event of groups){const fit=ridge(train.filter(r=>r.eventGroup!==event),kind,penalty);for(const r of train.filter(r=>r.eventGroup===event))predictions.set(r,fit.predict(r));}
  return {penalty,developmentEventCvMAE:meanError(train,train.map(r=>predictions.get(r)))};
 }).sort((a,b)=>a.developmentEventCvMAE-b.developmentEventCvMAE||a.penalty-b.penalty);
 return {...ridge(train,kind,cv[0].penalty),crossValidation:cv};
}
function candidateScore(row,kind){
 if(kind===`v${row.formulaVersion}`)return row.predictedScore;
 const f=row.forecastInputs,e=evaluateOutlook({nearshore:{waveM:f.waveM,peakPeriodS:f.peakPeriodS},wind:f.windMph,windDir:f.windDirectionDeg,gust:f.gustMph,sourceFresh:true});
 if(!finite(e.score))return NaN;
 const factor=kind==='no-period'?1:(()=>{const x=clamp((f.peakPeriodS-3)/((kind==='plateau8'?8:10)-3));return x*x*(3-2*x);})();
 return 100*e.components.find(c=>c.id==='size').value*factor*e.components.find(c=>c.id==='wind').value;
}
// Weighted PAVA: a scale-only control preserves score order and is fitted on development only.
function monotone(train,kind){
 const w=weights(train),ordered=train.map((r,i)=>({x:candidateScore(r,kind),y:r.observedQuality,w:w[i]})).sort((a,b)=>a.x-b.x),points=[];
 for(const r of ordered){const last=points.at(-1);if(last?.lo===r.x){last.weight+=r.w;last.sum+=r.y*r.w;}else points.push({lo:r.x,hi:r.x,weight:r.w,sum:r.y*r.w});}
 const blocks=[];
 for(const p of points){blocks.push(p);while(blocks.length>1&&blocks.at(-2).sum/blocks.at(-2).weight>blocks.at(-1).sum/blocks.at(-1).weight){const b=blocks.pop(),a=blocks.pop();blocks.push({lo:a.lo,hi:b.hi,weight:a.weight+b.weight,sum:a.sum+b.sum});}}
 return {kind,blocks,predict:r=>{const x=candidateScore(r,kind),b=blocks.find(b=>x<=b.hi)??blocks.at(-1);return b.sum/b.weight;}};
}
function metrics(rows,predictions){
 const w=weights(rows);let comparableWeight=0,concordantWeight=0,pairs=0;
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  if(rows[i].eventGroup===rows[j].eventGroup||rows[i].observedQuality===rows[j].observedQuality)continue;
  const weight=w[i]*w[j],difference=(predictions[i]-predictions[j])*(rows[i].observedQuality-rows[j].observedQuality);
  comparableWeight+=weight;concordantWeight+=weight*(difference>0?1:difference===0?.5:0);pairs++;
 }
 return {sessions:rows.length,eventGroups:groupCount(rows),eventWeightedMAE:meanError(rows,predictions),crossEventRankConcordance:comparableWeight?concordantWeight/comparableWeight:null,comparableSessionPairs:pairs};
}
export function evaluateWaveStudy(args){
 const {rows,excluded,observationEvaluation}=buildWaveStudyRows(args),spec=args.plan.waveStudy;
 const groups=new Map();
 for(const r of rows){const key=JSON.stringify([r.locationId,r.boardClass,r.skillClass,r.nourishmentEra]);const group=groups.get(key)??[];group.push(r);groups.set(key,group);}
 const strata=[];
 for(const [key,all] of groups){
  const [locationId,boardClass,skillClass,nourishmentEra]=JSON.parse(key),development=all.filter(r=>r.split==='development'),holdout=all.filter(r=>r.split==='holdout');
  const base={locationId,boardClass,skillClass,nourishmentEra,developmentSessions:development.length,holdoutSessions:holdout.length,developmentEvents:groupCount(development),holdoutEvents:groupCount(holdout)};
  if(base.developmentEvents<spec.minDevelopmentEvents||base.holdoutEvents<spec.minHoldoutEvents){strata.push({...base,status:'awaiting-independent-events',models:[]});continue;}
  const fits=[...[`v${args.plan.formulaVersion}`,'plateau8','plateau10','no-period'].map(k=>monotone(development,k)),...['bulk','bulk-angle','bulk-spectrum','bulk-angle-spectrum'].map(k=>choosePenalty(development,k,spec.ridgePenalties))];
  const models=fits.map(fit=>{
   const predicted=holdout.map(r=>fit.predict(r)),{predict,...parameters}=fit;
   return {candidate:fit.kind,parameters,holdout:metrics(holdout,predicted),predictions:holdout.map((r,i)=>({sessionId:r.sessionId,eventGroup:r.eventGroup,observedQuality:r.observedQuality,predictedQuality:predicted[i]}))};
  });
  strata.push({...base,status:'experimental-comparison',models});
 }
 return {schemaVersion:1,candidateSet:WAVE_CANDIDATE_SET,planId:args.plan.planId,referencePointId:spec.referencePointId,
  status:strata.some(s=>s.models.length)?'experimental-comparison':'awaiting-matched-observations',
  note:'No production score changes. All candidates use identical complete sessions. Scaling, normalization and penalty selection use development events only. Holdout inspection consumes that holdout; no automatic winner or validation claim.',
  matchedSessions:rows.length,excluded,observationRejections:observationEvaluation.rejected,unmatchedObservations:observationEvaluation.unmatched,strata,
  matchedInputs:rows.map(({observerPairGaps,heightObservations,...row})=>row)};
}
