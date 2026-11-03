import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {combineSpectra} from '../server/spectra.js';
import {summarizeSpectralEnergy} from '../web/spectral-energy.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const grid = (density = 0) => [
  ...Array.from({length:13}, (_,i) => (325 + 50*i)/10000),
  ...Array.from({length:26}, (_,i) => (100 + 10*i)/1000),
  ...Array.from({length:7}, (_,i) => (365 + 20*i)/1000),
].map(frequencyHz => ({frequencyHz,densityM2PerHz:density,meanDirectionDeg:null}));
const group = (result,id) => result.groups.find(g => g.id === id);
const noShares = result => {
  assert.equal(result.usable,false);assert.equal(result.dominantGroup,null);
  assert.ok(result.groups.every(g => g.sharePercent === null));
};

test('constant density conserves energy over published 46-band range and exact cutoffs',()=>{
  const bins=grid(1),before=structuredClone(bins),result=summarizeSpectralEnergy(bins);
  assert.deepEqual(bins,before);assert.equal(result.status,'ready');assert.equal(result.method,'ndbc-46-bandwidths');
  near(result.totalEnergyM2,.465);near(result.coverage.coveredHz,.465);
  near(group(result,'long').energyM2,1/12-.030);
  near(group(result,'medium').energyM2,1/8-1/12);
  near(group(result,'short').energyM2,.495-1/8);
  near(result.groups.reduce((sum,g)=>sum+g.energyM2,0),result.totalEnergyM2);
  near(result.groups.reduce((sum,g)=>sum+g.sharePercent,0),100);
  assert.equal(result.dominantGroup,'short');assert.equal(result.coverage.missingBins,0);
});

test('published unequal bandwidths apply at both spacing transitions',()=>{
  for(const [frequency,width] of [[.0925,.005],[.100,.010],[.350,.010],[.365,.020]]){
    const bins=grid();bins.find(b=>b.frequencyHz===frequency).densityM2PerHz=2;
    near(summarizeSpectralEnergy(bins).totalEnergyM2,2*width);
  }
});

test('12-second cutoff splits its NOAA band and 8-second cutoff uses the true shared edge',()=>{
  const bins=grid();bins.find(b=>b.frequencyHz===.0825).densityM2PerHz=3;
  bins.find(b=>b.frequencyHz===.120).densityM2PerHz=2;
  bins.find(b=>b.frequencyHz===.130).densityM2PerHz=4;
  const result=summarizeSpectralEnergy(bins);
  near(group(result,'long').energyM2,3*(1/12-.080));
  near(group(result,'medium').energyM2,3*(.085-1/12)+.020);
  near(group(result,'short').energyM2,.040);near(result.totalEnergyM2,.075);
});

test('rounded centers and ignored diagnostic noise preserve energy; directions are optional',()=>{
  const original=grid(2),rounded=original.map((b,i)=>({...b,frequencyHz:i<13?Number((b.frequencyHz+(i%2?-.00000001:.00000001)).toFixed(3)):b.frequencyHz}));
  rounded.unshift({frequencyHz:.020,densityM2PerHz:100000});
  const result=summarizeSpectralEnergy(rounded);
  assert.equal(result.status,'ready');near(result.totalEnergyM2,.930);assert.equal(result.coverage.totalBins,46);
});

test('omitted, null, negative and nonnumeric bands remain missing rather than zero',()=>{
  for(const replacement of ['omit',null,undefined,-1,NaN,Infinity,'0']){
    const bins=grid(1);
    if(replacement==='omit')bins.splice(45,1);else bins[45].densityM2PerHz=replacement;
    const result=summarizeSpectralEnergy(bins);assert.equal(result.status,'partial');noShares(result);
    assert.equal(result.totalEnergyM2,null);assert.equal(result.coverage.missingBins,1);
    near(result.representedEnergyM2,.445);near(result.coverage.frequencyFraction,.445/.465);
  }
  const truncated=summarizeSpectralEnergy(grid(1).slice(0,13));
  assert.equal(truncated.coverage.missingBins,33);near(truncated.coverage.coveredHz,.065);noShares(truncated);
});

test('duplicate and unexpected frequencies never masquerade as complete NOAA data',()=>{
  const bins=grid(1);
  for(const bad of [[...bins,bins[0]],[...bins.slice(1),{...bins[1]}],[...bins,{frequencyHz:.099,densityM2PerHz:1}], [{frequencyHz:null,densityM2PerHz:1}]]){
    const result=summarizeSpectralEnergy(bad);assert.equal(result.status,'unavailable');noShares(result);
  }
});

test('zero and all-missing spectra expose no invented percentages or strongest period',()=>{
  const zero=summarizeSpectralEnergy(grid());assert.equal(zero.status,'zero');near(zero.totalEnergyM2,0);noShares(zero);
  const missing=summarizeSpectralEnergy(grid(null));assert.equal(missing.status,'unavailable');noShares(missing);
  assert.equal(missing.coverage.missingBins,46);assert.equal(missing.totalEnergyM2,null);
  const empty=summarizeSpectralEnergy([]);assert.equal(empty.status,'unavailable');noShares(empty);
});

test('dominant group uses integrated energy, including ties, rather than the tallest density',()=>{
  const bins=grid();bins[0].densityM2PerHz=4;bins.at(-1).densityM2PerHz=4;
  assert.equal(summarizeSpectralEnergy(bins).dominantGroup,'short');
  bins[0].densityM2PerHz=16;
  assert.equal(summarizeSpectralEnergy(bins).dominantGroup,null);
});

test('captured Edisto fixture produces a complete positive mix without directions',()=>{
  const density=readFileSync(new URL('./fixtures/spectra-41004.data_spec',import.meta.url),'utf8');
  const payload=combineSpectra(density,'',{now:Date.parse('2026-10-21T02:30:00Z')/1000});
  const result=summarizeSpectralEnergy(payload.bins);
  assert.equal(payload.bins.length,46);assert.equal(result.status,'ready');assert.equal(result.dominantGroup,'short');
  assert.ok(group(result,'short').sharePercent>90);near(result.groups.reduce((sum,g)=>sum+g.sharePercent,0),100);
});
