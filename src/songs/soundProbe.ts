import type { EditorNote, SongProject } from '../types/editor.types';
import { beatFromStep } from '../rhythm';

export const SOUND_PROBE_TITLE = 'Prueba de sonido';

/** Open string, then frets 1 through 12. Each fret is played on strings 1 to 6. */
const FRETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function buildNotes(): EditorNote[] {
  const notes: EditorNote[] = [];
  let index = 0;
  for (const fret of FRETS) {
    for (let string = 1; string <= 6; string++) {
      const stepIndex = index * 4;
      const measure = Math.floor(stepIndex / 16) + 1;
      const step = (stepIndex % 16) + 1;
      notes.push({
        id: index + 1,
        measure,
        beat: beatFromStep(step),
        step,
        duration: 4,
        string,
        fret,
        finger: fret === 0 ? 0 : 1
      });
      index++;
    }
  }
  return notes;
}

const notes = buildNotes();
const last = notes[notes.length - 1];

export const soundProbeSong: SongProject = {
  title: SOUND_PROBE_TITLE,
  section: 'Calibración',
  bpm: 48,
  mode: 'notes',
  measures: last.measure,
  notes,
  chords: []
};
