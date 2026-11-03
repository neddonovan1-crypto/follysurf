import {cpSync,mkdirSync,rmSync} from 'node:fs';
rmSync('public/dashboard',{recursive:true,force:true});
mkdirSync('public/dashboard',{recursive:true});cpSync('web','public/dashboard',{recursive:true});
console.log('Dashboard assets prepared.');
