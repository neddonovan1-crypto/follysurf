import { env, waitUntil } from 'cloudflare:workers';
import { getCoastal } from '../../../server/coastal.js';
import { archiveObservation } from '../../../server/history.js';

export async function GET() {
 try {
  const result=await getCoastal({bucket:env.BUCKET});
  waitUntil(archiveObservation(env.BUCKET,'coastal',result).catch(()=>{}));
  return Response.json(result,{headers:{'Cache-Control':'public, max-age=60'}});
 } catch {
  return Response.json({status:'unavailable',error:'Coastal observation service is unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
