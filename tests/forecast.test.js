import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNwsSurf,parseSurfHeight,parseNwps,parseBuoy,sourceFreshness,easternMidnight,nwpsCycles,nwpsUrl,fetchNwsSurf,fetchNwps,fetchBuoy,collectForecastSources} from '../server/forecast.js';

const epoch=s=>Date.parse(s)/1000;
const now=epoch('2026-10-21T00:45:00Z');
const cycle=epoch('2026-10-20T18:00:00Z');
const product={id:'12345678-1234-1234-1234-123456789abc',issuanceTime:'2026-10-21T00:00:00Z',productText:`440
FZUS52 KCHS 210000
SRFCHS
Surf Zone Forecast
National Weather Service Charleston SC
800 PM EDT Tue Oct 20 2026

SCZ150-211400-
Charleston-
Including the beaches of Cape Romain, Isle of Palms,
Sullivans Island, Folly Beach, and Kiawah Island
800 PM EDT Tue Oct 20 2026

.WEDNESDAY...
Rip Current Risk*...........Low.
Surf Height.................2 to 3 feet.
Weather.....................Sunny.
Tides...
   Isle of Palms............Low at 10:02 AM EDT.

.THURSDAY...
Rip Current Risk*...........Low.
Surf Height.................2 to 3 feet.
.EXTENDED...
.FRIDAY...Surf height 2 to 3 feet. Sunny.
.SATURDAY...Surf height 2 to 3 feet. Breezy.
.SUNDAY...Surf height 3 to 4 feet. Breezy.
&&
Rip Current Risk Category
* High Risk - Life-threatening rip currents are likely.
$$
SCZ148-149-151-211400-
Beaufort-Coastal Colleton-Coastal Jasper-
.WEDNESDAY...
Rip Current Risk*...........High.
Surf Height.................6 to 8 feet.
$$`};

const nwps=`% Run:2018
% DATE Xp Yp Prob Hs pp mwdsn tide event
20261021.0000 280.0620 32.6489 30 1.20 8.0 -20 0.3 0
20261021.0100 280.0620 32.6489 30 1.40 9.0 -22 0.5 0
20261021.0200 280.0620 32.6489 30 0.00 8.0 -22 0.5 0
20261021.0300 280.0620 32.6489 30 1.40 0.0 -22 0.5 0
20261021.0100 280.0970 32.6677 30 1.50 9.0 30 0.5 0
20261021.0100 279.1000 33.0000 30 9.99 9.0 30 0.5 0
20260231.0100 280.0620 32.6489 30 9.99 9.0 30 0.5 0
20261021.0100 280.0630 32.6499 30 9.99 9.0 30 0.5 0
`;
const buoy=`#YY  MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
#yr  mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft
2026 10 21 00 40 360 9.0 11.0 MM MM MM MM 1020.2 23.6 25.9 9.8 MM MM MM
2026 10 21 00 20 10 9.0 11.0 1.6 7 5.0 67 1020.2 23.6 25.8 9.6 MM MM MM
2026 10 21 00 10 360 9.0 11.0 1.6 MM 5.0 67 1020.1 23.6 25.8 9.8 MM MM MM
2026 10 20 23 50 360 8.0 10.0 1.6 7 5.0 67 1020.0 23.6 25.8 10.4 MM MM MM
2026 10 21 07 00 360 8.0 10.0 8.6 7 5.0 67 1020.0 23.6 25.8 10.4 MM MM MM
2026 02 31 00 00 360 8.0 10.0 8.6 7 5.0 67 1020.0 23.6 25.8 10.4 MM MM MM
`;
const response=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status});

test('NWS uses Charleston segment, Eastern issue day and distinct extended-day risks',()=>{
  const data=parseNwsSurf(product);
  assert.equal(data.issuedAt,epoch(product.issuanceTime));
  assert.equal(data.zone,'SCZ150');
  assert.equal(data.periods.length,5);
  assert.equal(data.periods[0].day,'2026-10-21');
  assert.equal(data.periods[0].surfMaxFt,3);
  assert.equal(data.periods[0].ripRisk,'Low');
  assert.equal(data.periods[2].ripRisk,null,'never carry a prior-day risk into extended forecast');
  assert.equal(data.periods.at(-1).day,'2026-10-25');
  assert.ok(!data.periods.some(p=>p.surfMaxFt===8),'never copy another county');
});

