import { safeGet, safeSet } from './storage';
import type { SongProject } from './types/editor.types';
import { sanitizeSongProject } from './songSafety';

type ScreenId = string;

let switcher: ((id: ScreenId) => void) | null = null;
let queuedGameplaySong: SongProject | null = null;

export function registerScreenSwitcher(fn: (id: ScreenId) => void): void {
  switcher = fn;
}

export function queueGameplaySong(song: SongProject): void {
  queuedGameplaySong = JSON.parse(JSON.stringify(song)) as SongProject;
}

export function takeQueuedGameplaySong(): SongProject | null {
  const song = queuedGameplaySong;
  queuedGameplaySong = null;
  return song;
}

export function goToScreen(id: ScreenId): void {
  switcher?.(id);
}

const LAST_SONG_KEY = 'guitar.lastSong';

export function rememberSong(song: SongProject): void {
  try {
    safeSet(LAST_SONG_KEY, JSON.stringify(song));
  } catch {
    // The song still plays; it just will not survive a reload.
  }
}

export function recallSong(mode: SongProject['mode']): SongProject | null {
  try {
    const raw = safeGet(LAST_SONG_KEY);
    if (!raw) return null;
    // Lo guardado puede venir de una versión vieja o editado a mano: se valida como cualquier canción.
    const song = sanitizeSongProject(JSON.parse(raw));
    if (!song || song.mode !== mode) return null;
    return song;
  } catch {
    return null;
  }
}
