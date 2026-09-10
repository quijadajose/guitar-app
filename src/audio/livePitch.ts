import type { PitchMatchResult } from '../types/audio.types';
import { chromaFromMagnitudes } from './chords';
import { fft, hannWindow } from './fft';
import { detectPitchAutocorrelation } from './pitchMatch';

const RING = 8192;
const FFT_SIZE = 2048;
const ONSET_REFRACTORY_MS = 60;

/**
 * Live pitch / onset / chroma from successive hops of time-domain samples.
 * Runs in the pitch worker; the worklet only captures audio.
 */
export class LivePitchAnalyzer {
  private ring = new Float32Array(RING);
  private write = 0;
  private filled = 0;
  private window = hannWindow(FFT_SIZE);
  private prevMag = new Float32Array(FFT_SIZE / 2);
  private chromaBins = new Float32Array(12);
  private fluxAverage = 0;
  private onsetArmed = false;
  private lastOnsetAt = 0;
  private lastPitch: PitchMatchResult | null = null;
  private lastPitchAt = 0;
  private sampleRate: number;
  private rmsGate = 0.005;
  private fluxMultiplier = 2.4;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  public setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
  }

  public setProfile(rmsGate: number, fluxMultiplier: number): void {
    this.rmsGate = rmsGate;
    this.fluxMultiplier = fluxMultiplier;
  }

  public pushHop(hop: Float32Array, nowMs: number): PitchMatchResult {
    for (let i = 0; i < hop.length; i++) {
      this.ring[this.write] = hop[i];
      this.write = (this.write + 1) % RING;
      if (this.filled < RING) this.filled++;
    }

    const spectral = this.analyseSpectrum(nowMs);

    if (!this.lastPitch || nowMs - this.lastPitchAt >= 30) {
      this.lastPitchAt = nowMs;
      const window = this.snapshot(Math.min(this.filled, 4096));
      this.lastPitch = detectPitchAutocorrelation(window, this.sampleRate, this.rmsGate);
    }

    return {
      ...this.lastPitch,
      isOnset: spectral.isOnset,
      chroma: spectral.chroma
    };
  }

  private snapshot(count: number): Float32Array {
    const out = new Float32Array(count);
    let idx = (this.write - count + RING) % RING;
    for (let i = 0; i < count; i++) {
      out[i] = this.ring[idx];
      idx = (idx + 1) % RING;
    }
    return out;
  }

  private analyseSpectrum(nowMs: number): { isOnset: boolean; chroma: Float32Array | null } {
    if (this.filled < FFT_SIZE) {
      return { isOnset: false, chroma: null };
    }

    const frame = this.snapshot(FFT_SIZE);
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = frame[i] * this.window[i];
    }
    fft(re, im);

    const bins = FFT_SIZE / 2;
    const binHz = this.sampleRate / FFT_SIZE;
    const fluxMaxBin = Math.min(bins - 1, Math.floor(5000 / binHz));
    const mags = new Float32Array(bins);

    let flux = 0;
    for (let k = 1; k <= fluxMaxBin; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const rise = mag - this.prevMag[k];
      if (rise > 0) flux += rise;
      this.prevMag[k] = mag;
      mags[k] = mag;
    }

    const threshold = this.fluxAverage * this.fluxMultiplier + 1e-4;
    let isOnset = false;
    if (flux > threshold) {
      if (!this.onsetArmed && nowMs - this.lastOnsetAt >= ONSET_REFRACTORY_MS) {
        isOnset = true;
        this.onsetArmed = true;
        this.lastOnsetAt = nowMs;
      }
    } else if (flux < threshold * 0.6) {
      this.onsetArmed = false;
    }
    this.fluxAverage = this.fluxAverage * 0.9 + flux * 0.1;

    const hasChroma = chromaFromMagnitudes(mags, binHz, this.chromaBins);
    return { isOnset, chroma: hasChroma ? this.chromaBins : null };
  }
}