test('NWS parses range/group zone headers and human issue text without confusing midnight UTC',()=>{
  const text=product.productText.replace('SCZ150-211400-','SCZ148-149-150-\n151-211400-').replace('.WEDNESDAY...','.TONIGHT...');
  const data=parseNwsSurf(text.replaceAll('\n','\r\n'));
  assert.equal(data.periods[0].day,'2026-10-20');
  assert.equal(data.periods[0].timeOfDay,'night');
  assert.equal(data.issuedAt,epoch('2026-10-21T00:00:00Z'));
  assert.ok(parseNwsSurf(text.replace('SCZ148-149-150-\n151-211400-','SCZ148>151-211400-')));
  assert.equal(parseNwsSurf(text.replace('SCZ148-149-150-\n151-211400-','SCZ148-149-151-211400-')),null);
});

test('NWS calendar intervals observe 25-hour Eastern daylight-saving transition',()=>{
  const text=product.productText.replace('800 PM EDT Tue Oct 20 2026','800 PM EDT Sat Oct 31 2026').replace('.WEDNESDAY...','.SUNDAY...');
  const data=parseNwsSurf({productText:text,issuanceTime:'2026-11-01T00:00:00Z'});
  assert.equal(data.periods[0].day,'2026-11-01');
  assert.equal(data.periods[0].end-data.periods[0].start,25*3600);
  assert.equal(easternMidnight('2026-03-09')-easternMidnight('2026-03-08'),23*3600);
});

test('surf wording preserves approximate/upper-bound semantics and missing values',()=>{
  assert.deepEqual(Object.values(parseSurfHeight('Surf Height......Around 1 foot.')).slice(0,2),[1,1]);
  assert.equal(parseSurfHeight('Surf Height......Around 1 foot.').surfQualifier,'around');
  assert.equal(parseSurfHeight('Surf height less than 1 foot.').surfQualifier,'less-than');
  assert.equal(parseSurfHeight('Surf height 1 foot or less.').surfMinFt,0);
  assert.equal(parseSurfHeight('Surf height 2.5 to 3.5 feet.').surfMinFt,2.5);
  assert.equal(parseSurfHeight('Surf height not available.').surfMaxFt,null);
  assert.equal(parseSurfHeight('Surf height 8 to 2 feet.').surfMaxFt,null);
});

test('NWPS selects actual Folly contour points, preserves source semantics, rejects ambiguous zeros',()=>{
  const data=parseNwps(nwps,{cycle});
  assert.equal(data.points.length,2);
  const point=data.points.find(p=>p.id==='pier');
  assert.ok(Math.abs(point.longitude+79.938)<1e-8);
  assert.equal(point.rows[0].t,epoch('2026-10-21T00:00:00Z'));
  assert.equal(point.rows[0].day,'2026-10-20');
  assert.equal(point.rows[1].waveM,1.4,'closest point cannot be overwritten by a neighboring coordinate');
  assert.equal(point.rows[0].relativeDirectionDeg,-20);
  assert.equal(data.directionType,'relative-to-shore-normal');
  assert.equal(data.contourDepthM,5);
  assert.equal(point.rows[2].waveM,null);
  assert.equal(point.rows[3].waveM,null);
  assert.equal(parseNwps('% header only',{cycle}),null);
});

test('NWPS fallback probes completed cycles across UTC date boundaries in a bounded sequence',async()=>{
  const calls=[];
  const result=await fetchNwps({now,fetchImpl:async url=>{calls.push(url);return url.includes('/chs/00/')?response('not ready',404):response(nwps);}});
  assert.equal(result.status,'fresh');
  assert.equal(result.data.cycle,cycle);
  assert.equal(calls.length,2);
  assert.match(calls[0],/er\.20261021\/chs\/00\/CG1\/nwps\.t00z/);
  assert.match(calls[1],/er\.20261020\/chs\/18\/CG1\/nwps\.t18z/);
  assert.equal(nwpsCycles(now,99).length,8);
  assert.throws(()=>nwpsUrl(cycle+60));
});

