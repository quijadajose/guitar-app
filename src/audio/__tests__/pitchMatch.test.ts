import { describe, expect, it } from 'vitest';
import { detectPitchAutocorrelation } from '../pitchMatch';
import { SAMPLE_RATE, steadyTone, whiteNoise, centsBetween, NOTE_HZ, WEAK_FUNDAMENTAL_PARTIALS } from './signals';

const tone = (hz: number) => steadyTone(hz, 4096, { partials: WEAK_FUNDAMENTAL_PARTIALS });

describe('detectPitchAutocorrelation', () => {
  // Antes el plegado de octava del afinador se reportaba como la nota oída.
  it.each([92.5, 98.0, 123.47, 130.81, 174.61])('no sube de octava una nota pisada de %f Hz', hz => {
    const r = detectPitchAutocorrelation(tone(hz), SAMPLE_RATE);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(50);
  });

  it.each([155.56, 392.0, 415.3, 440.0, 493.88])('no baja de octava %f Hz con ruido de pieza', hz => {
    const clean = tone(hz);
    const noise = whiteNoise(clean.length, 0.12);
    const mixed = clean.map((v, i) => v + noise[i]);
    const r = detectPitchAutocorrelation(mixed, SAMPLE_RATE);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(50);
  });

  it.each([82.41, 110.0, 146.83])('no sube de octava una cuerda grave sin fundamental %f Hz', hz => {
    const r = detectPitchAutocorrelation(steadyTone(hz, 4096, { partials: [0.05, 1.0, 0.85, 0.5, 0.3, 0.2] }), SAMPLE_RATE);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(50);
  });

  it('detects B2 and rejects exact mains hum', () => {
    const b2 = detectPitchAutocorrelation(steadyTone(123.47, 4096), SAMPLE_RATE);
    expect(b2.freq).not.toBeNull();
    expect(Math.abs(centsBetween(b2.freq!, 123.47))).toBeLessThan(50);

    for (const hum of [60, 120, 180]) {
      const r = detectPitchAutocorrelation(steadyTone(hum, 4096, { partials: [1] }), SAMPLE_RATE);
      expect(r.freq).toBeNull();
    }
  });

  it('reads a weak-fundamental E2 near 82 Hz, not an octave away', () => {
    const hz = 82.41;
    const r = detectPitchAutocorrelation(
      steadyTone(hz, 4096, { partials: [0.05, 1.0, 0.85, 0.5, 0.3, 0.2] }),
      SAMPLE_RATE
    );
    expect(r.freq).not.toBeNull();
    expect(Math.abs(r.freq! - hz)).toBeLessThan(2);
  });

  it('keeps a string 1.5 semitones flat and reports the real frequency', () => {
    const hz = NOTE_HZ.E4 * Math.pow(2, -1.5 / 12);
    const r = detectPitchAutocorrelation(steadyTone(hz, 4096), SAMPLE_RATE);
    expect(r.stringMatch?.name).toBe('E4');
    expect(r.freq).not.toBeNull();
    expect(Math.abs(centsBetween(r.freq!, hz))).toBeLessThan(40);
    expect(Math.abs(centsBetween(r.freq!, hz * 2))).toBeGreaterThan(1100);
  });
});
