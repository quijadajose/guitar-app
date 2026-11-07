import { multiplayerOrigin } from '../../services/network/serverStatus';
import type { GameMode } from '../../types/multiplayer';
import { asPublicRoom } from './shared';
import type { PublicRoomRow } from './shared';
import type { VersusLobby } from '../versusLobby';

export async function refreshPublicRooms(eng: VersusLobby): Promise<void> {
  const list = document.getElementById('vs-public-rooms');
  if (!list) return;
  list.replaceChildren();
  try {
    const res = await fetch(`${multiplayerOrigin()}/rooms`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rooms?: unknown };
    const rows = Array.isArray(body.rooms) ? body.rooms : [];
    eng.publicRooms = rows
      .map(asPublicRoom)
      .filter((room): room is PublicRoomRow => room !== null)
      .slice(0, 100);
    eng.renderPublicRooms();
  } catch {
    const empty = document.createElement('p');
    empty.className = 'song-picker-empty';
    empty.textContent = 'No se pudo cargar la lista de salas.';
    list.replaceChildren(empty);
  }
}

export function renderPublicRooms(eng: VersusLobby): void {
  const list = document.getElementById('vs-public-rooms');
  if (!list) return;
  list.replaceChildren();
  const count = document.getElementById('vs-public-count');
  if (count) count.textContent = String(eng.publicRooms.length);
  const rooms = eng.publicRooms.filter((room) => room.mode === eng.selectedMode && room.song_id === eng.selectedSongId);
  if (rooms.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'song-picker-empty';
    empty.textContent = 'No hay salas públicas con ese modo y esa canción.';
    list.append(empty);
    return;
  }
  const modes: Record<GameMode, string> = {
    classic: 'Clásico',
    sudden_death: 'Muerte súbita',
    face_off: 'Ataques',
  };
  const songs: Record<string, string> = {
    sultans_swing: 'Melodía',
    fur_elise: 'Für Elise',
    chords_progression: 'Acordes',
  };
  for (const room of rooms) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'song-picker-item';
    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'song-picker-item-title';
    title.textContent = room.host_name;
    const meta = document.createElement('span');
    meta.className = 'song-picker-item-meta';
    meta.textContent = `${modes[room.mode] ?? room.mode} · ${songs[room.song_id] ?? room.song_id}`;
    text.append(title, meta);
    const code = document.createElement('span');
    code.className = 'song-picker-item-bpm';
    code.textContent = room.code;
    item.append(text, code);
    item.addEventListener('click', () => {
      void eng.joinRoom(room.code);
    });
    list.append(item);
  }
}
