// SWAN v1 format: https://swanmodel.sourceforge.io/online_doc/swanuse/node50.html
// Diagnostic moments over the published frequency range; no spectral tail added.
const finite=Number.isFinite;
const required=(ok,message)=>{if(!ok)throw new TypeError(message);};
const mod=n=>((n%360)+360)%360;
const number=s=>/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?$/.test(s)?Number(s.replace(/[dD]/,'e')):NaN;
export const PERIOD_BANDS=Object.freeze([
 {id:'under6',minPeriodS:0,maxPeriodS:6},
 {id:'6to8',minPeriodS:6,maxPeriodS:8},
 {id:'8to12',minPeriodS:8,maxPeriodS:12},
 {id:'12plus',minPeriodS:12,maxPeriodS:null},
]);
function time(value){
 const m=/^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})(\d{2})$/.exec(value);
 if(!m)return NaN;
 const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`,t=Date.parse(iso);
 return finite(t)&&new Date(t).toISOString().slice(0,19)===iso.slice(0,19)?t/1000:NaN;
}
function directional(m0,x,y){
 if(!(m0>0))return {meanDirectionFromDeg:null,directionalSpreadDeg:null,directionalConcentration:null};
 const r=Math.min(1,Math.hypot(x,y)/m0);
 return {meanDirectionFromDeg:r<1e-8?null:mod(Math.atan2(y,x)*180/Math.PI),
  directionalSpreadDeg:Math.sqrt(2*(1-r))*180/Math.PI,directionalConcentration:r};
}
export function summarizeDirectionalSpectrum(frequencies,directions,density){
 const edges=frequencies.map((f,i)=>i?(f+frequencies[i-1])/2:Math.max(0,f-(frequencies[1]-f)/2));
 edges.push(frequencies.at(-1)+(frequencies.at(-1)-frequencies.at(-2))/2);
 const width=360/directions.length,rad=directions.map(d=>d*Math.PI/180);
 let m0=0,m1=0,m2=0,mMinus1=0,x=0,y=0,peakDensity=-1,peakPeriodS=null;
 const bands=PERIOD_BANDS.map(b=>({...b,varianceM2:0,x:0,y:0}));
 for(let i=0;i<frequencies.length;i++){
  const df=edges[i+1]-edges[i];let frequencyDensity=0;
  for(let j=0;j<directions.length;j++){
   const e=density[i][j]*width,energy=e*df;
   frequencyDensity+=e;m0+=energy;m1+=energy*frequencies[i];m2+=energy*frequencies[i]**2;mMinus1+=energy/frequencies[i];
   x+=energy*Math.cos(rad[j]);y+=energy*Math.sin(rad[j]);
   for(const b of bands){
    const lo=b.maxPeriodS===null?0:1/b.maxPeriodS,hi=b.minPeriodS===0?Infinity:1/b.minPeriodS;
    const overlap=Math.max(0,Math.min(edges[i+1],hi)-Math.max(edges[i],lo)),part=e*overlap;
    b.varianceM2+=part;b.x+=part*Math.cos(rad[j]);b.y+=part*Math.sin(rad[j]);
   }
  }
  if(frequencyDensity>peakDensity){peakDensity=frequencyDensity;peakPeriodS=1/frequencies[i];}
 }
 const meanFrequency=m0>0?m1/m0:null;
 return {varianceM2:m0,spectralHeightM:4*Math.sqrt(m0),peakPeriodS:m0>0?peakPeriodS:null,
  meanPeriodS:m1>0?m0/m1:null,energyPeriodS:m0>0?mMinus1/m0:null,
  frequencyBandwidth:m0>0&&meanFrequency>0?Math.sqrt(Math.max(0,m2/m0-meanFrequency**2))/meanFrequency:null,
  ...directional(m0,x,y),
  bands:bands.map(({x,y,...b})=>({...b,varianceShare:m0>0?b.varianceM2/m0:null,...directional(b.varianceM2,x,y)}))};
}

/** Narrow, checked adapter for the actual CHS AFREQ/NDIR, full-circle, one-point files. */
export function parseSwanSpectrum(text,{cycle,expectedLocation,maxRows=145}={}){
 required(typeof text==='string'&&text.length<=2_000_000,'Spectrum body exceeds limit');
 required(finite(cycle),'An explicit model cycle is required');
 const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('$'));
 let cursor=0;const take=()=>{required(cursor<lines.length,'Truncated SWAN spectrum');return lines[cursor++];};
 const token=()=>take().split(/\s+/)[0];
 const expect=t=>required(token()===t,`Unsupported SWAN field; expected ${t}`);
 const scalar=()=>number(token());
 const count=(min,max)=>{const n=scalar();required(Number.isInteger(n)&&n>=min&&n<=max,'Invalid SWAN dimension');return n;};
 required(/^SWAN\s+1(?:\s|$)/.test(take()),'Unsupported SWAN version');
 expect('TIME');required(scalar()===1,'Unsupported SWAN time coding');
 expect('LONLAT');required(scalar()===1,'Expected one spectral location');
 const coords=take().split(/\s+/).slice(0,2).map(number);
 required(coords.length===2&&coords.every(finite)&&coords[0]>=-180&&coords[0]<=360&&Math.abs(coords[1])<=90,'Invalid spectral coordinates');
 const longitude=coords[0]>180?coords[0]-360:coords[0],latitude=coords[1];
 if(expectedLocation)required(Math.abs(latitude-expectedLocation.latitude)<0.005&&Math.abs(longitude-expectedLocation.longitude)<0.005,'Unexpected spectral location');
 expect('AFREQ');const nf=count(2,128),frequencies=Array.from({length:nf},scalar);
 required(frequencies.every((f,i)=>finite(f)&&f>0&&f<=2&&(!i||f>frequencies[i-1])),'Invalid spectral frequencies');
 expect('NDIR');const nd=count(4,144),directions=Array.from({length:nd},scalar);
 required(directions.every(d=>finite(d)&&d>=-360&&d<=360),'Invalid spectral directions');
 const normalized=directions.map(mod),sorted=[...normalized].sort((a,b)=>a-b);
 required(sorted.every((d,i)=>Math.abs(mod(sorted[(i+1)%nd]-d)-360/nd)<0.01),'Only complete uniformly spaced directional grids are supported');
 expect('QUANT');required(scalar()===1,'Unsupported spectral quantities');expect('VaDens');expect('m2/Hz/degr');
 const missing=scalar();required(finite(missing)&&missing<0,'Invalid spectral missing-value marker');
 const rows=[];let previous=-Infinity;
 while(cursor<lines.length){
  required(rows.length<maxRows,'Too many spectral time steps');
  const t=time(token());required(finite(t)&&t>previous&&t>=cycle&&t<=cycle+144*3600&&(!rows.length?t===cycle:true),'Invalid spectral time');previous=t;
  const kind=token();
  if(kind==='NODATA'){rows.push({t,status:'missing',features:null});continue;}
  if(kind==='ZERO'){rows.push({t,status:'zero',features:summarizeDirectionalSpectrum(frequencies,normalized,frequencies.map(()=>Array(nd).fill(0)))});continue;}
  required(kind==='FACTOR','Unknown spectral block');const factor=scalar();required(finite(factor)&&factor>0&&factor<1e6,'Invalid spectral scale');
  let hasMissing=false;
  const density=Array.from({length:nf},()=>{
   const values=take().split(/\s+/).map(number);required(values.length===nd,'Truncated spectral row');
   return values.map(v=>{if(v===missing){hasMissing=true;return 0;}required(finite(v)&&v>=0&&v*factor<1e6,'Invalid variance density');return v*factor;});
  });
  // Never turn undefined cells into a smaller wave or a false direction estimate.
  rows.push({t,status:hasMissing?'missing':'modeled',features:hasMissing?null:summarizeDirectionalSpectrum(frequencies,normalized,density)});
 }
 required(rows.length>0,'Empty spectral forecast');
 return {latitude,longitude,frequenciesHz:frequencies,directionsFromDeg:normalized,frequencyType:'absolute',directionType:'degrees true, from',
  densityUnit:'m²/Hz/degree',integration:'midpoint frequency cells; full-circle direction sum; no tail extrapolation',rows};
}
