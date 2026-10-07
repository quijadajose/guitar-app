import type { PitchMatchResult } from '../types/audio.types';
import { chromaFromMagnitudes } from './chords';
import { fft, hannWindow, ifft } from './fft';
import { detectPitchAutocorrelation } from './pitchMatch';

const RING = 8192;
const FFT_SIZE = 2048;
/** Noise suppression works on the whole YIN window so the cleaned and raw halves are never spliced. */
const NOISE_FFT = 4096;
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
  private noiseMag = new Float32Array(NOISE_FFT / 2);
  private quietFrames = 0;
  private hpPrevX = 0;
  private hpPrevY = 0;
  private noiseRms = 0;
  private notchZ = [
    { x1: 0, x2: 0, y1: 0, y2: 0 },
    { x1: 0, x2: 0, y1: 0, y2: 0 },
    { x1: 0, x2: 0, y1: 0, y2: 0 }
  ];

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

  /** Narrow notch so 60 Hz mains hum and its first harmonics are not read as a string. */
  private notchCoeffs(freq: number): { b0: number; b1: number; b2: number; a1: number; a2: number } {
    const w0 = (2 * Math.PI * freq) / this.sampleRate;
    const alpha = Math.sin(w0) / (2 * 35);
    const a0 = 1 + alpha;
    return {
      b0: 1 / a0,
      b1: (-2 * Math.cos(w0)) / a0,
      b2: 1 / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha) / a0
    };
  }

  public pushHop(hop: Float32Array, nowMs: number): PitchMatchResult {
    const hpR = Math.exp((-2 * Math.PI * 70) / this.sampleRate);
    const notches = [60, 120, 180].map(freq => this.notchCoeffs(freq));
    for (let i = 0; i < hop.length; i++) {
      let y = hop[i];
      for (let n = 0; n < notches.length; n++) {
        const c = notches[n];
        const z = this.notchZ[n];
        const out = c.b0 * y + c.b1 * z.x1 + c.b2 * z.x2 - c.a1 * z.y1 - c.a2 * z.y2;
        z.x2 = z.x1;
        z.x1 = y;
        z.y2 = z.y1;
        z.y1 = out;
        y = out;
      }
      const high = hpR * (this.hpPrevY + y - this.hpPrevX);
      this.hpPrevX = y;
      this.hpPrevY = high;
      this.ring[this.write] = high;
      this.write = (this.write + 1) % RING;
      if (this.filled < RING) this.filled++;
    }

    const spectral = this.analyseSpectrum(nowMs);

    if (!this.lastPitch || nowMs - this.lastPitchAt >= 30) {
      this.lastPitchAt = nowMs;
      const window = this.snapshot(Math.min(this.filled, NOISE_FFT));
      const cleaned = this.suppressStationaryNoise(window);
      // Spectral subtraction already removes the steady room floor; a 2.4x gate silenced the
      // decay of every note in a room with an air conditioner (noise rms ~0.05).
      const gate = Math.max(this.rmsGate, this.noiseRms * 1.5);
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
    const n = NOISE_FFT;
    if (frame.length < n) return frame;

    let sumSquares = 0;
    for (let i = 0; i < n; i++) sumSquares += frame[i] * frame[i];
    const rms = Math.sqrt(sumSquares / n);

    // Only learn the room while it is actually quiet. Learning from every frame let a ringing
    // note raise both the RMS gate and the spectral floor until soft notes disappeared.
    const quiet = this.noiseRms === 0
      ? rms < Math.max(this.rmsGate, 0.01)
      : rms < this.noiseRms * 2;
    if (quiet) {
      this.noiseRms = this.noiseRms === 0 ? rms : this.noiseRms * 0.85 + rms * 0.15;
    }

    const re = new Float32Array(n);
    const im = new Float32Array(n);
    re.set(frame.subarray(0, n));
    fft(re, im);

    const bins = n / 2;
    const mags = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      mags[k] = Math.hypot(re[k], im[k]);
    }

    if (quiet) {
      for (let k = 0; k < bins; k++) {
        this.noiseMag[k] = this.quietFrames === 0 ? mags[k] : this.noiseMag[k] * 0.9 + mags[k] * 0.1;
      }
      this.quietFrames++;
    }
    if (this.quietFrames < 6) return frame;

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
    re[bins] = 0;
    im[bins] = 0;

    ifft(re, im);
    return re;
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
