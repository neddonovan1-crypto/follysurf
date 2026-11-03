#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {evaluateWaveStudy} from '../server/wave-study.js';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
 if(!['--dataset','--ratings','--spectra','--out'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Use --dataset plan-and-observations.json --ratings ratings.json --spectra spectra.json --out new-report.json');
 options[args[i]]=args[i+1];
}
if(Object.keys(options).length!==4)throw Error('All four input/output arguments are required');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const [dataset,snapshots,spectra]=await Promise.all([read(options['--dataset']),read(options['--ratings']),read(options['--spectra'])]);
const report=evaluateWaveStudy({plan:dataset.plan,observations:dataset.observations,snapshots,spectra});
await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,matchedSessions:report.matchedSessions,strata:report.strata.length,output:options['--out']}));
