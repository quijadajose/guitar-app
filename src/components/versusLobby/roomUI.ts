import type { PlayerRole, PlayerSummary } from '../../types/multiplayer';
import { goToScreen } from '../../screens';
import { gameplayEngine } from '../gameplay';
import { ROOM_CODE, SONG_IDS } from './shared';
import type { VersusLobby } from '../versusLobby';

export function songLabel(songId: string): string {
  switch (songId) {
    case 'fur_elise': return '🎼 Für Elise';
    case 'chords_progression': return '🎶 Acordes (Am, C, Em)';
    default: return 'Melodía';
  }
}

export function showActiveRoom(eng: VersusLobby, code: string, role: PlayerRole, players: PlayerSummary[]): void {
  if (eng.lobbyConfigSection) eng.lobbyConfigSection.hidden = true;
  if (eng.lobbyViewSection) eng.lobbyViewSection.hidden = false;
  const chat = document.getElementById('vs-chat-log');
  if (chat) chat.replaceChildren();

  if (eng.roomCodeDisplay) eng.roomCodeDisplay.textContent = code;
  const songBadge = document.getElementById('vs-room-song-badge');
  if (songBadge) {
    songBadge.textContent = eng.songLabel(eng.selectedSongId);
  }
  if (eng.roomLinkInput) {
    eng.roomLinkInput.value = `${window.location.origin}${window.location.pathname}#vs?code=${encodeURIComponent(code)}`;
  }

  if (eng.startBtn) {
    eng.startBtn.hidden = role !== 'host';
  }
  if (eng.readyBtn) {
    // Los espectadores no juegan.
    eng.readyBtn.hidden = role === 'spectator';
  }
  eng.paintRoomSettings();
  eng.updatePlayersUI(players);
}

export function appendChat(name: string, text: string): void {
  const log = document.getElementById('vs-chat-log');
  if (!log) return;
  const line = document.createElement('p');
  line.className = 'vs-chat-line';
  const who = document.createElement('strong');
  who.textContent = String(name).slice(0, 24);
  line.append(who, document.createTextNode(`: ${String(text).slice(0, 180)}`));
  log.append(line);
  // Sin tope, una sala larga acumula nodos para siempre.
  while (log.childElementCount > 200) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

export function paintRoomSettings(eng: VersusLobby): void {
  const host = eng.myRole === 'host';
  document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.roomMode === eng.selectedMode);
    btn.disabled = !host;
  });
  document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-song]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.roomSong === eng.selectedSongId);
    btn.disabled = !host;
  });
  const pub = document.getElementById('vs-room-live-public') as HTMLInputElement | null;
  if (pub) {
    pub.checked = eng.roomPublic;
    pub.disabled = !host;
  }
}

export function pushRoomSettings(eng: VersusLobby): void {
  if (eng.myRole !== 'host' || !eng.client) return;
  if (!(SONG_IDS as readonly string[]).includes(eng.selectedSongId)) return;
  eng.client.send({
    type: 'update_room',
    payload: {
      song_id: eng.selectedSongId,
      mode: eng.selectedMode,
      is_public: eng.roomPublic,
    },
  });
}

