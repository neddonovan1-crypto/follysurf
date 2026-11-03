import { env } from 'cloudflare:workers';
import { getWaveSpectra } from '../../../server/wave-spectra.js';

export async function GET() {
 const result=await getWaveSpectra({bucket:env.BUCKET});
 return Response.json(result,{headers:{'Cache-Control':'public, max-age=60'}});
}
