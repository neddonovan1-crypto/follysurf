import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pointer=resolve(root,'.wrangler/deploy/config.json');
let configPath;
try {
  const redirect=JSON.parse(readFileSync(pointer,'utf8'));
  configPath=resolve(dirname(pointer),redirect.configPath);
  if(JSON.parse(readFileSync(configPath,'utf8')).name!=='folly-surf')throw Error('Wrong Worker');
} catch {
  console.error('Build the Folly Surf Worker with npm run build before running npm start.');
  process.exit(1);
}
const result=spawnSync(process.execPath,[
  resolve(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--config',configPath,
  '--local','--persist-to',resolve(root,'.wrangler/state'),'--ip','127.0.0.1',
  '--inspector-port','0',...process.argv.slice(2),
],{cwd:root,stdio:'inherit',env:{...process.env,
  CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false',
  WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:resolve(root,'.wrangler/logs'),
  WRANGLER_REGISTRY_PATH:resolve(root,'.wrangler/dev-registry'),
  MINIFLARE_REGISTRY_PATH:resolve(root,'.wrangler/registry'),
}});
if(result.error)throw result.error;
process.exit(result.status??1);
