import { describe, expect, it } from 'vitest';
import { AudioNoteExtractor } from '../audioExtractor';
import { fft } from '../fft';
import {
  NOTE_HZ,
  SAMPLE_RATE,
  type MelodyNote,
  type NoteName,
  centsBetween,
  fakeAudioBuffer,
  nearestNote,
  renderMelody,
  steadyTone,
  tabToFrequency,
  whiteNoise
} from './signals';

const extractor = new AudioNoteExtractor();
const SLICE = 2048;
const STEPS_PER_MEASURE = 16;

describe('fft', () => {
  it('puts a pure cosine in exactly its own bin', () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 3 * i) / n);

    fft(re, im);
    const magnitude = (k: number): number => Math.sqrt(re[k] * re[k] + im[k] * im[k]);

    // A real cosine of amplitude 1 splits into two conjugate bins of n/2.
    expect(magnitude(3)).toBeCloseTo(n / 2, 3);
    expect(magnitude(13)).toBeCloseTo(n / 2, 3);
    for (let k = 0; k < n; k++) {
      if (k !== 3 && k !== 13) expect(magnitude(k)).toBeLessThan(1e-3);
    }
  });
});

describe('single note pitch detection', () => {
  const cases: Array<[NoteName, number, number]> = [
    ['E2', NOTE_HZ.E2, 6], ['A2', NOTE_HZ.A2, 5], ['D3', NOTE_HZ.D3, 4],
    ['G3', NOTE_HZ.G3, 3], ['B3', NOTE_HZ.B3, 2], ['E4', NOTE_HZ.E4, 1],
    ['C4', NOTE_HZ.C4, 2], ['A4', NOTE_HZ.A4, 1], ['E5', NOTE_HZ.E5, 1]
  ];

  // E5 is the regression case: peak picking skipped the lobe it started inside, so the highest
  // notes came out an octave low.
  it.each(cases)('detects %s within 5 cents', (_name, freq) => {
    const result = extractor.detectPitchInSlice(steadyTone(freq, SLICE), SAMPLE_RATE);
    expect(result).not.toBeNull();
    expect(Math.abs(centsBetween(result!.freq, freq))).toBeLessThan(5);
  });

  it.each(cases)('places %s on string %i', (_name, freq, expectedString) => {
    const tab = extractor.mapFrequencyToGuitarFret(freq);
    expect(tab?.string).toBe(expectedString);
    expect(Math.abs(centsBetween(freq, tabToFrequency(tab!.string, tab!.fret)))).toBeLessThan(50);
  });

  it('assigns fingers by hand position rather than absolute fret', () => {
    expect(extractor.mapFrequencyToGuitarFret(NOTE_HZ.E4)?.finger).toBe(0); // open
    expect(extractor.mapFrequencyToGuitarFret(NOTE_HZ.C4)?.finger).toBe(1); // fret 1, index
    // Fret 5 is the index finger in fifth position, not the pinky.
    expect(extractor.mapFrequencyToGuitarFret(NOTE_HZ.A4)).toEqual({ string: 1, fret: 5, finger: 1 });
  });

  it('rejects noise and silence', () => {
    expect(extractor.detectPitchInSlice(whiteNoise(SLICE), SAMPLE_RATE)).toBeNull();
    expect(extractor.detectPitchInSlice(new Float32Array(SLICE), SAMPLE_RATE)).toBeNull();
  });
});

describe('onset detection', () => {
  it('finds every attack with no false positives', () => {
    const notes: MelodyNote[] = [
      { note: 'E4' }, { note: 'D4' }, { note: 'C4' }, { note: 'D4' },
      { note: 'E4' }, { note: 'E4', amplitude: 0.22 }, { note: 'E4' }, { note: 'D4' }
    ];
    const { audio, onsetTimes } = renderMelody({ notes, bpm: 120, subdivision: 2, leadInSeconds: 0.37 });

    const detected = extractor.detectOnsets(audio, SAMPLE_RATE, 0.012, 0.12).map(s => s / SAMPLE_RATE);

    expect(detected).toHaveLength(onsetTimes.length);
    for (const expected of onsetTimes) {
      expect(detected.some(t => Math.abs(t - expected) < 0.05)).toBe(true);
    }
  });
});

/** Note names the extractor produced, read back from the string and fret it chose. */
function transcribe(notes: Array<{ string: number; fret: number }>): Array<NoteName | null> {
  return notes.map(n => nearestNote(tabToFrequency(n.string, n.fret)));
}

function globalSteps(notes: Array<{ measure: number; step: number }>): number[] {
  return notes.map(n => (n.measure - 1) * STEPS_PER_MEASURE + (n.step - 1));
}

