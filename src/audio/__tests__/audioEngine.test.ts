import { describe, expect, it } from 'vitest';
import { GuitarAudioEngine } from '../audioEngine';
import {
  MISSING_FUNDAMENTAL_PARTIALS,
  OPEN_STRING_HZ,
  SAMPLE_RATE,
  WEAK_FUNDAMENTAL_PARTIALS,
  centsBetween,
  steadyTone,
  whiteNoise
} from './signals';

const engine = new GuitarAudioEngine();
const BUFFER = 8192;

const OPEN_STRINGS = [
  { string: 6, name: 'E2' },
  { string: 5, name: 'A2' },
  { string: 4, name: 'D3' },
  { string: 3, name: 'G3' },
  { string: 2, name: 'B3' },
  { string: 1, name: 'E4' }
] as const;

describe('tuner pitch detection', () => {
  it.each(OPEN_STRINGS)('identifies the open $name string within 5 cents', ({ string, name }) => {
    const target = OPEN_STRING_HZ[string];
    const result = engine.detectPitchAutocorrelation(steadyTone(target, BUFFER), SAMPLE_RATE);

    expect(result.freq).not.toBeNull();
    expect(Math.abs(centsBetween(result.freq!, target))).toBeLessThan(5);
    expect(result.stringMatch?.name).toBe(name);
    expect(result.stringMatch?.inTune).toBe(true);
  });

  // Regression: an octave-correction heuristic used to compare the CMND at twice the chosen lag
  // and drop the estimate an octave. On a periodic tone both lags score near zero, so the
  // comparison was floating point noise and it fired on four of the six strings.
  it.each(OPEN_STRINGS)('does not drop $name an octave when the fundamental is weak', ({ string }) => {
    const target = OPEN_STRING_HZ[string];
    const result = engine.detectPitchAutocorrelation(
      steadyTone(target, BUFFER, { partials: WEAK_FUNDAMENTAL_PARTIALS }),
      SAMPLE_RATE
    );

    expect(result.freq).not.toBeNull();
    expect(Math.abs(centsBetween(result.freq!, target))).toBeLessThan(30);
  });

  it.each(OPEN_STRINGS)('still finds $name when the fundamental is absent entirely', ({ string }) => {
    const target = OPEN_STRING_HZ[string];
    const result = engine.detectPitchAutocorrelation(
      steadyTone(target, BUFFER, { partials: MISSING_FUNDAMENTAL_PARTIALS }),
      SAMPLE_RATE
    );

    expect(result.freq).not.toBeNull();
    expect(Math.abs(centsBetween(result.freq!, target))).toBeLessThan(30);
  });

  it.each([-40, -12, -5, 0, 5, 12, 40])('reports %i cents of detuning accurately', (offset) => {
    const result = engine.detectPitchAutocorrelation(
      steadyTone(OPEN_STRING_HZ[5], BUFFER, { cents: offset }),
      SAMPLE_RATE
    );

    expect(result.stringMatch).not.toBeNull();
    expect(result.stringMatch!.cents).toBeCloseTo(offset, 0);
    expect(result.stringMatch!.inTune).toBe(Math.abs(offset) <= 5);
  });

  it('reports nothing for noise or silence', () => {
    expect(engine.detectPitchAutocorrelation(whiteNoise(BUFFER, 0.15), SAMPLE_RATE).freq).toBeNull();
    expect(engine.detectPitchAutocorrelation(new Float32Array(BUFFER), SAMPLE_RATE).freq).toBeNull();
  });
});

describe('fret matching', () => {
  it('maps each open string to fret 0 on its own string', () => {
    for (const { string } of OPEN_STRINGS) {
      const result = engine.detectPitchAutocorrelation(steadyTone(OPEN_STRING_HZ[string], BUFFER), SAMPLE_RATE);
      expect(result.fretMatch).toEqual(expect.objectContaining({ string, fret: 0 }));
    }
  });

  // A pitch is playable in several places; the tie used to fall to whichever string the loop
  // reached first rather than to the easiest position.
  it('prefers first position when the same pitch sits on two strings', () => {
    const result = engine.detectPitchAutocorrelation(steadyTone(261.63, BUFFER), SAMPLE_RATE);
    expect(result.fretMatch).toEqual(expect.objectContaining({ string: 2, fret: 1 }));
  });

  it('stays within half a semitone of the fret it reports', () => {
    const result = engine.detectPitchAutocorrelation(steadyTone(196.0, BUFFER, { cents: 30 }), SAMPLE_RATE);
    expect(Math.abs(result.fretMatch!.cents)).toBeLessThan(50);
  });
});
