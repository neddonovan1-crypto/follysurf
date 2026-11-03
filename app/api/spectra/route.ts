import { env, waitUntil } from 'cloudflare:workers';
import { getSpectra } from '../../../server/spectra.js';
import { archiveObservation } from '../../../server/history.js';

export async function GET() {
 const result=await getSpectra({bucket:env.BUCKET});
 waitUntil(archiveObservation(env.BUCKET,'spectra',result).catch(()=>{}));
 return Response.json(result,{headers:{'Cache-Control':'public, max-age=60'}});
}
