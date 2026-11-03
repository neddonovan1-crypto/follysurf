import { env } from 'cloudflare:workers';
import { getConditions } from '../../../server/conditions.js';
export async function GET(){
 try{
  const result=await getConditions({bucket:env.BUCKET});
  // Historical buoy records and comparison forecasts stay on the server.
  const {buoyModel,...sources}=result.sources;
  if(sources.buoy?.data)sources.buoy={...sources.buoy,data:{...sources.buoy.data,rows:undefined}};
  return Response.json({...result,sources},{headers:{'Cache-Control':'public, max-age=60'}});
 }
 catch{return Response.json({error:'Forecast services unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
