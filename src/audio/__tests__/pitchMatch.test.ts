import { describe, expect, it } from 'vitest';
import { detectPitchAutocorrelation } from '../pitchMatch';
import { SAMPLE_RATE, steadyTone, whiteNoise, centsBetween, WEAK_FUNDAMENTAL_PARTIALS } from './signals';

const tone = (hz: number) => steadyTone(hz, 4096, { partials: WEAK_FUNDAMENTAL_PARTIALS });

describe('detectPitchAutocorrelation', () => {
  // Antes el plegado de octava del afinador se reportaba como la nota oída.
  it.each([92.5, 98.0, 123.47, 130.81, 174.61])('no sube de octava una nota pisada de %f Hz', hz => {
    const r = detectPitchAutocorrelation(tone(hz), SAMPLE_RATE);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(50);
  });

  it.each([392.0, 415.3, 440.0])('no baja de octava %f Hz con ruido de pieza', hz => {
    const clean = tone(hz);
    const noise = whiteNoise(clean.length, 0.12);
    const mixed = clean.map((v, i) => v + noise[i]);
    const r = detectPitchAutocorrelation(mixed, SAMPLE_RATE);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(50);
  });
});
