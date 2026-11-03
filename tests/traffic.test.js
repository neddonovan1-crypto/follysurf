import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getTraffic,parseTrafficMatrix,durationSeconds,roundedEta,congestionFor,trafficIsFresh,selectTomTomPosition,TRAFFIC_ORIGINS} from '../server/traffic.js';

const clock=()=>Date.parse('2026-10-21T12:00:00Z');
const element=(originIndex,duration='1200s',staticDuration='1100s',extra={})=>({originIndex,destinationIndex:0,status:{},condition:'ROUTE_EXISTS',duration,staticDuration,distanceMeters:20000,...extra});
const respond=data=>async()=>({ok:true,json:async()=>data});

test('no key means no network, no estimates, and no fabricated baseline',async()=>{
  const result=await getTraffic({apiKey:'',now:clock,fetchImpl:()=>{throw Error('must not request');}});
  assert.equal(result.status,'not_configured');
  assert.ok(result.routes.every(r=>r.durationSeconds===null&&r.baselineSeconds===null&&r.congestion==='unknown'));
  assert.equal(result.retrievedAt,null);
});

test('only the fixed destination allowlist can be queried',async()=>{
  let calls=0;
  await assert.rejects(getTraffic({destination:'https://attacker.invalid/',apiKey:'secret',fetchImpl:()=>{calls++;}}),RangeError);
  await assert.rejects(getTraffic({destination:'__proto__',apiKey:'secret',fetchImpl:()=>{calls++;}}),RangeError);
  assert.equal(calls,0);
});

test('one matrix request contains fixed endpoints, explicit traffic settings and safe field mask',async()=>{
  let request;
  const result=await getTraffic({destination:'washout',apiKey:'server-key',now:clock,fetchImpl:async(url,options)=>{
    request={url,options,body:JSON.parse(options.body)};
    return {ok:true,json:async()=>[element(2),element(0),element(1)]};
  }});
  assert.equal(result.status,'ready');
  assert.equal(request.url,'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
  assert.equal(request.options.headers['X-Goog-Api-Key'],'server-key');
  assert.ok(request.options.headers['X-Goog-FieldMask'].includes('status'));
  assert.ok(request.options.headers['X-Goog-FieldMask'].includes('fallbackInfo'));
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.body.origins.length,3);
  assert.equal(request.body.destinations.length,1);
  assert.equal(request.body.routingPreference,'TRAFFIC_AWARE_OPTIMAL');
  assert.equal(request.body.departureTime,undefined);
  assert.equal(JSON.stringify(result).includes('server-key'),false);
});

test('unordered matrix and individual failures cannot shift ETAs between neighborhoods',()=>{
  const result=parseTrafficMatrix([element(2,'2400s','1800s'),element(0,'1200s','1100s'),element(1,'2000s','1500s',{status:{code:5}})],'pier');
  assert.deepEqual(result.map(r=>r.id),['downtown','mount-pleasant','west-ashley']);
  assert.equal(result[0].durationSeconds,1200);
  assert.equal(result[1].durationSeconds,null);
  assert.equal(result[2].durationSeconds,2400);
  assert.equal(result[2].congestion,'yellow');
});

test('duplicates, unavailable routes and traffic fallback are unavailable independently',()=>{
  const result=parseTrafficMatrix([element(0),element(0),element(1,'1000s','900s',{condition:'ROUTE_NOT_FOUND'}),element(2,'1000s','900s',{fallbackInfo:{routingMode:'TRAFFIC_UNAWARE'}})],'pier');
  assert.deepEqual(result.map(r=>r.reason),['ambiguous_response','route_unavailable','traffic_fallback']);
  assert.ok(result.every(r=>r.etaMinutes===null));
});

test('omitted protobuf zero indices work and a missing baseline does not produce a green rating',()=>{
  const result=parseTrafficMatrix([{condition:'ROUTE_EXISTS',duration:'1200s'},element(9)],'pier');
  assert.equal(result[0].durationSeconds,1200);
  assert.equal(result[0].congestion,'unknown');
  assert.equal(result[0].baselineSeconds,null);
  assert.equal(result[1].reason,'route_missing');
});

