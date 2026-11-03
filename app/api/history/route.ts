import {env} from 'cloudflare:workers';
import {getHistory} from '../../../server/history.js';
export async function GET(request:Request){
 const query=new URL(request.url).searchParams;
 try{
  const result=await getHistory({bucket:env.BUCKET,...(query.has('date')?{date:query.get('date')}:{}),source:query.get('source')??'marine',validAt:query.has('validAt')?Number(query.get('validAt')):null,limit:Number(query.get('limit')??4),cursor:query.get('cursor'),snapshot:query.get('snapshot'),raw:query.get('raw')==='1'});
  return Response.json(result,{status:result.status==='unavailable'?503:200,headers:{'Cache-Control':result.status==='unavailable'?'no-store':'public, max-age=60'}});
 }catch(error){return Response.json({error:error instanceof TypeError?error.message:'Forecast history unavailable'},{status:error instanceof TypeError?400:503,headers:{'Cache-Control':'no-store'}});}
}
