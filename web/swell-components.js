// MFWAM's provider-defined primary/secondary swell partitions stay together.
// They are offshore model forecasts, not directional bands or beach observations.
export const SWELL_MODEL='meteofrance_wave';
export const SWELL_MAX_AGE=6*3600;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function swellComponentsURL(){
 return 'https://marine-api.open-meteo.com/v1/marine?'+new URLSearchParams({latitude:32.64,longitude:-79.91,models:SWELL_MODEL,forecast_days:16,timeformat:'unixtime',timezone:'GMT',cell_selection:'sea',hourly:'swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction'});
}
export function normalizeSwellComponents(data,{retrievedAt=Date.now()/1000}={}){
 const h=data?.hourly,u=data?.hourly_units;
 if(!finite(retrievedAt)||!finite(data?.latitude)||!finite(data?.longitude)||!Array.isArray(h?.time)||!h.time.length||h.time.length>400||u?.time!=='unixtime')throw Error('Invalid swell forecast');
 const prefixes=['swell_wave','secondary_swell_wave'];
 for(const prefix of prefixes)for(const [field,unit] of [['height','m'],['period','s'],['direction','°']]){
  const key=prefix+'_'+field;
  if(u[key]!==unit||!Array.isArray(h[key])||h[key].length!==h.time.length)throw Error('Invalid swell units or coverage');
 }
 let previous=-Infinity;
 const rows=h.time.map((t,i)=>{
  if(!finite(t)||t<=previous)throw Error('Invalid swell time');previous=t;
  const component=prefix=>{
   const height=h[prefix+'_height'][i],period=h[prefix+'_period'][i],direction=h[prefix+'_direction'][i];
   return {heightM:finite(height)&&height>=0?height:null,periodS:finite(period)&&period>0?period:null,directionFromDeg:finite(direction)&&direction>=0&&direction<=360?direction%360:null};
  };
  return {t,primary:component(prefixes[0]),secondary:component(prefixes[1])};
 });
 if(!rows.some(r=>r.t+3600>retrievedAt&&r.primary.heightM!==null))throw Error('No current swell forecast');
 return {schemaVersion:1,status:'fresh',model:SWELL_MODEL,provider:'Open-Meteo',sourceUrl:swellComponentsURL(),retrievedAt,issuedAt:null,latitude:data.latitude,longitude:data.longitude,units:{height:'m',period:'s (model mean)',direction:'degrees true, from'},rows};
}
export function currentSwellComponents(source,at,checkedAt=at){
 if(source?.schemaVersion!==1||source.model!==SWELL_MODEL||source.status!=='fresh'||!finite(source.retrievedAt)||!finite(at)||!finite(checkedAt)||checkedAt<source.retrievedAt||checkedAt-source.retrievedAt>SWELL_MAX_AGE)return null;
 return source.rows?.find(r=>finite(r.t)&&r.t<=at&&at<r.t+3600)??null;
}
