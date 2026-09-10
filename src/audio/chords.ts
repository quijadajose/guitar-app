import type { SessionAudioProfile } from './sessionProfile';
import { chromaCosine } from './sessionProfile';

/**
 * Chord recognition from a chroma (pitch class) profile.
 *
 * A monophonic pitch tracker cannot describe a strum, so verifying chord practice needs a
 * different signal: a triad concentrates its energy in three pitch classes regardless of which
 * octave each string sounds in. Kept separate from the gameplay engine so it can be tested
 * without a browser.
 */

/** Pitch classes of each chord, 0 = C. */
export const CHORD_PITCH_CLASSES: Record<string, number[]> = {
  'Am': [9, 0, 4],   // A  C  E
  'C':  [0, 4, 7],   // C  E  G
  'Em': [4, 7, 11],  // E  G  B
  'G':  [7, 11, 2],  // G  B  D
  'D':  [2, 6, 9],   // D  F# A
  'Dm': [2, 5, 9],   // D  F  A
  'F':  [5, 9, 0],   // F  A  C
  'E':  [4, 8, 11]   // E  G# B
};

/** Share of chroma energy that must sit on the chord's own pitch classes. */
export const CHORD_ENERGY_THRESHOLD = 0.5;
/** How far below the best-scoring chord template the expected chord may fall. */
export const CHORD_SCORE_MARGIN = 0.08;

/** Lowest and highest bin frequency worth counting toward the chroma profile. */
export const CHROMA_MIN_HZ = 100;
export const CHROMA_MAX_HZ = 2000;

/**
 * Fold a magnitude spectrum into 12 pitch classes, normalized to sum 1.
 *
 * Bins below CHROMA_MIN_HZ are narrower than the semitone they would be assigned to, and bins
 * above CHROMA_MAX_HZ are upper partials that no longer identify the chord, so both are skipped.
 * Returns false when there is no usable energy.
 */
export function chromaFromMagnitudes(magnitudes: Float32Array, binHz: number, out: Float32Array): boolean {
  out.fill(0);

  const minBin = Math.max(1, Math.floor(CHROMA_MIN_HZ / binHz));
  const maxBin = Math.min(magnitudes.length - 1, Math.floor(CHROMA_MAX_HZ / binHz));
  let total = 0;

  for (let k = minBin; k <= maxBin; k++) {
    const mag = magnitudes[k];
    if (mag <= 0) continue;
    const midi = Math.round(69 + 12 * Math.log2((k * binHz) / 440));
    out[((midi % 12) + 12) % 12] += mag;
    total += mag;
  }

  if (total <= 0) return false;
  for (let i = 0; i < 12; i++) out[i] /= total;
  return true;
}

function scoreTemplate(chroma: Float32Array, pitchClasses: number[]): number {
  let sum = 0;
  for (const pc of pitchClasses) sum += chroma[pc];
  return sum;
}

/**
 * Decide whether what was played matches the chord the chart asks for.
 *
 * Requiring the expected chord to also be the best-scoring template is what separates chords
 * that share notes: Am and C differ only in one pitch class, so an absolute score alone would
 * accept either for both. `freq` is the tracked fundamental, used only when no chroma is
 * available, in which case all that can be checked is that the note belongs to the chord.
 */
export function chordMatchesChroma(
  chordName: string,
  freq: number,
  chroma?: Float32Array | null,
  profile?: SessionAudioProfile | null
): boolean {
  const target = CHORD_PITCH_CLASSES[chordName];
  if (!target) return true;

  const stored = profile?.playerChromas[chordName];
  if (stored && chroma && profile) {
    const sim = chromaCosine(chroma, stored);
    if (sim < 0.78) return false;
    let bestName = chordName;
    let bestSim = sim;
    for (const [name, template] of Object.entries(profile.playerChromas)) {
      const rival = chromaCosine(chroma, template);
      if (rival > bestSim) {
        bestSim = rival;
        bestName = name;
      }
    }
    if (bestName !== chordName && bestSim - sim > 0.05) return false;
    return true;
  }

  if (!chroma) {
    if (!(freq > 0)) return false;
    const pitchClass = ((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12;
    return target.includes(pitchClass);
  }

  const energyFloor = profile?.chordEnergyThreshold ?? CHORD_ENERGY_THRESHOLD;
  const targetScore = scoreTemplate(chroma, target);
  if (targetScore < energyFloor) return false;

  let bestName = chordName;
  let bestScore = targetScore;
  for (const name of Object.keys(CHORD_PITCH_CLASSES)) {
    const score = scoreTemplate(chroma, CHORD_PITCH_CLASSES[name]);
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  if (targetScore < bestScore - CHORD_SCORE_MARGIN) return false;

  // Near-ties (E vs Em share two notes) are decided by the pitch class that distinguishes them.
  if (bestName !== chordName && bestScore - targetScore <= CHORD_SCORE_MARGIN) {
    const asked = CHORD_PITCH_CLASSES[chordName];
    const rival = CHORD_PITCH_CLASSES[bestName];
    const uniqueAsked = asked.filter(pc => !rival.includes(pc));
    const uniqueRival = rival.filter(pc => !asked.includes(pc));
    const askedUnique = uniqueAsked.reduce((s, pc) => s + chroma[pc], 0);
    const rivalUnique = uniqueRival.reduce((s, pc) => s + chroma[pc], 0);
    if (askedUnique < rivalUnique) return false;
  }

  return true;
}

/** Name the chord whose pitch classes are all present in `pitchClasses`. */
export function chordNameFromPitchClasses(pitchClasses: Iterable<number>): string | null {
  const present = new Set<number>();
  for (const pc of pitchClasses) present.add(((pc % 12) + 12) % 12);

  let best: string | null = null;
  let bestExtra = Infinity;
  for (const [name, classes] of Object.entries(CHORD_PITCH_CLASSES)) {
    if (!classes.every(pc => present.has(pc))) continue;
    const extra = present.size - classes.length;
    if (extra < bestExtra) {
      bestExtra = extra;
      best = name;
    }
  }
  return best;
}