describe('song extraction', () => {
  it('transcribes eighth notes onto the sixteenth grid', async () => {
    // The two quiet notes are struck while a louder one is still ringing. An RMS-based onset
    // detector drops them, and quantizing to quarter notes used to discard every second note.
    const notes: MelodyNote[] = [
      { note: 'E4' }, { note: 'D4' }, { note: 'C4' }, { note: 'D4' },
      { note: 'E4' }, { note: 'E4', amplitude: 0.22 }, { note: 'E4' }, { note: 'D4' },
      { note: 'D4' }, { note: 'D4' }, { note: 'E4' }, { note: 'G3', amplitude: 0.2 },
      { note: 'E4' }, { note: 'E4' }, { note: 'D4' }, { note: 'C4' }
    ];
    const { audio } = renderMelody({ notes, bpm: 120, subdivision: 2, leadInSeconds: 0.37 });

    const song = await extractor.extractSongProject(fakeAudioBuffer(audio), 'test.wav', {
      threshold: 0.012,
      autoBpm: true
    });

    expect(song.bpm).toBe(120);
    expect(transcribe(song.notes)).toEqual(notes.map(n => n.note));

    // An eighth note is two sixteenth steps.
    const steps = globalSteps(song.notes);
    const gaps = steps.slice(1).map((s, i) => s - steps[i]);
    expect(gaps.every(g => g === 2)).toBe(true);
  });

  it('transcribes quarter notes across the low strings', async () => {
    const notes: MelodyNote[] = [
      { note: 'E2' }, { note: 'A2' }, { note: 'G3' }, { note: 'B3' },
      { note: 'E4' }, { note: 'C4' }, { note: 'D4' }, { note: 'E2' }
    ];
    const { audio } = renderMelody({ notes, bpm: 90, subdivision: 1, leadInSeconds: 0.2 });

    const song = await extractor.extractSongProject(fakeAudioBuffer(audio), 'test.wav', {
      threshold: 0.012,
      autoBpm: true
    });

    expect(song.bpm).toBe(90);
    expect(transcribe(song.notes)).toEqual(notes.map(n => n.note));

    const steps = globalSteps(song.notes);
    const gaps = steps.slice(1).map((s, i) => s - steps[i]);
    expect(gaps.every(g => g === 4)).toBe(true);
  });

  it('represents sixteenth notes, which a quarter-note grid could not', async () => {
    const notes: MelodyNote[] = [
      { note: 'E4' }, { note: 'D4' }, { note: 'C4' }, { note: 'D4' },
      { note: 'E4' }, { note: 'G3' }, { note: 'B3' }, { note: 'C4' }
    ];
    const { audio } = renderMelody({ notes, bpm: 100, subdivision: 4, leadInSeconds: 0.15 });

    const song = await extractor.extractSongProject(fakeAudioBuffer(audio), 'test.wav', {
      threshold: 0.012,
      autoBpm: true
    });

    expect(song.notes).toHaveLength(notes.length);
    expect(transcribe(song.notes)).toEqual(notes.map(n => n.note));

    const steps = globalSteps(song.notes);
    const gaps = steps.slice(1).map((s, i) => s - steps[i]);
    expect(gaps.every(g => g === 1)).toBe(true);
  });

  it('keeps beat consistent with step and stays inside the app limits', async () => {
    const notes: MelodyNote[] = [
      { note: 'E4' }, { note: 'D4' }, { note: 'C4' }, { note: 'D4' }, { note: 'E4' }, { note: 'G3' }
    ];
    const { audio } = renderMelody({ notes, bpm: 110, subdivision: 2, leadInSeconds: 0.3 });

    const song = await extractor.extractSongProject(fakeAudioBuffer(audio), 'test.wav', {});

    for (const note of song.notes) {
      expect(note.beat).toBe(Math.floor((note.step - 1) / 4) + 1);
      expect(note.step).toBeGreaterThanOrEqual(1);
      expect(note.step).toBeLessThanOrEqual(STEPS_PER_MEASURE);
      expect(note.duration).toBeGreaterThanOrEqual(1);
      expect(note.measure).toBeLessThanOrEqual(song.measures);
    }
    expect(song.measures).toBeLessThanOrEqual(32);
  });

  it('produces an empty song from silence rather than throwing', async () => {
    const song = await extractor.extractSongProject(
      fakeAudioBuffer(new Float32Array(SAMPLE_RATE * 3)),
      'silencio.wav',
      {}
    );
    expect(song.notes).toHaveLength(0);
  });
});
