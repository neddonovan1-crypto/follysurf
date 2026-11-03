import { env } from 'cloudflare:workers';
import { getTraffic } from '../../../server/traffic.js';
export async function GET(request:Request){
 const destination=new URL(request.url).searchParams.get('destination')??'pier';
 const headers={'Cache-Control':'no-store'};
 if(!['pier','washout'].includes(destination))return Response.json({error:'Unsupported destination'},{status:400,headers});
 const provider=env.TOMTOM_API_KEY?'tomtom':'google';
 const apiKey=provider==='tomtom'?env.TOMTOM_API_KEY:env.GOOGLE_MAPS_API_KEY;
 try{return Response.json(await getTraffic({provider,destination,apiKey}),{headers});}
 catch{return Response.json({status:'unavailable',routes:[],error:'Traffic service unavailable'},{status:503,headers});}
}
