import type { EditorNote, SongProject } from '../types/editor.types';
import { STEPS_PER_MEASURE, noteDurationSteps, noteStep } from '../rhythm';

const DURATION_TOKENS: ReadonlyArray<readonly [number, string]> = [
  [16, '1'],
  [8, '2'],
  [4, '4'],
  [2, '8'],
  [1, '16']
];

function durationChunks(steps: number): string[] {
  const tokens: string[] = [];
  let left = Math.max(1, steps);
  while (left > 0) {
    const match = DURATION_TOKENS.find(([size]) => size <= left) ?? DURATION_TOKENS[DURATION_TOKENS.length - 1];
    tokens.push(match[1]);
    left -= match[0];
  }
  return tokens;
}

function escapeTex(value: string): string {
  return value.replace(/["\\]/g, "'");
}

function writeEvent(token: string, notes: EditorNote[] | null, tie: boolean): string {
  if (!notes || notes.length === 0) return `:${token} r`;
  const mark = tie ? '{t}' : '';
  if (notes.length === 1) {
    const note = notes[0];
    return `:${token} ${note.fret}.${note.string}${mark}`;
  }
  const chord = notes.map(note => `${note.fret}.${note.string}${mark}`).join(' ');
  return `:${token} (${chord})`;
}

function writeMeasure(notes: EditorNote[]): string {
  const byStep = new Map<number, EditorNote[]>();
  for (const note of notes) {
    const step = noteStep(note);
    const group = byStep.get(step) ?? [];
    group.push(note);
    byStep.set(step, group);
  }
  const starts = [...byStep.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  let cursor = 1;
  let startIndex = 0;

  while (cursor <= STEPS_PER_MEASURE) {
    const nextStart = starts[startIndex];
    if (nextStart === undefined || nextStart > cursor) {
      const gapEnd = nextStart === undefined ? STEPS_PER_MEASURE + 1 : nextStart;
      const chunks = durationChunks(gapEnd - cursor);
      for (const token of chunks) parts.push(writeEvent(token, null, false));
      cursor = gapEnd;
      continue;
    }

    const group = byStep.get(nextStart) ?? [];
    const following = starts[startIndex + 1] ?? STEPS_PER_MEASURE + 1;
    const written = Math.min(
      ...group.map(note => noteDurationSteps(note)),
      following - nextStart,
      STEPS_PER_MEASURE - nextStart + 1
    );
    const chunks = durationChunks(written);
    chunks.forEach((token, index) => {
      parts.push(writeEvent(token, group, index < chunks.length - 1));
    });
    cursor = nextStart + written;
    startIndex += 1;
  }

  return parts.join(' ');
}

export function songToAlphaTex(song: SongProject): string {
  const measureCount = Math.max(
    song.measures || 1,
    ...song.notes.map(note => note.measure),
    1
  );
  const bars: string[] = [];
  for (let measure = 1; measure <= measureCount; measure += 1) {
    bars.push(writeMeasure(song.notes.filter(note => note.measure === measure)));
  }
  const title = escapeTex(song.title || song.section || 'Lección');
  const tempo = Math.max(40, Math.round(song.bpm || 90));
  return `\\title "${title}"\n\\tempo ${tempo}\n.\n${bars.join(' |\n')}`;
}