test('durations reject missing and malformed values, while display bands contain the ETA',()=>{
  for(const value of [null,'','MM','NaNs','-30s','0s','12','Infinitys'])assert.equal(durationSeconds(value),null);
  assert.equal(durationSeconds('1021.5s'),1021.5);
  assert.deepEqual(roundedEta(1021.5),{low:15,high:20});
  assert.deepEqual(roundedEta(1200),{low:20,high:25});
  assert.equal(roundedEta(null),null);
});

test('traffic colors compare excess duration against the provider baseline',()=>{
  assert.equal(congestionFor(1140,1200),'green');
  assert.equal(congestionFor(1439,1200),'green');
  assert.equal(congestionFor(1440,1200),'yellow');
  assert.equal(congestionFor(1800,1200),'red');
  assert.equal(congestionFor(4500,3600),'red');
  assert.equal(congestionFor(1200,null),'unknown');
});

test('partial response keeps successful routes and explicit expiry prevents stale live labels',async()=>{
  const result=await getTraffic({apiKey:'x',now:clock,fetchImpl:respond([element(1)])});
  assert.equal(result.status,'partial');
  assert.equal(trafficIsFresh(result,clock()),true);
  assert.equal(trafficIsFresh(result,clock()+599999),true);
  assert.equal(trafficIsFresh(result,clock()+600000),false);
  assert.equal(trafficIsFresh(result,clock()-1),false);
  assert.equal(trafficIsFresh({...result,status:'unavailable'},clock()),false);
});

test('provider failures and malformed payloads return generic errors without stale numbers or key leakage',async()=>{
  for(const fetchImpl of [async()=>{throw Error('secret-key in URL');},async()=>({ok:false,status:403,json:async()=>({message:'secret-key'})}),respond({error:'secret-key'})]){
    const result=await getTraffic({apiKey:'secret-key',now:clock,fetchImpl});
    assert.equal(result.status,'unavailable');
    assert.ok(result.routes.every(r=>r.durationSeconds===null));
    assert.equal(JSON.stringify(result).includes('secret-key'),false);
  }
});

test('a response arriving after the freshness limit is discarded',async()=>{
  let call=0;
  const result=await getTraffic({apiKey:'x',now:()=>clock()+(call++?600000:0),fetchImpl:respond([element(0)])});
  assert.equal(result.reason,'response_expired');
  assert.equal(result.status,'unavailable');
});

// Synthetic provider fixtures exercise matching/units; they are never shipped as live data.
const tomtomAddress=(id,overrides={})=>{
  const addresses={
    downtown:{streetNumber:'329',freeformAddress:'329 Meeting St, Charleston, SC',municipality:'Charleston'},
    'mount-pleasant':{streetNumber:'1218',freeformAddress:'1218 Belk Dr, Mt Pleasant, SC',municipality:'Mt Pleasant'},
    'west-ashley':{freeformAddress:'Savannah Hwy & Magnolia Rd, Charleston, SC',municipality:'Charleston'},
    pier:{streetNumber:'101',freeformAddress:'101 E Arctic Ave, Folly Beach, SC',municipality:'Folly Beach'},
    washout:{streetNumber:'1563',freeformAddress:'1563 E Ashley Ave, Folly Beach, SC',municipality:'Folly Beach'}
  };
  return {results:[{type:id==='west-ashley'?'Cross Street':'Point Address',matchConfidence:{score:1},
    address:{...addresses[id],countryCode:'US',countrySubdivision:'SC'},position:{lat:32.7,lon:-79.9},...overrides}]};
};
const tomtomRoute=()=>({routes:[{summary:{travelTimeInSeconds:1234,noTrafficTravelTimeInSeconds:1000,
  lengthInMeters:20000,departureTime:new Date(clock()).toISOString()}}]});

