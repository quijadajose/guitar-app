import { MultiplayerClient } from '../../services/network/multiplayerClient';
import { multiplayerWsUrl } from '../../services/network/serverStatus';
import type { GameMode, ServerMessage } from '../../types/multiplayer';
import { gameplayEngine } from '../gameplay';
import { GAME_MODES, ROOM_CODE } from './shared';
import type { VersusLobby } from '../versusLobby';

export function readMode(raw: string | null | undefined): GameMode {
  return GAME_MODES.includes(raw as GameMode) ? (raw as GameMode) : 'classic';
}

export async function ensureClient(eng: VersusLobby): Promise<MultiplayerClient> {
  if (eng.client?.isOpen) return eng.client;
  // Doble clic en «Crear sala» abría dos sockets: compartir la conexión en curso.
  if (eng.connecting) return eng.connecting;
  eng.connecting = (async () => {
    const client = new MultiplayerClient(multiplayerWsUrl());
    await client.connect();
    client.subscribe((msg: ServerMessage) => eng.handleServerMessage(msg));
    client.onClose(() => eng.handleDisconnect(client));
    eng.client = client;
    eng.loadServerSongs();
    return client;
  })();
  try {
    return await eng.connecting;
  } finally {
    eng.connecting = null;
  }
}

export function handleDisconnect(eng: VersusLobby, client: MultiplayerClient): void {
  if (eng.client !== client) return;
  eng.client = null;
  eng.clearSyncCheck();
  const wasInRoom = eng.currentRoomCode !== null;
  eng.resetRoomState();
  if (wasInRoom) {
    eng.setStatus('Se perdió la conexión con el servidor de salas.', true);
    eng.showLiveNotice('Conexión perdida');
  }
}

export async function createRoom(eng: VersusLobby): Promise<void> {
  try {
    eng.setStatus('Creando sala en el servidor...');
    const client = await eng.ensureClient();
    const playerName = eng.playerName();
    eng.roomPublic = (document.getElementById('vs-room-public') as HTMLInputElement | null)?.checked ?? false;

    client.send({
      type: 'create_room',
      payload: {
        song_id: eng.selectedSongId,
        mode: eng.selectedMode,
        player_name: playerName,
        is_public: eng.roomPublic,
      },
    });
  } catch (e) {
    console.error(e);
    eng.setStatus('Error al conectar con el servidor de salas', true);
  }
}

export async function joinRoom(eng: VersusLobby, code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!ROOM_CODE.test(normalized)) {
    eng.setStatus('Código de sala inválido', true);
    return;
  }
  try {
    eng.setStatus(`Uniéndose a la sala ${normalized}...`);
    const client = await eng.ensureClient();
    const playerName = eng.playerName();

    client.send({
      type: 'join_room',
      payload: {
        room_code: normalized,
        player_name: playerName,
        as_spectator: false,
      },
    });
  } catch (e) {
    console.error(e);
    eng.setStatus('Error al conectar con el servidor', true);
  }
}

export function handleServerMessage(eng: VersusLobby, msg: ServerMessage): void {
  switch (msg.type) {
    case 'room_created': {
      eng.currentRoomCode = msg.payload.room_code;
      eng.mySessionId = msg.payload.session_id;
      eng.myRole = msg.payload.role;
      eng.selectedSongId = msg.payload.song_id;
      eng.selectedMode = msg.payload.mode;
      if (typeof msg.payload.is_public === 'boolean') eng.roomPublic = msg.payload.is_public;
      eng.showActiveRoom(msg.payload.room_code, msg.payload.role, [
        {
          session_id: msg.payload.session_id,
          name: eng.playerName(),
          role: 'host',
          ready: false,
          score: 0,
          combo: 0,
          accuracy: 100,
        },
      ]);
      eng.preloadSong();
      eng.clearStatus();
      break;
    }

    case 'room_joined': {
      eng.currentRoomCode = msg.payload.room_code;
      eng.mySessionId = msg.payload.session_id;
      eng.myRole = msg.payload.role;
      eng.selectedSongId = msg.payload.song_id;
      eng.selectedMode = msg.payload.mode;
      if (typeof msg.payload.is_public === 'boolean') eng.roomPublic = msg.payload.is_public;
      eng.showActiveRoom(msg.payload.room_code, msg.payload.role, msg.payload.players);
      eng.preloadSong();
      if (msg.payload.role === 'spectator') {
        eng.setStatus('La sala ya tiene dos jugadores: entraste como espectador.');
      } else {
        eng.setStatus(eng.songPrepared
          ? 'Unido. La canción ya está cargada. Marcate como listo.'
          : 'Unido, pero no se pudo cargar la canción.', !eng.songPrepared);
      }
      break;
    }

    case 'room_updated': {
      eng.updatePlayersUI(msg.payload.players);
      break;
    }

    case 'chat': {
      eng.appendChat(msg.payload.name, msg.payload.text);
      break;
    }

    case 'room_settings': {
      eng.selectedSongId = msg.payload.song_id;
      eng.selectedMode = msg.payload.mode;
      eng.roomPublic = msg.payload.is_public;
      eng.paintRoomSettings();
      eng.preloadSong();
      const songBadge = document.getElementById('vs-room-song-badge');
      if (songBadge) songBadge.textContent = eng.songLabel(eng.selectedSongId);
      break;
    }

    case 'game_starting': {
      eng.rematchPending = false;
      eng.handleGameStarting(msg.payload.start_at_epoch_ms, msg.payload.countdown_ms);
      break;
    }

    case 'opponent_progress': {
      if (msg.payload.session_id !== eng.mySessionId) {
        gameplayEngine.updateRivalHUD('Rival', msg.payload.score, msg.payload.accuracy);
      }
      break;
    }

    case 'apply_attack': {
      if (msg.payload.from_session_id !== eng.mySessionId) {
        gameplayEngine.applyAttackEffect(msg.payload.attack_type, Math.min(30_000, Math.max(0, msg.payload.duration_ms)));
      }
      break;
    }

    case 'rematch_requested': {
      if (msg.payload.by_session_id === eng.mySessionId) break;
      const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
      if (rematchStatusEl) {
        rematchStatusEl.textContent = eng.rematchPending
          ? '¡El rival aceptó la revancha! Reiniciando...'
          : 'El rival pide revancha. Tocá «Revancha» para aceptar.';
        rematchStatusEl.hidden = false;
      }
      break;
    }

    case 'error': {
      eng.setStatus(String(msg.payload.message).slice(0, 200), true);
      break;
    }

    case 'room_closing': {
      const secs = Math.max(1, Math.round(msg.payload.closes_in_secs));
      const text = msg.payload.reason === 'empty'
        ? `La sala está vacía y se borrará en ${secs}s.`
        : `Sin actividad: la sala se borrará en ${secs}s. Seguí jugando para mantenerla.`;
      eng.setStatus(text, true);
      eng.showLiveNotice(text);
      break;
    }

    case 'room_closed': {
      const text = msg.payload.reason === 'restart'
        ? 'El servidor se está reiniciando. Volvé a crear o unirte a la sala en un momento.'
        : msg.payload.reason === 'empty'
          ? 'La sala se borró porque quedó vacía.'
          : 'La sala se borró por inactividad.';
      eng.showLiveNotice(text);
      eng.resetRoomState();
      eng.setStatus(text, true);
      break;
    }
  }
}
