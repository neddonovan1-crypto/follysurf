import { accessSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const vite=resolve(root,'node_modules/vite/bin/vite.js');
try{accessSync(vite);}catch{
  console.error('Cloudflare build dependencies are unavailable. Run npm ci first.');
  process.exit(1);
}
const env={...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false'};
// Always build this repository's Worker configuration.
delete env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;
function run(script,args=[]){
  const result=spawnSync(process.execPath,[script,...args],{cwd:root,env,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run(resolve(root,'scripts/prepare-web.mjs'));
run(vite,['build','--config',resolve(root,'vite.cloudflare.config.ts')]);

// The Vite plugin owns output paths and tells Wrangler where to deploy. Verify
// the emitted target instead of assuming a folder name.
const pointer=resolve(root,'.wrangler/deploy/config.json');
const redirect=JSON.parse(readFileSync(pointer,'utf8'));
if(typeof redirect.configPath!=='string')throw new Error('Missing generated Cloudflare deployment configuration');
const configPath=resolve(dirname(pointer),redirect.configPath);
const config=JSON.parse(readFileSync(configPath,'utf8'));
if(config.name!=='folly-surf'||!config.r2_buckets?.some(binding=>binding.binding==='BUCKET'&&binding.bucket_name==='folly-surf-forecasts')){
  throw new Error('Build did not produce the standalone Folly Surf Worker');
}
if(!config.triggers?.crons?.includes('0 */6 * * *'))throw new Error('Scheduled collection is missing from deployment output');
console.log(`Cloudflare build ready: ${relative(root,configPath)}`);
console.log('Deploy this build with: npx wrangler deploy');
