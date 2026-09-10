import { describe, expect, it } from 'vitest';
import { chordMatchesChroma } from '../chords';
import {
  averageChromas,
  chromaCosine,
  deriveSessionProfile,
  percentile
} from '../sessionProfile';

describe('session profile', () => {
  it('raises the RMS gate above the room noise', () => {
    const noise = [0.001, 0.0012, 0.0008, 0.0011];
    const strums = [0.06, 0.07, 0.055];
    const profile = deriveSessionProfile(noise, strums, {});
    expect(profile.rmsGate).toBeGreaterThan(profile.noiseRms);
    expect(profile.fluxMultiplier).toBeLessThanOrEqual(2.4);
  });

  it('uses a higher flux multiplier when the guitar is close to the noise floor', () => {
    const noise = [0.02, 0.021, 0.019];
    const strums = [0.04, 0.042];
    const profile = deriveSessionProfile(noise, strums, {});
    expect(profile.fluxMultiplier).toBe(3.2);
  });

  it('averages chroma vectors and cosine-matches the stored voicing', () => {
    const a = new Float32Array([0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0.5, 0, 0.3]);
    const b = new Float32Array([0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.45, 0, 0.3]);
    const avg = averageChromas([a, b]);
    expect(chromaCosine(avg, a)).toBeGreaterThan(0.98);

    const profile = deriveSessionProfile([0.001], [0.05], { Am: avg });
    expect(chordMatchesChroma('Am', 220, avg, profile)).toBe(true);

    const cMajor = new Float32Array(12);
    cMajor[0] = 0.4;
    cMajor[4] = 0.35;
    cMajor[7] = 0.25;
    expect(chordMatchesChroma('Am', 261, cMajor, profile)).toBe(false);
  });

  it('returns the middle value of a sorted list', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });
});
