import type { EditorChord, EditorNote, SongProject } from '../types/editor.types';
import { beatFromStep } from '../rhythm';

/** [string, fret, finger] */
type Tab = readonly [number, number, number];

function notesFromTabs(startId: number, measure: number, tabs: Tab[], duration: number, steps: number[]): EditorNote[] {
  return tabs.map((tab, i) => {
    const step = steps[i] ?? 1;
    return {
      id: startId + i,
      measure,
      beat: beatFromStep(step),
      step,
      duration,
      string: tab[0],
      fret: tab[1],
      finger: tab[2]
    };
  });
}

const eighths8 = [1, 3, 5, 7, 9, 11, 13, 15];
const eighths7 = [1, 3, 5, 7, 9, 11, 13];
const eighths5 = [1, 3, 5, 7, 9];
const quarters4 = [1, 5, 9, 13];

const bars: { tabs: Tab[]; duration: number; steps: number[] }[] = [
  { duration: 2, steps: eighths8, tabs: [[1, 0, 0], [2, 4, 4], [1, 0, 0], [2, 4, 4], [1, 0, 0], [2, 0, 0], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [2, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[4, 2, 2], [3, 1, 1], [2, 0, 0], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [1, 0, 0]] },
  { duration: 2, steps: eighths7, tabs: [[2, 4, 4], [1, 0, 0], [2, 4, 4], [1, 0, 0], [2, 0, 0], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [2, 0, 0]] },
  { duration: 2, steps: eighths5, tabs: [[4, 2, 2], [2, 1, 1], [2, 0, 0], [3, 2, 2], [5, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[2, 0, 0], [2, 1, 1], [2, 3, 3], [1, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[5, 3, 3], [4, 2, 2], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[2, 0, 0], [5, 2, 2], [4, 0, 0], [2, 1, 1], [2, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [2, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[1, 0, 0], [1, 0, 0], [2, 4, 4], [1, 0, 0]] },
  { duration: 2, steps: eighths7, tabs: [[2, 4, 4], [1, 0, 0], [2, 4, 4], [1, 0, 0], [2, 0, 0], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [2, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[4, 2, 2], [3, 1, 1], [2, 0, 0], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [1, 0, 0]] },
  { duration: 2, steps: eighths7, tabs: [[2, 4, 4], [1, 0, 0], [2, 4, 4], [1, 0, 0], [2, 0, 0], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [3, 2, 2], [2, 0, 0]] },
  { duration: 2, steps: eighths5, tabs: [[4, 2, 2], [2, 1, 1], [2, 0, 0], [3, 2, 2], [5, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[2, 0, 0], [2, 1, 1], [2, 3, 3], [1, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[5, 3, 3], [4, 2, 2], [2, 3, 3], [2, 1, 1]] },
  { duration: 2, steps: eighths5, tabs: [[2, 0, 0], [5, 2, 2], [4, 0, 0], [2, 1, 1], [2, 0, 0]] },
  { duration: 4, steps: quarters4, tabs: [[3, 2, 2], [5, 0, 0], [4, 2, 2], [2, 0, 0]] },
  { duration: 2, steps: eighths5, tabs: [[5, 0, 0], [3, 2, 2], [5, 3, 3], [4, 2, 2], [3, 2, 2]] },
  { duration: 2, steps: eighths5, tabs: [[6, 0, 0], [1, 0, 0], [4, 2, 2], [2, 1, 1], [2, 0, 0]] }
];

const notes: EditorNote[] = [];
let nextId = 1;
bars.forEach((bar, index) => {
  const packed = notesFromTabs(nextId, index + 1, bar.tabs, bar.duration, bar.steps);
  notes.push(...packed);
  nextId += packed.length;
});

const lastMeasure = bars.length + 1;
const chordTabs: Tab[] = [[1, 0, 0], [2, 1, 1], [3, 2, 2], [4, 2, 2], [5, 0, 0]];
for (const tab of chordTabs) {
  notes.push({
    id: nextId++,
    measure: lastMeasure,
    beat: 1,
    step: 1,
    duration: 16,
    string: tab[0],
    fret: tab[1],
    finger: tab[2]
  });
}

const chords: EditorChord[] = [
  { id: 1, measure: lastMeasure, beat: 1, chord: 'Am', duration: 4, color: '#ea5b57' }
];

export const furEliseSong: SongProject = {
  title: 'Für Elise',
  section: 'Tema principal',
  bpm: 72,
  mode: 'notes',
  measures: lastMeasure,
  notes,
  chords
};
