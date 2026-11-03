import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const web='web';
for(const directory of [web,'server','scripts'])for(const name of readdirSync(directory)){
 if(!/\.(m?js)$/.test(name))continue;
 const result=spawnSync(process.execPath,['--check',`${directory}/${name}`],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
const html=readFileSync(`${web}/index.html`,'utf8'),js=readFileSync(`${web}/app.js`,'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(ids.length!==new Set(ids).size)throw Error('Duplicate HTML IDs');
for(const m of js.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(m[1]))throw Error(`Missing DOM id ${m[1]}`);
console.log('JavaScript syntax and dashboard DOM references verified.');
