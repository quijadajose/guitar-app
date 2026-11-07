import type { GameMode } from '../../types/multiplayer';

export const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
export const GAME_MODES: readonly GameMode[] = ['classic', 'sudden_death', 'face_off'];
export const SONG_IDS = ['sultans_swing', 'fur_elise', 'chords_progression'] as const;

export type PublicRoomRow = { code: string; song_id: string; mode: GameMode; host_name: string };

export function asPublicRoom(raw: unknown): PublicRoomRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'string' || !ROOM_CODE.test(r.code)) return null;
  if (typeof r.song_id !== 'string' || typeof r.host_name !== 'string') return null;
  if (!GAME_MODES.includes(r.mode as GameMode)) return null;
  return { code: r.code, song_id: r.song_id, mode: r.mode as GameMode, host_name: r.host_name.slice(0, 24) };
}
