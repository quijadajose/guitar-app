import { describe, it, expect } from 'vitest';
import { LivePitchAnalyzer } from '../livePitch';
import { SAMPLE_RATE, renderMelody, whiteNoise, centsBetween, NOTE_HZ, type MelodyNote } from './signals';

const HOP = 1024;

function analyse(audio: Float32Array) {
  const analyzer = new LivePitchAnalyzer(SAMPLE_RATE);
  const frames: { t: number; freq: number | null; onset: boolean }[] = [];
  for (let i = 0; i + HOP <= audio.length; i += HOP) {
    const t = (i + HOP) / SAMPLE_RATE;
    const r = analyzer.pushHop(audio.slice(i, i + HOP), t * 1000);
    frames.push({ t, freq: r.freq, onset: r.isOnset });
  }
  return frames;
}

function melodyWithRoomNoise(notes: MelodyNote[]) {
  const { audio, onsetTimes } = renderMelody({ notes, bpm: 90, subdivision: 1, leadInSeconds: 1 });
  const noise = whiteNoise(audio.length, 0.004);
  for (let i = 0; i < audio.length; i++) audio[i] += noise[i];
  return { frames: analyse(audio), onsetTimes };
}

describe('LivePitchAnalyzer', () => {
  it('reports an onset for every pluck, including a repeated note', () => {
    const { frames, onsetTimes } = melodyWithRoomNoise([{ note: 'A2' }, { note: 'A2' }, { note: 'E4' }, { note: 'E4' }]);
    for (const t of onsetTimes) {
      expect(frames.some(f => f.onset && f.t >= t && f.t < t + 0.08)).toBe(true);
    }
  });

  it('keeps tracking soft and sustained notes in a noisy room', () => {
    const notes: MelodyNote[] = [{ note: 'A2' }, { note: 'D3' }, { note: 'D3', amplitude: 0.3 }, { note: 'E4' }];
    const { frames, onsetTimes } = melodyWithRoomNoise(notes);
    onsetTimes.forEach((t, index) => {
      const target = NOTE_HZ[notes[index].note];
      const window = frames.filter(f => f.t > t + 0.08 && f.t < t + 0.4);
      const onPitch = window.filter(f => f.freq !== null && Math.abs(centsBetween(f.freq, target)) < 30);
      expect(onPitch.length / window.length).toBeGreaterThan(0.6);
    });
  });
});

describe('tuner string match', async () => {
  const { detectPitchAutocorrelation } = await import('../pitchMatch');
  const { steadyTone } = await import('./signals');

  it('still names the string when it is a full semitone flat', () => {
    const r = detectPitchAutocorrelation(steadyTone(NOTE_HZ.A2, 4096, { cents: -100 }), SAMPLE_RATE);
    expect(r.stringMatch?.name).toBe('A2');
    expect(r.stringMatch!.cents).toBeLessThan(-90);
  });

  it('only calls a string in tune within a few cents', () => {
    const off = detectPitchAutocorrelation(steadyTone(NOTE_HZ.D3, 4096, { cents: 12 }), SAMPLE_RATE);
    const on = detectPitchAutocorrelation(steadyTone(NOTE_HZ.D3, 4096, { cents: 2 }), SAMPLE_RATE);
    expect(off.stringMatch?.inTune).toBe(false);
    expect(on.stringMatch?.inTune).toBe(true);
  });
});
