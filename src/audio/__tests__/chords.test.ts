import { describe, expect, it } from 'vitest';
import { CHORD_PITCH_CLASSES, chordMatchesChroma, chromaFromMagnitudes } from '../chords';
import { magnitudeSpectrum } from '../fft';
import { SAMPLE_RATE, strum, whiteNoise } from './signals';

const FFT_SIZE = 8192;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

/** Open position voicings, as guitarAudio.playChord sounds them. */
const VOICINGS: Record<string, number[]> = {
  Am: [110.0, 164.81, 220.0, 261.63, 329.63],
  C:  [130.81, 164.81, 196.0, 261.63, 329.63],
  Em: [82.41, 123.47, 164.81, 196.0, 246.94, 329.63],
  G:  [98.0, 123.47, 146.83, 196.0, 246.94, 392.0],
  D:  [146.83, 220.0, 293.66, 369.99],
  Dm: [146.83, 220.0, 293.66, 349.23],
  F:  [174.61, 220.0, 261.63, 349.23],
  E:  [82.41, 123.47, 164.81, 207.65, 246.94, 329.63]
};

function chromaOf(signal: Float32Array): Float32Array | null {
  const chroma = new Float32Array(12);
  const magnitudes = magnitudeSpectrum(signal, 0, FFT_SIZE);
  return chromaFromMagnitudes(magnitudes, BIN_HZ, chroma) ? chroma : null;
}

const CHORD_NAMES = Object.keys(VOICINGS);

describe('chord matching from chroma', () => {
  it('covers every chord the gameplay can ask for', () => {
    expect(Object.keys(CHORD_PITCH_CLASSES).sort()).toEqual(CHORD_NAMES.slice().sort());
  });

  it.each(CHORD_NAMES)('accepts %s when %s is played', (chord) => {
    const chroma = chromaOf(strum(VOICINGS[chord], FFT_SIZE));
    expect(chordMatchesChroma(chord, VOICINGS[chord][0], chroma)).toBe(true);
  });

  // Am and C share two of their three notes, so an absolute energy threshold alone would accept
  // either for both. Requiring the expected chord to also be the best scoring template is what
  // makes them distinguishable.
  it('does not accept a different chord than the one played', () => {
    const confusions: Array<[string, string]> = [
      ['Am', 'C'], ['C', 'Am'], ['G', 'Em'], ['D', 'Dm'], ['Dm', 'D'], ['F', 'C'], ['Am', 'F']
    ];
    for (const [played, asked] of confusions) {
      const chroma = chromaOf(strum(VOICINGS[played], FFT_SIZE));
      expect(chordMatchesChroma(asked, VOICINGS[played][0], chroma)).toBe(false);
    }
  });

  it('rejects noise and single notes', () => {
    expect(chordMatchesChroma('Am', 220, chromaOf(whiteNoise(FFT_SIZE, 0.3)))).toBe(false);
    // G is a note of C, but one note is not the chord.
    const singleNote = chromaOf(strum([196.0], FFT_SIZE));
    expect(chordMatchesChroma('Am', 196.0, singleNote)).toBe(false);
    expect(chordMatchesChroma('C', 196.0, singleNote)).toBe(false);
  });

  it('falls back to a chord tone check when no chroma is available', () => {
    expect(chordMatchesChroma('Am', 220.0, null)).toBe(true);  // A is in Am
    expect(chordMatchesChroma('Am', 293.66, null)).toBe(false); // D is not
    expect(chordMatchesChroma('Am', 0, null)).toBe(false);
  });

  it('allows unknown chord names through instead of blocking the player', () => {
    expect(chordMatchesChroma('B7', 246.94, new Float32Array(12))).toBe(true);
  });
});

describe('chroma profile', () => {
  it('normalizes to one and peaks on the notes actually played', () => {
    const chroma = chromaOf(strum(VOICINGS.Am, FFT_SIZE))!;
    const total = chroma.reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(1, 5);

    // A, C and E should hold most of the energy of an A minor chord.
    const inChord = CHORD_PITCH_CLASSES.Am.reduce((sum, pc) => sum + chroma[pc], 0);
    expect(inChord).toBeGreaterThan(0.5);
  });

  it('reports no chroma for silence', () => {
    expect(chromaOf(new Float32Array(FFT_SIZE))).toBeNull();
  });
});
