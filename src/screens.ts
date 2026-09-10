import type { SongProject } from './types/editor.types';

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
