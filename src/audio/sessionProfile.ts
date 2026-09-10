/**
 * Per-session mic calibration: room noise, how loud this guitar is, and the chroma
 * of each chord as this instrument actually sounds.
 */

export interface SessionAudioProfile {
  rmsGate: number;
  fluxMultiplier: number;
  chordEnergyThreshold: number;
  noiseRms: number;
  strumRms: number;
  playerChromas: Record<string, Float32Array>;
}

export const DEFAULT_SESSION_PROFILE: SessionAudioProfile = {
  rmsGate: 0.005,
  fluxMultiplier: 2.4,
  chordEnergyThreshold: 0.5,
  noiseRms: 0.001,
  strumRms: 0.04,
  playerChromas: {}
};

export function cloneProfile(profile: SessionAudioProfile): SessionAudioProfile {
  const playerChromas: Record<string, Float32Array> = {};
  for (const [name, chroma] of Object.entries(profile.playerChromas)) {
    playerChromas[name] = new Float32Array(chroma);
  }
  return { ...profile, playerChromas };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

export function averageChromas(list: Float32Array[]): Float32Array {
  const out = new Float32Array(12);
  if (list.length === 0) return out;
  for (const chroma of list) {
    for (let i = 0; i < 12; i++) out[i] += chroma[i];
  }
  let total = 0;
  for (let i = 0; i < 12; i++) total += out[i];
  if (total > 0) {
    for (let i = 0; i < 12; i++) out[i] /= total;
  }
  return out;
}

export function chromaCosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(12, a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

export function deriveSessionProfile(
  noiseRmsSamples: number[],
  strumRmsSamples: number[],
  playerChromas: Record<string, Float32Array>
): SessionAudioProfile {
  const noiseSorted = noiseRmsSamples.slice().sort((a, b) => a - b);
  const strumSorted = strumRmsSamples.slice().sort((a, b) => a - b);

  const noiseRms = noiseSorted.length > 0 ? percentile(noiseSorted, 0.5) : DEFAULT_SESSION_PROFILE.noiseRms;
  const strumRms = strumSorted.length > 0 ? percentile(strumSorted, 0.5) : DEFAULT_SESSION_PROFILE.strumRms;

  const rmsGate = Math.max(0.002, Math.min(0.04, noiseRms * 3.5));
  const ratio = strumRms / Math.max(noiseRms, 1e-6);

  let fluxMultiplier = 2.4;
  if (ratio > 40) fluxMultiplier = 1.8;
  else if (ratio > 15) fluxMultiplier = 2.4;
  else fluxMultiplier = 3.2;

  const chordEnergyThreshold = ratio < 10 ? 0.42 : 0.5;

  return {
    rmsGate,
    fluxMultiplier,
    chordEnergyThreshold,
    noiseRms,
    strumRms,
    playerChromas
  };
}
