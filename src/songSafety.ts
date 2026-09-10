import type { EditorChord, EditorNote, SongProject } from './types/editor.types';
import { beatFromStep, noteDurationSteps, STEPS_PER_MEASURE, stepFromLegacyBeat } from './rhythm';

export const SONG_LIMITS = {
  titleMax: 80,
  sectionMax: 80,
  bpmMin: 50,
  bpmMax: 180,
  measuresMin: 1,
  measuresMax: 32,
  notesMax: 2048,
  chordsMax: 256,
  jsonMaxBytes: 512 * 1024,
  audioMaxBytes: 50 * 1024 * 1024
} as const;

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CHORD_NAME = /^[A-G][#b]?(m|maj7|maj|min|dim|aug|sus2|sus4|add9|7|9|11|13|6|m7)?$/i;
const MEDIA_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|mp4|webm|mov)$/i;
const MEDIA_TYPES = /^(audio|video)\//;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function sanitizePlainText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, max);
}

export function sanitizeCssColor(value: unknown, fallback = '#ea5b57'): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!HEX_COLOR.test(v)) return fallback;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return v.toLowerCase();
}

export function sanitizeFinger(value: unknown): number {
  return clampInt(value, 0, 4, 0);
}

export function fingerChipClass(finger: number): string {
  return `grid-note-chip chip-finger-${sanitizeFinger(finger)}`;
}

export function fingerCapsuleClass(finger: number): string {
  const map: Record<number, string> = {
    0: 'note-capsule-grey',
    1: 'note-capsule-orange',
    2: 'note-capsule-cyan',
    3: 'note-capsule-magenta',
    4: 'note-capsule-purple'
  };
  return map[sanitizeFinger(finger)];
}

export function sanitizeChordName(value: unknown): string {
  if (typeof value !== 'string') return 'C';
  const t = value.trim().slice(0, 16);
  return CHORD_NAME.test(t) ? t : 'C';
}

export function sanitizeDownloadName(title: string): string {
  const base = sanitizePlainText(title, 60, 'cancion')
    .replace(/[^\w\u00C0-\u024F-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'cancion';
}

export function isAllowedMediaFile(file: File): boolean {
  if (file.size <= 0 || file.size > SONG_LIMITS.audioMaxBytes) return false;
  if (MEDIA_TYPES.test(file.type)) return true;
  return MEDIA_EXT.test(file.name);
}

export function isAllowedJsonFile(file: File): boolean {
  if (file.size <= 0 || file.size > SONG_LIMITS.jsonMaxBytes) return false;
  if (file.type && file.type !== 'application/json' && file.type !== 'text/json' && file.type !== 'text/plain') {
    return file.name.toLowerCase().endsWith('.json');
  }
  return file.name.toLowerCase().endsWith('.json');
}

function sanitizeNote(raw: unknown, index: number): EditorNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  const stringNum = clampInt(n.string, 1, 6, 0);
  const fret = clampInt(n.fret, 0, 24, -1);
  const measure = clampInt(n.measure, 1, SONG_LIMITS.measuresMax, 0);
  const rawStep = typeof n.step === 'number' ? n.step : stepFromLegacyBeat(clampInt(n.beat, 1, 4, 1));
  const step = clampInt(rawStep, 1, STEPS_PER_MEASURE, 0);
  if (!stringNum || fret < 0 || !measure || !step) return null;
  return {
    id: clampInt(n.id, 1, 1_000_000, index + 1),
    measure,
    beat: beatFromStep(step),
    step,
    duration: noteDurationSteps(n),
    string: stringNum,
    fret,
    finger: sanitizeFinger(n.finger)
  };
}

function sanitizeChord(raw: unknown, index: number): EditorChord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const measure = clampInt(c.measure, 1, SONG_LIMITS.measuresMax, 0);
  const beat = clampInt(c.beat, 1, 4, 0);
  if (!measure || !beat) return null;
  const durationBeats = c.durationBeats ?? c.duration;
  return {
    id: clampInt(c.id, 1, 1_000_000, index + 1),
    measure,
    beat,
    chord: sanitizeChordName(c.chord),
    duration: clampInt(durationBeats, 1, 16, 4),
    color: sanitizeCssColor(c.color)
  };
}

export function sanitizeSongProject(raw: unknown): SongProject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== 'string' && !Array.isArray(o.notes) && !Array.isArray(o.chords)) {
    return null;
  }

  const notesIn = Array.isArray(o.notes) ? o.notes.slice(0, SONG_LIMITS.notesMax) : [];
  const chordsIn = Array.isArray(o.chords) ? o.chords.slice(0, SONG_LIMITS.chordsMax) : [];
  const notes = notesIn.map(sanitizeNote).filter((n): n is EditorNote => n !== null);
  const chords = chordsIn.map(sanitizeChord).filter((c): c is EditorChord => c !== null);

  const mode = o.mode === 'chords' ? 'chords' : 'notes';
  return {
    title: sanitizePlainText(o.title, SONG_LIMITS.titleMax, 'Canción'),
    section: sanitizePlainText(o.section, SONG_LIMITS.sectionMax, 'Canción'),
    bpm: clampInt(o.bpm, SONG_LIMITS.bpmMin, SONG_LIMITS.bpmMax, 85),
    mode,
    measures: clampInt(o.measures, SONG_LIMITS.measuresMin, SONG_LIMITS.measuresMax, 8),
    notes,
    chords
  };
}