test('TomTom geocodes must match a specific address or crossing in the correct city',()=>{
  for(const id of ['downtown','mount-pleasant','west-ashley','pier','washout'])assert.deepEqual(selectTomTomPosition(tomtomAddress(id),id),{lat:32.7,lon:-79.9});
  assert.equal(selectTomTomPosition(tomtomAddress('pier',{type:'Geography'}),'pier'),null);
  assert.equal(selectTomTomPosition(tomtomAddress('pier',{matchConfidence:{score:.5}}),'pier'),null);
  const wrong=tomtomAddress('pier');wrong.results[0].address.municipality='Charleston';
  assert.equal(selectTomTomPosition(wrong,'pier'),null);
  const duplicate=tomtomAddress('pier');duplicate.results.push({...duplicate.results[0],position:{lat:32.71,lon:-79.9}});
  assert.equal(selectTomTomPosition(duplicate,'pier'),null);
});

test('TomTom makes four fixed-address geocodes then three traffic-aware requests',async()=>{
  const calls=[];
  const result=await getTraffic({provider:'tomtom',destination:'washout',apiKey:'private-key',now:clock,
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      const parsed=new URL(url);
      if(parsed.pathname.includes('/geocode/')){
        const query=decodeURIComponent(parsed.pathname.split('/geocode/')[1].replace(/\.json$/,''));
        const id=query.startsWith('1563')?'washout':TRAFFIC_ORIGINS.find(origin=>origin.origin===query)?.id;
        assert.ok(id);
        return {ok:true,json:async()=>tomtomAddress(id)};
      }
      assert.equal(parsed.searchParams.get('traffic'),'true');
      assert.equal(parsed.searchParams.get('departAt'),'now');
      assert.equal(parsed.searchParams.get('computeTravelTimeFor'),'all');
      return {ok:true,json:async()=>tomtomRoute()};
    }});
  assert.equal(calls.length,7);
  assert.ok(calls.every(call=>call.options.cache==='no-store'));
  assert.equal(result.provider,'TomTom');
  assert.equal(result.refreshAfterSeconds,600);
  assert.equal(result.status,'ready');
  assert.equal(result.routes[0].durationSeconds,1234);
  assert.equal(result.routes[0].baselineSeconds,1000);
  assert.equal(result.routes[0].congestion,'yellow');
  assert.equal(result.baselineKind,'provider-no-traffic-duration');
  assert.equal(JSON.stringify(result).includes('private-key'),false);
});

test('TomTom failures stay isolated, and an old provider departure is not called live',async()=>{
  let routeCalls=0;
  const result=await getTraffic({provider:'tomtom',apiKey:'x',now:clock,fetchImpl:async url=>{
    if(url.includes('/geocode/')){
      const query=decodeURIComponent(new URL(url).pathname.split('/geocode/')[1].replace(/\.json$/,''));
      const id=query.startsWith('101')?'pier':TRAFFIC_ORIGINS.find(origin=>origin.origin===query)?.id;
      if(id==='mount-pleasant')return {ok:false,status:429};
      return {ok:true,json:async()=>tomtomAddress(id)};
    }
    routeCalls++;
    const data=tomtomRoute();
    if(routeCalls===1)data.routes[0].summary.departureTime='2026-10-20T12:00:00Z';
    return {ok:true,json:async()=>data};
  }});
  assert.equal(result.status,'partial');
  assert.deepEqual(result.routes.map(route=>route.reason),['response_expired','origin_unresolved',null]);
  assert.equal(routeCalls,2);
});

test('TomTom does not query without a key or route when a beach address cannot be resolved',async()=>{
  let calls=0;
  const noKey=await getTraffic({provider:'tomtom',now:clock,fetchImpl:()=>{calls++;}});
  assert.equal(noKey.status,'not_configured');
  assert.equal(calls,0);
  const unresolved=await getTraffic({provider:'tomtom',apiKey:'secret',now:clock,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({results:[]})};}});
  assert.equal(unresolved.reason,'destination_unresolved');
  assert.equal(calls,4);
  assert.ok(unresolved.routes.every(route=>route.etaMinutes===null));
});
