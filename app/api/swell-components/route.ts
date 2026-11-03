import {env} from 'cloudflare:workers';
import {getSwellComponents} from '../../../server/swell-components.js';
export async function GET(){
 const result=await getSwellComponents({bucket:env.BUCKET});
 return Response.json(result,{status:result.status==='fresh'?200:503,headers:{'Cache-Control':result.status==='fresh'?'public, max-age=60':'no-store'}});
}
