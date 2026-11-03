#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateFollyObservations} from '../server/calibration.js';
const args=process.argv.slice(2),options={ratings:[]};
for(let i=0;i<args.length;i++){
 const key=args[i];if(!['--dataset','--ratings','--out'].includes(key)||!args[i+1])throw new Error('Usage: node scripts/evaluate-folly-observations.mjs --dataset observations.json --ratings archived-ratings.json [--ratings more.json] --out report.json');
 if(key==='--ratings')options.ratings.push(args[++i]);else options[key.slice(2)]=args[++i];
}
if(!options.dataset||!options.out||!options.ratings.length)throw new Error('Supply --dataset, at least one --ratings export and --out. No data is downloaded or submitted.');
const json=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const dataset=await json(options.dataset),exports=await Promise.all(options.ratings.map(json));
if(exports.some(data=>data?.truncated===true))throw new Error('A history export is truncated. Collect and combine all cursor pages before evaluation.');
const snapshots=exports.flatMap(data=>Array.isArray(data)?data:Array.isArray(data.snapshots)?data.snapshots:Array.isArray(data.records)?data.records:[data]);
const report=evaluateFollyObservations({plan:dataset.plan,observations:dataset.observations,snapshots});
await writeFile(resolve(options.out),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(`Saved ${report.matchedSessions} matched session comparisons; ${report.rejected.length} rejected records. No formula changes made.\n`);