export function updatePlayersUI(eng: VersusLobby, players: PlayerSummary[]): void {
  if (!eng.playersListEl) return;
  eng.playersListEl.replaceChildren();
  const list = Array.isArray(players) ? players.slice(0, 2) : [];

  let allReady = list.length >= 2;

  for (const p of list) {
    if (!p.ready) allReady = false;

    // Si el anfitrión se fue, el servidor promueve al invitado: reflejarlo.
    if (p.session_id === eng.mySessionId && p.role !== eng.myRole) {
      eng.myRole = p.role;
      if (eng.startBtn) eng.startBtn.hidden = p.role !== 'host';
      eng.paintRoomSettings();
    }

    const card = document.createElement('div');
    card.className = `vs-player-card${p.role === 'host' ? ' is-host' : ''}`;
    const avatar = document.createElement('div');
    avatar.className = 'vs-avatar';
    avatar.textContent = String(p.name).trim().charAt(0) || '?';
    const info = document.createElement('div');
    info.className = 'vs-player-info';
    const name = document.createElement('strong');
    const you = p.session_id === eng.mySessionId ? ' (Tú)' : '';
    name.textContent = `${String(p.name).slice(0, 24)}${you}`;
    const role = document.createElement('span');
    role.className = 'vs-player-role';
    role.textContent = p.role === 'host' ? 'Anfitrión' : 'Invitado';
    info.append(name, role);
    const status = document.createElement('div');
    status.className = `vs-player-status ${p.ready ? 'ready' : 'waiting'}`;
    status.textContent = p.ready ? 'Listo' : 'No listo';
    card.append(avatar, info, status);
    eng.playersListEl.appendChild(card);

    // El botón «Listo» refleja lo que el servidor tiene, no lo que creemos haber mandado.
    if (p.session_id === eng.mySessionId && eng.readyBtn) {
      eng.readyBtn.classList.toggle('ready-active', p.ready);
      eng.readyBtn.textContent = p.ready ? 'Estoy listo' : 'Listo para tocar';
    }
  }

  if (eng.startBtn && eng.myRole === 'host') {
    eng.startBtn.disabled = !allReady;
    eng.startBtn.title = allReady ? 'Iniciar partida' : 'Esperando a que ambos jugadores estén listos';
  }

  // Revancha: el anfitrión arranca solo cuando los dos aceptaron.
  if (eng.rematchPending && allReady && eng.myRole === 'host' && eng.client) {
    eng.rematchPending = false;
    eng.client.send({ type: 'start_game' });
  }
}

export function clearSyncCheck(eng: VersusLobby): void {
  if (eng.syncCheckInterval !== null) {
    window.clearInterval(eng.syncCheckInterval);
    eng.syncCheckInterval = null;
  }
}

