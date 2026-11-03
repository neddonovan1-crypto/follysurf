// NOAA's m0 = sum(S(f) * bandwidth), in m² of surface-elevation variance:
// https://www.ndbc.noaa.gov/faq/wavecalc.shtml
// Exact WPM band centers/widths (46 wave bands; omit the 0.020 Hz noise band):
// https://www.ndbc.noaa.gov/faq/wavespectra.shtml
// These are band-averaged densities, not samples uniformly spaced in period.
// Splitting a band at a period cutoff assumes constant density inside that band.
// Shares describe only the measured frequency range, not the full ocean spectrum,
// wave counts, wave heights, or a wind-sea/swell classification.
const WPM_BANDS = [
  ...Array.from({length:13}, (_, i) => ({center:(325 + 50 * i) / 10000, width:0.005})),
  ...Array.from({length:26}, (_, i) => ({center:(100 + 10 * i) / 1000, width:0.010})),
  ...Array.from({length:7}, (_, i) => ({center:(365 + 20 * i) / 1000, width:0.020})),
];
const GROUPS = [
  {id:'short', label:'Under 8 seconds', low:1 / 8, high:Infinity},
  {id:'medium', label:'8 to under 12 seconds', low:1 / 12, high:1 / 8},
  {id:'long', label:'12 seconds or more', low:0, high:1 / 12},
];
const densityValid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function unavailable(reason, totalBins = 0) {
  return {status:'unavailable', usable:false, method:null, reason,
    groups:GROUPS.map(({id,label}) => ({id,label,energyM2:null,sharePercent:null})),
    totalEnergyM2:null, representedEnergyM2:null, dominantGroup:null,
    coverage:{complete:false,missingBins:totalBins,totalBins,frequencyFraction:0,coveredHz:0,totalHz:null}};
}

// Integrate one constant-density band, splitting at the exact Hz
// corresponding to 8 and 12 seconds. Never integrate using period widths.
function addSegment(energies, low, high, density) {
  GROUPS.forEach((group, i) => {
    const a = Math.max(low, group.low), b = Math.min(high, group.high);
    if (b <= a) return;
    energies[i] += density * (b - a);
  });
}

/**
 * Summarize [{frequencyHz,densityM2PerHz,...}] without mutating the input.
 * Uses the NOAA WPM 46-band grid used by the Edisto endpoint. Rounded three-
 * decimal centers are accepted; omitted expected bands remain missing.
 * For partial coverage, energyM2 and representedEnergyM2 cover valid portions
 * only; totalEnergyM2, percentages and dominantGroup remain null.
 */
export function summarizeSpectralEnergy(bins) {
  if (!Array.isArray(bins) || bins.length > 512) return unavailable('Invalid spectral measurements.', 46);
  const energies = [0, 0, 0];
  let coveredHz = 0;
  const densities = new Map();
  let noiseSeen = false;
  for (const bin of bins) {
    const frequency = bin?.frequencyHz;
    if (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency <= 0) return unavailable('Invalid frequency.', 46);
    if (Math.abs(frequency - 0.020) < 1e-9) {
      if (noiseSeen) return unavailable('Duplicate frequency.', 46);
      noiseSeen = true;
      continue;
    }
    // NOAA text rounds half-millihertz centers either up or down.
    const index = WPM_BANDS.findIndex(band => Math.abs(band.center - frequency) <= 0.000500001);
    if (index < 0) return unavailable('Frequency does not match the NOAA WPM grid.', 46);
    if (densities.has(index)) return unavailable('Duplicate frequency band.', 46);
    densities.set(index, bin.densityM2PerHz);
  }
  let missingBins = 0;
  const totalBins = 46, totalHz = 0.465, method = 'ndbc-46-bandwidths';
  WPM_BANDS.forEach((band, i) => {
    const density = densities.get(i);
    if (!densityValid(density)) { missingBins++; return; }
    coveredHz += band.width;
    addSegment(energies, band.center - band.width / 2, band.center + band.width / 2, density);
  });
  const representedEnergyM2 = energies.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(representedEnergyM2)) return unavailable('Invalid integrated energy.', totalBins);
  const complete = missingBins === 0, usable = complete && representedEnergyM2 > 0;
  const status = coveredHz === 0 ? 'unavailable' : !complete ? 'partial' : usable ? 'ready' : 'zero';
  const groups = GROUPS.map(({id,label}, i) => ({id,label,energyM2:energies[i],sharePercent:usable ? energies[i] / representedEnergyM2 * 100 : null}));
  const strongest = Math.max(...energies);
  const leaders = groups.filter(group => strongest - group.energyM2 <= representedEnergyM2 * 1e-12);
  return {status, usable, method,
    reason:status === 'partial' ? 'Some frequency bands are missing; shares are unavailable.' : status === 'zero' ? 'No positive energy was measured.' : status === 'unavailable' ? 'No frequency range has usable measurements.' : null,
    groups, totalEnergyM2:complete ? representedEnergyM2 : null, representedEnergyM2,
    dominantGroup:usable && leaders.length === 1 ? leaders[0].id : null,
    coverage:{complete,missingBins,totalBins,frequencyFraction:complete ? 1 : Math.min(1,coveredHz / totalHz),coveredHz:complete ? totalHz : coveredHz,totalHz}};
}
