import { env } from 'cloudflare:workers';
import { getVerification } from '../../../server/conditions.js';
export async function GET(){
 try{return Response.json(await getVerification({bucket:env.BUCKET}),{headers:{'Cache-Control':'private, max-age=300'}});}
 catch{return Response.json({error:'Forecast archive unavailable'},{status:503});}
}