test('NWPS probes only two cycles at once and prefers the newest usable cycle over the fastest response',async()=>{
  let active=0,maximum=0,releaseNewest;
  const started=[];
  const newest=nwpsCycles(now)[0];
  const task=fetchNwps({now,fetchImpl:async url=>{
    active++;maximum=Math.max(maximum,active);started.push(url);
    if(url===nwpsUrl(newest))await new Promise(resolve=>{releaseNewest=resolve;});
    active--;
    return response(nwps);
  }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started.length,2,'only the first pair is requested while a newer cycle is pending');
  releaseNewest();
  const result=await task;
  assert.equal(maximum,2);
  assert.equal(result.data.cycle,newest,'response timing must not choose an older forecast');
  assert.equal(started.length,2,'a usable pair stops further probes');
});

test('NDBC chooses latest measured waves independently from wind and retains missing period',()=>{
  const data=parseBuoy(buoy,{now});
  assert.equal(data.rows.length,4,'future and invalid-date rows are excluded');
  assert.equal(data.latestWind.t,epoch('2026-10-21T00:40:00Z'));
  assert.equal(data.latestWave.t,epoch('2026-10-21T00:20:00Z'));
  assert.equal(data.latestWave.waveM,1.6);
  assert.equal(data.latestWave.dominantPeriodS,7);
  assert.equal(data.rows[2].dominantPeriodS,null);
  assert.equal(data.rows[0].waveM,null);
  assert.equal(data.latestWater.waterC,25.9);
});

test('retrieval never makes old guidance current; wave display expires independently from archive',async()=>{
  assert.equal(sourceFreshness('nws',now-25*3600,now),'stale');
  assert.equal(sourceFreshness('nws',now-49*3600,now),'unavailable');
  assert.equal(sourceFreshness('nwps',now-19*3600,now),'stale');
  assert.equal(sourceFreshness('buoy',now-7*3600,now),'unavailable');
  assert.equal(sourceFreshness('buoy',now+600,now),'unavailable');
  const result=await fetchBuoy({now:now+7*3600,fetchImpl:async()=>response(buoy.replace(/^2026 10 21 07.*$/m,''))});
  assert.equal(result.status,'unavailable');
  assert.equal(result.data.latestWave,null);
  assert.ok(result.data.rows.some(r=>r.waveM===1.6),'past observations retained for verification, never current display');
});

test('NWS picks newest valid product and isolates malformed upstream IDs',async()=>{
  const calls=[];
  const result=await fetchNwsSurf({now,fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/CHS'))return response({'@graph':[
      {id:product.id,issuanceTime:product.issuanceTime},
      {id:'../../elsewhere',issuanceTime:'2026-10-21T00:10:00Z'}
    ]});
    return response(product);
  }});
  assert.equal(result.status,'fresh');
  assert.equal(result.data.periods[0].surfMaxFt,3);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.startsWith('https://api.weather.gov/')));
});

test('one failed NOAA source cannot erase other independent sources',async()=>{
  const data=await collectForecastSources({now,nwpsAttempts:1,fetchImpl:async url=>{
    if(url.includes('api.weather.gov'))return response('outage',503);
    if(url.includes('ndbc.noaa.gov'))return response(buoy);
    return response(nwps.replaceAll('20261021.0000','20261021.0100'));
  }});
  assert.equal(data.nws.status,'unavailable');
  assert.equal(data.buoy.status,'fresh');
  assert.equal(data.nwps.status,'fresh');
});

test('unusable NOAA responses release their bodies before probing fallback cycles',async()=>{
 const cancelled=[];
 const result=await fetchNwps({now,fetchImpl:async url=>({ok:false,status:404,body:{cancel:async()=>{cancelled.push(url);}}})});
 assert.equal(result.status,'unavailable');
 assert.equal(cancelled.length,5,'all unsuccessful responses release their connection');
});
