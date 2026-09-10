/**
 * Minimal radix-2 FFT, shared by the offline extractor and the tests.
 *
 * The browser's AnalyserNode already provides a spectrum for live input, but offline analysis of
 * an uploaded file needs its own transform, and onset detection runs it on every frame of the
 * track, so the twiddle factors are cached rather than recomputed per call.
 */

let twiddleCos: Float32Array | null = null;
let twiddleSin: Float32Array | null = null;
let twiddleSize = 0;

function ensureTwiddles(n: number): void {
  if (twiddleSize === n && twiddleCos && twiddleSin) return;
  const half = n >> 1;
  twiddleCos = new Float32Array(half);
  twiddleSin = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    const angle = (-2 * Math.PI * k) / n;
    twiddleCos[k] = Math.cos(angle);
    twiddleSin[k] = Math.sin(angle);
  }
  twiddleSize = n;
}

/** In-place iterative FFT. Length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  ensureTwiddles(n);
  const cos = twiddleCos!;
  const sin = twiddleSin!;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride];
        const wi = sin[k * stride];
        const a = i + k;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
      }
    }
  }
}

/** Hann window coefficients of the given length. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

/** Hann-windowed magnitude spectrum of `size` samples starting at `start`. */
export function magnitudeSpectrum(buffer: Float32Array, start: number, size: number): Float32Array {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (buffer[start + i] ?? 0) * w;
  }
  fft(re, im);

  const bins = size / 2;
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return out;
}
