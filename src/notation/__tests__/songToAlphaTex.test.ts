import { describe, expect, it } from 'vitest';
import { songToAlphaTex } from '../songToAlphaTex';
import type { SongProject } from '../../types/editor.types';

function song(notes: SongProject['notes']): SongProject {
  return {
    title: 'Prueba',
    section: '',
    bpm: 90,
    mode: 'notes',
    measures: 1,
    notes,
    chords: []
  };
}

describe('songToAlphaTex', () => {
  it('writes a quarter note and fills the bar with rests', () => {
    const tex = songToAlphaTex(song([
      { id: 1, measure: 1, beat: 1, step: 1, duration: 4, string: 1, fret: 0, finger: 0 }
    ]));
    expect(tex).toContain('\\title "Prueba"');
    expect(tex).toContain('\\tempo 90');
    expect(tex).toContain(':4 0.1');
    expect(tex).toContain(':4 r');
  });

  it('stacks notes that share a step into a chord', () => {
    const tex = songToAlphaTex(song([
      { id: 1, measure: 1, beat: 1, step: 1, duration: 16, string: 5, fret: 0, finger: 0 },
      { id: 2, measure: 1, beat: 1, step: 1, duration: 16, string: 4, fret: 2, finger: 2 }
    ]));
    expect(tex).toContain(':1 (0.5 2.4)');
  });
});
