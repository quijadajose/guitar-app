export const STEPS_PER_BEAT = 4;
export const STEPS_PER_MEASURE = 16;
export const STEP_CELL_PX = 24;

export function beatFromStep(step: number): number {
  const s = Math.max(1, Math.min(STEPS_PER_MEASURE, Math.round(step) || 1));
  return Math.floor((s - 1) / STEPS_PER_BEAT) + 1;
}

export function stepFromLegacyBeat(beat: number): number {
  const b = Math.max(1, Math.min(4, Math.round(beat) || 1));
  return (b - 1) * STEPS_PER_BEAT + 1;
}

export function noteStep(n: { beat?: number; step?: number }): number {
  if (typeof n.step === 'number' && n.step >= 1 && n.step <= STEPS_PER_MEASURE) {
    return Math.round(n.step);
  }
  return stepFromLegacyBeat(n.beat ?? 1);
}

export function noteDurationSteps(n: { duration?: number; step?: number }): number {
  if (typeof n.duration === 'number' && n.duration >= 1) {
    return Math.max(1, Math.min(STEPS_PER_MEASURE, Math.round(n.duration)));
  }
  return typeof n.step === 'number' ? 1 : STEPS_PER_BEAT;
}

export function noteStartStepIndex(measure: number, step: number): number {
  return (Math.max(1, measure) - 1) * STEPS_PER_MEASURE + (noteStep({ step }) - 1);
}

export function lastContentStepIndex(song: {
  notes?: Array<{ measure: number; beat?: number; step?: number; duration?: number }>;
  chords?: Array<{ measure: number; beat?: number; duration?: number }>;
}): number {
  let last = -1;
  for (const n of song.notes ?? []) {
    const start = noteStartStepIndex(n.measure, noteStep(n));
    last = Math.max(last, start + noteDurationSteps(n) - 1);
  }
  for (const c of song.chords ?? []) {
    const start = noteStartStepIndex(c.measure, stepFromLegacyBeat(c.beat ?? 1));
    const durBeats = Math.max(1, Math.round(c.duration ?? 4));
    last = Math.max(last, start + durBeats * STEPS_PER_BEAT - 1);
  }
  return last;
}
