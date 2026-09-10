/**
 * Synthetic guitar signals for the audio tests.
 *
 * Everything here is deterministic: the pluck attack uses a seeded generator rather than
 * Math.random, so a failing pitch test always fails the same way.
 */

export const SAMPLE_RATE = 44100;

export const NOTE_HZ = {
  E2: 82.41,
  A2: 110.0,
  D3: 146.83,
  G3: 196.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  A4: 440.0,
  E5: 659.26
} as const;

export type NoteName = keyof typeof NOTE_HZ;

/** Open string frequencies by string number, 1 = high E. */
export const OPEN_STRING_HZ: Record<number, number> = {
  1: 329.63, 2: 246.94, 3: 196.0, 4: 146.83, 5: 110.0, 6: 82.41
};

/** Mulberry32: small, fast, and repeatable across runs. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ToneOptions {
  /** Detune in cents. */
  cents?: number;
  /**
   * Relative amplitude of each harmonic, starting at the fundamental. Guitar strings, especially
   * the low ones, put little energy in the fundamental, which is what trips naive detectors.
   */
  partials?: number[];
}

const NORMAL_PARTIALS = [1.0, 0.6, 0.4, 0.25, 0.15, 0.1];
export const WEAK_FUNDAMENTAL_PARTIALS = [0.12, 1.0, 0.85, 0.5, 0.3, 0.2];
export const MISSING_FUNDAMENTAL_PARTIALS = [0, 1.0, 0.85, 0.5, 0.3, 0.2];

/** Steady, non-decaying tone: what the tuner sees while a note rings. */
export function steadyTone(freq: number, samples: number, options: ToneOptions = {}): Float32Array {
  const partials = options.partials ?? NORMAL_PARTIALS;
  const f = freq * Math.pow(2, (options.cents ?? 0) / 1200);
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    let v = 0;
    for (let h = 0; h < partials.length; h++) {
      v += partials[h] * Math.sin((2 * Math.PI * f * (h + 1) * i) / SAMPLE_RATE + h * 1.7);
    }
    buf[i] = v * 0.12;
  }
  return buf;
}

/**
 * Mix a decaying plucked note into `out` at time `t`, with a broadband attack transient.
 * The tail is tapered so the end of the note is not a step discontinuity, which would read
 * as a spurious onset.
 */
export function addPluck(
  out: Float32Array,
  t: number,
  freq: number,
  amplitude = 1,
  decaySeconds = 0.55
): void {
  const start = Math.floor(t * SAMPLE_RATE);
  if (start < 0 || start >= out.length) return;
  const rand = seededRandom(Math.floor(freq * 1000) + start);
  const len = Math.min(out.length - start, Math.floor(SAMPLE_RATE * 2.5));
  const fade = len * 0.2;

  for (let i = 0; i < len; i++) {
    let env = Math.exp(-i / (SAMPLE_RATE * decaySeconds));
    const remaining = len - i;
    if (remaining < fade) env *= remaining / fade;

    let v = i < 220 ? (1 - i / 220) * 0.9 * (rand() * 2 - 1) : 0;
    for (let h = 0; h < NORMAL_PARTIALS.length; h++) {
      v += NORMAL_PARTIALS[h] * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SAMPLE_RATE + h);
    }
    out[start + i] += v * amplitude * env * 0.12;
  }
}

/** A strummed chord: strings enter a few milliseconds apart and ring together. */
export function strum(freqs: number[], samples: number): Float32Array {
  const buf = new Float32Array(samples);
  freqs.forEach((f, index) => {
    const delay = Math.floor(index * 0.02 * SAMPLE_RATE);
    for (let i = delay; i < samples; i++) {
      const age = i - delay;
      const env = Math.exp(-age / (SAMPLE_RATE * 0.8));
      let v = 0;
      for (let h = 1; h <= 6; h++) {
        v += (1 / h) * Math.sin((2 * Math.PI * f * h * age) / SAMPLE_RATE + h * 0.9);
      }
      buf[i] += v * env * 0.05;
    }
  });
  return buf;
}

export function whiteNoise(samples: number, amplitude = 0.2, seed = 7): Float32Array {
  const rand = seededRandom(seed);
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) buf[i] = (rand() * 2 - 1) * amplitude;
  return buf;
}

/** Signed interval between two frequencies, in cents. */
export function centsBetween(freq: number, reference: number): number {
  return 1200 * Math.log2(freq / reference);
}

/** Closest note in NOTE_HZ, or null when nothing is within half a semitone. */
export function nearestNote(freq: number): NoteName | null {
  let best: NoteName | null = null;
  let bestCents = Infinity;
  for (const name of Object.keys(NOTE_HZ) as NoteName[]) {
    const distance = Math.abs(centsBetween(freq, NOTE_HZ[name]));
    if (distance < bestCents) {
      bestCents = distance;
      best = name;
    }
  }
  return bestCents < 50 ? best : null;
}

/** Frequency a note lands on given the string and fret the extractor chose. */
export function tabToFrequency(stringNumber: number, fret: number): number {
  return OPEN_STRING_HZ[stringNumber] * Math.pow(2, fret / 12);
}

/**
 * The subset of AudioBuffer that extractSongProject reads. Building a real one needs a browser
 * audio context, and the extractor never touches anything else.
 */
export function fakeAudioBuffer(data: Float32Array): AudioBuffer {
  return {
    sampleRate: SAMPLE_RATE,
    duration: data.length / SAMPLE_RATE,
    numberOfChannels: 1,
    length: data.length,
    getChannelData: () => data
  } as unknown as AudioBuffer;
}

export interface MelodyNote {
  note: NoteName;
  amplitude?: number;
}

/** Render an evenly spaced melody, returning the audio and the true onset times. */
export function renderMelody(options: {
  notes: MelodyNote[];
  bpm: number;
  /** Notes per beat: 1 = quarters, 2 = eighths, 4 = sixteenths. */
  subdivision: number;
  leadInSeconds: number;
}): { audio: Float32Array; onsetTimes: number[] } {
  const spacing = 60 / options.bpm / options.subdivision;
  const totalSeconds = options.leadInSeconds + options.notes.length * spacing + 3.0;
  const audio = new Float32Array(Math.floor(totalSeconds * SAMPLE_RATE));
  const onsetTimes: number[] = [];

  options.notes.forEach((entry, index) => {
    const t = options.leadInSeconds + index * spacing;
    onsetTimes.push(t);
    addPluck(audio, t, NOTE_HZ[entry.note], entry.amplitude ?? 1);
  });

  return { audio, onsetTimes };
}
