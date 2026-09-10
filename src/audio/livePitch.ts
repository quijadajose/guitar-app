import type { PitchMatchResult } from '../types/audio.types';
import { chromaFromMagnitudes } from './chords';
import { fft, hannWindow, ifft } from './fft';
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
  private noiseMag = new Float32Array(FFT_SIZE / 2);
  private noiseReady = false;
  private quietFrames = 0;
  private hpPrevX = 0;
  private hpPrevY = 0;
  private noiseRms = 0;

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
    const hpR = Math.exp((-2 * Math.PI * 70) / this.sampleRate);
    for (let i = 0; i < hop.length; i++) {
      const x = hop[i];
      const y = hpR * (this.hpPrevY + x - this.hpPrevX);
      this.hpPrevX = x;
      this.hpPrevY = y;
      this.ring[this.write] = y;
      this.write = (this.write + 1) % RING;
      if (this.filled < RING) this.filled++;
    }

    const spectral = this.analyseSpectrum(nowMs);

    if (!this.lastPitch || nowMs - this.lastPitchAt >= 30) {
      this.lastPitchAt = nowMs;
      const window = this.snapshot(Math.min(this.filled, 4096));
      const cleaned = this.suppressStationaryNoise(window);
      const gate = Math.max(this.rmsGate, this.noiseRms * 2.2);
      this.lastPitch = detectPitchAutocorrelation(cleaned, this.sampleRate, gate);
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

  /**
   * Learns the room spectrum while the guitar is quiet, then subtracts that floor
   * from later frames so a steady air conditioner does not bury the string.
   */
  private suppressStationaryNoise(frame: Float32Array): Float32Array {
    const n = FFT_SIZE;
    if (frame.length < n) return frame;

    let sumSquares = 0;
    for (let i = 0; i < n; i++) sumSquares += frame[i] * frame[i];
    const rms = Math.sqrt(sumSquares / n);
    if (this.noiseRms === 0) this.noiseRms = rms;
    else if (rms <= this.noiseRms) this.noiseRms = this.noiseRms * 0.5 + rms * 0.5;
    else this.noiseRms = this.noiseRms * 0.998 + rms * 0.002;

    const re = new Float32Array(n);
    const im = new Float32Array(n);
    re.set(frame.subarray(frame.length - n));
    fft(re, im);

    const bins = n / 2;
    const mags = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      mags[k] = Math.hypot(re[k], im[k]);
    }

    this.quietFrames++;
    for (let k = 0; k < bins; k++) {
      if (!this.noiseReady) {
        this.noiseMag[k] = mags[k];
      } else if (mags[k] < this.noiseMag[k]) {
        this.noiseMag[k] = this.noiseMag[k] * 0.5 + mags[k] * 0.5;
      } else {
        this.noiseMag[k] = this.noiseMag[k] * 0.995 + mags[k] * 0.005;
      }
    }
    if (this.quietFrames < 6) {
      this.noiseReady = this.quietFrames >= 6;
      return frame;
    }
    this.noiseReady = true;

    if (rms < this.rmsGate) return frame;

    for (let k = 1; k < bins; k++) {
      const floor = this.noiseMag[k] * 1.5;
      if (mags[k] <= floor) {
        re[k] = 0;
        im[k] = 0;
        re[n - k] = 0;
        im[n - k] = 0;
        continue;
      }
      const gain = 1 - floor / mags[k];
      re[k] *= gain;
      im[k] *= gain;
      re[n - k] *= gain;
      im[n - k] *= gain;
    }
    re[0] = 0;
    im[0] = 0;

    ifft(re, im);
    const out = new Float32Array(frame.length);
    out.set(frame.subarray(0, frame.length - n), 0);
    out.set(re, frame.length - n);
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