export function handleGameStarting(eng: VersusLobby, startAtEpochMs: number, _countdownMs: number): void {
  if (!eng.client) return;
  if (eng.myRole === 'spectator') {
    eng.setStatus('La partida empezó. Los espectadores todavía no pueden verla en vivo.');
    return;
  }

  // Cerrar modal de resultados si venimos de una revancha
  const modal = document.getElementById('performance-results-modal');
  if (modal) modal.style.display = 'none';
  const rematchBtn = document.getElementById('perf-btn-rematch') as HTMLButtonElement | null;
  if (rematchBtn) {
    rematchBtn.disabled = false;
    rematchBtn.textContent = 'Revancha rápida';
  }
  const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
  if (rematchStatusEl) rematchStatusEl.hidden = true;

  eng.setStatus('¡Partida sincronizada! Comenzando...');

  eng.preloadSong();
  const screen = eng.selectedSongId === 'chords_progression' ? 'chords' : 'notes';
  goToScreen(screen);

  // Configurar modo Versus y modo de juego (Face-Off, etc.)
  gameplayEngine.isVersusActive = true;
  gameplayEngine.isLocalHotseat = false;
  gameplayEngine.localPassHandoff = false;
  gameplayEngine.onLocalRetry = null;
  gameplayEngine.isFaceOffMode = eng.selectedMode === 'face_off';
  gameplayEngine.attackStreak = 0;
  gameplayEngine.updateAttackHUD();

  // Enlazar hook de ataque disparado por el jugador (Face-Off)
  gameplayEngine.onTriggerAttack = (attackType, durationMs) => {
    eng.client?.send({
      type: 'send_attack',
      payload: {
        attack_type: attackType,
        duration_ms: durationMs,
      },
    });
  };

  // Telemetría en tiempo real
  gameplayEngine.onProgressUpdate = (score, combo, accuracy, measure) => {
    eng.client?.send({
      type: 'player_progress',
      payload: { score, combo, accuracy, measure },
    });
  };
  gameplayEngine.onNoteHitCallback = (noteId, rating, centsOffset) => {
    eng.client?.send({
      type: 'note_hit',
      payload: { note_id: noteId, rating, cents_offset: Math.round(centsOffset) },
    });
  };
  gameplayEngine.onNoteMissCallback = (noteId) => {
    eng.client?.send({
      type: 'note_hit',
      payload: { note_id: noteId, rating: 'MISS', cents_offset: 0 },
    });
  };
  gameplayEngine.onMatchFinished = (finalScore, maxCombo, accuracy, hits, totalNotes) => {
    // El servidor recalcula este hash con accuracy redondeada a 1 decimal:
    // mandar el mismo valor redondeado para que ambos lados coincidan.
    const acc = Math.round(Math.max(0, Math.min(100, accuracy)) * 10) / 10;
    const raw = `${eng.selectedSongId}:${finalScore}:${maxCombo}:${acc.toFixed(1)}:${hits}:${totalNotes}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(16).padStart(8, '0');

    eng.client?.send({
      type: 'submit_summary',
      payload: {
        final_score: finalScore,
        max_combo: maxCombo,
        accuracy: acc,
        hits,
        total_notes: totalNotes,
        checksum,
      },
    });
  };

  // Intervalo de espera de sincronización exacta con reloj NTP
  eng.clearSyncCheck();
  const deadline = Date.now() + 15_000;
  eng.syncCheckInterval = window.setInterval(() => {
    const serverNow = eng.client?.getServerNow() ?? Date.now();
    const diff = startAtEpochMs - serverNow;

    if (diff <= 3000 || Date.now() > deadline) {
      eng.clearSyncCheck();
      gameplayEngine.beginWithCountdown();
    }
  }, 50);
}

export function resetRoomState(eng: VersusLobby): void {
  eng.clearSyncCheck();
  eng.currentRoomCode = null;
  eng.mySessionId = null;
  eng.myRole = null;
  eng.rematchPending = false;
  gameplayEngine.isVersusActive = false;
  gameplayEngine.isFaceOffMode = false;
  gameplayEngine.onTriggerAttack = null;
  gameplayEngine.onProgressUpdate = null;
  gameplayEngine.onNoteHitCallback = null;
  gameplayEngine.onNoteMissCallback = null;
  gameplayEngine.onMatchFinished = null;
  if (eng.lobbyViewSection) eng.lobbyViewSection.hidden = true;
  if (eng.lobbyConfigSection) eng.lobbyConfigSection.hidden = false;
}

export function leaveRoom(eng: VersusLobby): void {
  if (eng.client) {
    eng.client.disconnect();
    eng.client = null;
  }
  eng.resetRoomState();
  eng.showPath('how');
  eng.clearStatus();
}

export function setStatus(eng: VersusLobby, msg: string, isError = false): void {
  if (!eng.statusMsgEl) return;
  eng.statusMsgEl.textContent = msg;
  eng.statusMsgEl.className = `vs-status-box ${isError ? 'error' : 'info'}`;
  eng.statusMsgEl.hidden = false;
}

export function clearStatus(eng: VersusLobby): void {
  if (!eng.statusMsgEl) return;
  eng.statusMsgEl.textContent = '';
  eng.statusMsgEl.hidden = true;
}

export function showLiveNotice(msg: string): void {
  const rival = document.getElementById('hud-vs-rival');
  // El badge tiene clase, no id: antes getElementById devolvía null y el aviso nunca se veía.
  const badge = rival?.querySelector<HTMLElement>('.hud-vs-rival-badge');
  if (!rival || !badge || !gameplayEngine.isVersusActive) return;
  rival.hidden = false;
  badge.textContent = msg;
}

export function checkUrlForRoomCode(eng: VersusLobby): void {
  const raw = window.location.hash.replace(/^#/, '');
  const code = new URLSearchParams(raw.split('?')[1] || '').get('code')?.trim().toUpperCase();
  if (!code || !ROOM_CODE.test(code)) return;
  if (eng.currentRoomCode === code && eng.client) return;
  if (eng.roomCodeInput) eng.roomCodeInput.value = code;
  eng.showPath('online');
  void eng.joinRoom(code);
}
