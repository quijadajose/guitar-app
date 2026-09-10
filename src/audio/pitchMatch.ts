import type { PitchMatchResult } from '../types/audio.types';

export const PITCH_WINDOW = 4096;

/** YIN cumulative-mean difference. Returns Hz or null. */
export function detectFreqYin(buffer: Float32Array, sampleRate: number): number | null {
  const size = buffer.length;
  const half = Math.floor(size / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / 900));
  const maxTau = Math.min(half, Math.floor(sampleRate / 65));
  if (maxTau <= minTau) return null;

  const diff = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau];
    cmnd[tau] = diff[tau] * tau / running;
  }

  const threshold = 0.15;
  let tauEstimate = -1;
  for (let tau = minTau; tau < maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate < 0) {
    let best = minTau;
    for (let tau = minTau + 1; tau < maxTau; tau++) {
      if (cmnd[tau] < cmnd[best]) best = tau;
    }
    if (cmnd[best] > 0.35) return null;
    tauEstimate = best;
  }

  const t = tauEstimate;
  const x0 = t > 1 ? cmnd[t - 1] : cmnd[t];
  const x1 = cmnd[t];
  const x2 = t + 1 <= maxTau ? cmnd[t + 1] : cmnd[t];
  const denom = 2 * (x0 - 2 * x1 + x2);
  let betterTau = t;
  if (Math.abs(denom) > 1e-12) {
    betterTau = t + (x0 - x2) / denom;
  }

  if (betterTau < 1) return null;
  return sampleRate / betterTau;
}

/**
 * YIN plus nearest guitar string/fret. Shared by the live engine and the pitch worker.
 */
export function detectPitchAutocorrelation(
  buffer: Float32Array,
  sampleRate: number,
  rmsGate: number = 0.005
): PitchMatchResult {
  let sumSquares = 0;
  const size = buffer.length;
  for (let i = 0; i < size; i++) {
    sumSquares += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSquares / size);

  if (rms < rmsGate) {
    return { freq: null, rms, isOnset: false, chroma: null, stringMatch: null, fretMatch: null };
  }

  const window = size > PITCH_WINDOW
    ? buffer.subarray(size - PITCH_WINDOW)
    : buffer;

  const freq = detectFreqYin(window, sampleRate);
  if (freq === null) {
    return { freq: null, rms, isOnset: false, chroma: null, stringMatch: null, fretMatch: null };
  }

  const guitarStrings = [
    { string: 1, name: 'E4', freq: 329.63, midi: 64 },
    { string: 2, name: 'B3', freq: 246.94, midi: 59 },
    { string: 3, name: 'G3', freq: 196.00, midi: 55 },
    { string: 4, name: 'D3', freq: 146.83, midi: 50 },
    { string: 5, name: 'A2', freq: 110.00, midi: 45 },
    { string: 6, name: 'E2', freq: 82.41, midi: 40 }
  ];

  const measuredMidi = 69 + 12 * Math.log2(freq / 440);

  let matchedString: (typeof guitarStrings)[0] | null = null;
  let minMidiDiff = Infinity;
  for (const gs of guitarStrings) {
    const diff = Math.abs(measuredMidi - gs.midi);
    if (diff < minMidiDiff) {
      minMidiDiff = diff;
      matchedString = gs;
    }
  }

  if (!matchedString || minMidiDiff > 1.35) {
    matchedString = null;
  }

  const computedCents = matchedString
    ? Math.round(1200 * Math.log2(freq / matchedString.freq))
    : 0;

  let matchedFret: { string: number; fret: number; expectedFreq: number; cents: number } | null = null;
  let bestFretScore = Infinity;
  const baseFreqs: Record<number, number> = { 1: 329.63, 2: 246.94, 3: 196.00, 4: 146.83, 5: 110.00, 6: 82.41 };

  for (let s = 1; s <= 6; s++) {
    for (let f = 0; f <= 15; f++) {
      const expectedF = baseFreqs[s] * Math.pow(2, f / 12);
      const cents = 1200 * Math.log2(freq / expectedF);
      if (Math.abs(cents) >= 45) continue;
      const score = Math.abs(cents) + f * 0.01;
      if (score < bestFretScore) {
        bestFretScore = score;
        matchedFret = { string: s, fret: f, expectedFreq: Math.round(expectedF * 10) / 10, cents: Math.round(cents) };
      }
    }
  }

  return {
    freq: Math.round(freq * 10) / 10,
    rms,
    isOnset: false,
    chroma: null,
    stringMatch: matchedString ? {
      string: matchedString.string,
      name: matchedString.name,
      targetFreq: matchedString.freq,
      cents: computedCents,
      inTune: Math.abs(computedCents) <= 5
    } : null,
    fretMatch: matchedFret
  };
}
