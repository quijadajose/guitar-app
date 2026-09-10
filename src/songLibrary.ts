import type { LegacySongProject, SongProject } from './types/editor.types';
import { sanitizeSongProject } from './songSafety';

const LIBRARY_KEY = 'guitar_song_library';
const EDITOR_ID_KEY = 'guitar_editor_song_id';
const MAX_SONGS = 40;

export interface StoredSong {
  id: string;
  updatedAt: number;
  song: SongProject;
}

export interface NotePickerItem {
  id: string;
  source: 'leccion' | 'tuya';
  song: SongProject;
}

export function newSongId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getEditorSongId(): string {
  try {
    const existing = localStorage.getItem(EDITOR_ID_KEY);
    if (existing) return existing;
  } catch {
    // ignore
  }
  const id = newSongId();
  setEditorSongId(id);
  return id;
}

export function setEditorSongId(id: string): void {
  try {
    localStorage.setItem(EDITOR_ID_KEY, id);
  } catch {
    // ignore
  }
}

export function loadLibrary(): StoredSong[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredSong[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as { id?: unknown; updatedAt?: unknown; song?: unknown };
      if (typeof rec.id !== 'string') continue;
      const song = sanitizeSongProject(rec.song);
      if (!song) continue;
      out.push({
        id: rec.id,
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0,
        song
      });
    }
    return out;
  } catch {
    return [];
  }
}

function writeLibrary(list: StoredSong[]): void {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list.slice(0, MAX_SONGS)));
  } catch (e) {
    console.warn('Library storage error:', e);
  }
}

export function upsertLibrarySong(id: string, song: SongProject): void {
  const safe = sanitizeSongProject(song);
  if (!safe) return;
  if (safe.notes.length === 0 && safe.chords.length === 0) {
    removeLibrarySong(id);
    return;
  }
  const list = loadLibrary().filter(item => item.id !== id);
  list.unshift({ id, updatedAt: Date.now(), song: safe });
  writeLibrary(list);
}

export function removeLibrarySong(id: string): void {
  writeLibrary(loadLibrary().filter(item => item.id !== id));
}

export function clearLibrary(): void {
  writeLibrary([]);
}

export function listNotePickerItems(builtinByKey: Record<string, LegacySongProject>): NotePickerItem[] {
  const lessons: NotePickerItem[] = [];
  for (const [key, preset] of Object.entries(builtinByKey)) {
    if (key === 'empty_notes' || preset.mode !== 'notes' || !preset.notes.length) continue;
    const song = sanitizeSongProject(JSON.parse(JSON.stringify(preset)));
    if (!song) continue;
    lessons.push({ id: `builtin:${key}`, source: 'leccion', song });
  }

  const yours = loadLibrary()
    .filter(item => item.song.mode === 'notes' && item.song.notes.length > 0)
    .filter(item => !lessons.some(lesson => lesson.song.title === item.song.title && lesson.song.notes.length === item.song.notes.length))
    .map(item => ({ id: item.id, source: 'tuya' as const, song: item.song }));

  return [...lessons, ...yours];
}
