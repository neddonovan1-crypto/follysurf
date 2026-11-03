// A finite research plan, not an open-ended camera monitoring schedule.
export function dueValidationWindow(env,now=Date.now()) {
  if(!env.PILOT_VALIDATION_PLAN) return null;
  if(env.PILOT_CAPTURE_ONLY!=='true'||env.PILOT_CAMERA!=='tides-pier'||env.PILOT_SAMPLING_MODE!=='stationary'||
     env.PILOT_SURFACE_REVIEW_FROM||env.PILOT_REANALYZE_FROM||env.PILOT_QUALITY_FROM)
    throw new Error('Validation plan must be Tides stationary capture-only');
  const plan=JSON.parse(env.PILOT_VALIDATION_PLAN);
  if(!Array.isArray(plan)||plan.length<1||plan.length>6||!Number.isFinite(now)) throw new Error('Invalid validation plan');
  const seen=new Set();let previousEnd=-Infinity;
  const windows=plan.map(w=>{
    const start=Date.parse(w.start),end=Date.parse(w.end);
    if(Object.keys(w).sort().join()!=='end,id,start'||!/^validation-[a-z0-9-]{8,35}$/.test(w.id)||seen.has(w.id)||
       !Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>15*60000||start<previousEnd)
      throw new Error('Invalid validation window');
    seen.add(w.id);previousEnd=end;
    for(const time of [start,end-1]) {
      const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(time));
      if(hour<10||hour>=16) throw new Error('Validation window outside daylight policy');
    }
    return {...w,start,end};
  });
  if(windows.at(-1).end-windows[0].start>7*86400000) throw new Error('Validation plan exceeds seven days');
  return windows.find(w=>now>=w.start&&now<w.end)??null;
}
