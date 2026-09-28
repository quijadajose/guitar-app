import { MultiplayerClient } from '../services/network/multiplayerClient';
import { multiplayerOrigin, multiplayerWsUrl } from '../services/network/serverStatus';
import type { GameMode, PlayerRole, PlayerSummary, ServerMessage } from '../types/multiplayer';
import { goToScreen } from '../screens';
import { gameplayEngine } from './gameplay';
import { furEliseSong } from '../songs/furElise';

export class VersusLobby {
  private client: MultiplayerClient | null = null;
  public currentRoomCode: string | null = null;
  private mySessionId: string | null = null;
  private myRole: PlayerRole | null = null;
  private selectedMode: GameMode = 'classic';
  private selectedSongId = 'sultans_swing';
  private songPrepared = false;
  private localNames: [string, string] | null = null;
  private localTurn: 0 | 1 = 0;
  private localFirst: { score: number; accuracy: number; combo: number } | null = null;

  // DOM Elements
  private container: HTMLElement | null = null;
  private guestNameInput: HTMLInputElement | null = null;
  private roomCodeInput: HTMLInputElement | null = null;
  private roomCodeDisplay: HTMLElement | null = null;
  private roomLinkInput: HTMLInputElement | null = null;
  private playersListEl: HTMLElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private lobbyViewSection: HTMLElement | null = null;
  private lobbyConfigSection: HTMLElement | null = null;
  private statusMsgEl: HTMLElement | null = null;

  public init(): void {
    this.container = document.getElementById('view-vs');
    if (!this.container) return;

    this.guestNameInput = document.getElementById('vs-player-name') as HTMLInputElement;
    this.roomCodeInput = document.getElementById('vs-room-code-input') as HTMLInputElement;
    this.roomCodeDisplay = document.getElementById('vs-display-room-code');
    this.roomLinkInput = document.getElementById('vs-room-link-copy') as HTMLInputElement;
    this.playersListEl = document.getElementById('vs-players-list');
    this.readyBtn = document.getElementById('vs-btn-ready') as HTMLButtonElement;
    this.startBtn = document.getElementById('vs-btn-start') as HTMLButtonElement;
    this.lobbyViewSection = document.getElementById('vs-active-room');
    this.lobbyConfigSection = document.getElementById('vs-room-creation');
    this.statusMsgEl = document.getElementById('vs-status-msg');

    // Recuperar o generar nombre de invitado
    if (this.guestNameInput) {
      let savedName = localStorage.getItem('guitar_guest_name');
      if (!savedName) {
        savedName = `Guitarrista_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('guitar_guest_name', savedName);
      }
      this.guestNameInput.value = savedName;
      this.guestNameInput.addEventListener('change', () => {
        if (this.guestNameInput?.value.trim()) {
          localStorage.setItem('guitar_guest_name', this.guestNameInput.value.trim());
        }
      });
    }

    this.setupListeners();
    this.checkUrlForRoomCode();
    void this.refreshPublicRooms();
  }

  private setupListeners(): void {
    // Modo selector
    const modeButtons = this.container?.querySelectorAll('.vs-mode-btn');
    modeButtons?.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedMode = (btn.getAttribute('data-mode') as GameMode) || 'classic';
      });
    });

    document.getElementById('vs-btn-create-room')?.addEventListener('click', () => {
      this.createRoom();
    });

    document.getElementById('vs-btn-local')?.addEventListener('click', () => {
      this.startLocalMatch();
    });

    document.getElementById('vs-btn-refresh-rooms')?.addEventListener('click', () => {
      void this.refreshPublicRooms();
    });

    // Unirse a sala
    document.getElementById('vs-btn-join-room')?.addEventListener('click', () => {
      const code = this.roomCodeInput?.value.trim();
      if (code) {
        this.joinRoom(code);
      } else {
        this.setStatus('Ingresa un código de 5 letras', true);
      }
    });

    // Copiar enlace
    document.getElementById('vs-btn-copy-link')?.addEventListener('click', () => {
      if (this.roomLinkInput?.value) {
        navigator.clipboard.writeText(this.roomLinkInput.value).then(() => {
          this.setStatus('¡Enlace de sala copiado!');
        });
      }
    });

    // Botón Listo
    this.readyBtn?.addEventListener('click', () => {
      if (!this.client) return;
      if (!this.songPrepared && !this.preloadSong()) {
        this.setStatus('No se pudo cargar la canción de la sala', true);
        return;
      }
      const isReady = this.readyBtn?.classList.toggle('ready-active') ?? false;
      if (this.readyBtn) {
        this.readyBtn.textContent = isReady ? '✓ Estoy listo' : 'Listo para tocar';
      }
      this.client.send({
        type: 'set_ready',
        payload: { ready: isReady },
      });
    });

    // Selector de Canción del Duelo
    const songSelect = document.getElementById('vs-song-select') as HTMLSelectElement | null;
    if (songSelect) {
      songSelect.value = this.selectedSongId;
      songSelect.addEventListener('change', () => {
        this.selectedSongId = songSelect.value;
      });
    }

    // Botón de Ataque / Trampas (Face-Off)
    document.getElementById('vs-attack-trigger-btn')?.addEventListener('click', () => {
      gameplayEngine.launchAttack();
    });

    // Tecla Espacio para disparar ataque en Face-Off cuando esté cargado
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && gameplayEngine.isVersusActive && gameplayEngine.isFaceOffMode) {
        if (gameplayEngine.attackStreak >= gameplayEngine.attackThreshold) {
          e.preventDefault();
          gameplayEngine.launchAttack();
        }
      }
    });

    // Botón Iniciar (Host)
    this.startBtn?.addEventListener('click', () => {
      if (this.client && this.myRole === 'host') {
        this.client.send({
          type: 'start_game',
        });
      }
    });

    // Botón Revancha Rápida (Modal de Resultados)
    document.getElementById('perf-btn-rematch')?.addEventListener('click', () => {
      if (this.client) {
        const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
        const rematchBtn = document.getElementById('perf-btn-rematch') as HTMLButtonElement;
        if (rematchStatusEl) {
          rematchStatusEl.textContent = 'Solicitud de revancha enviada...';
          rematchStatusEl.hidden = false;
        }
        if (rematchBtn) {
          rematchBtn.disabled = true;
          rematchBtn.textContent = 'Esperando rival...';
        }

        this.client.send({
          type: 'request_rematch',
        });

        // Si es el host, o ambos acuerdan, disparar inicio sincronizado
        if (this.myRole === 'host') {
          setTimeout(() => {
            const modal = document.getElementById('performance-results-modal');
            if (modal) modal.style.display = 'none';
            this.client?.send({
              type: 'start_game',
            });
          }, 1200);
        }
      }
    });

    // Salir de sala
    document.getElementById('vs-btn-leave-room')?.addEventListener('click', () => {
      this.leaveRoom();
    });
  }

  private async ensureClient(): Promise<MultiplayerClient> {
    if (this.client) return this.client;
    // Conectar por WebSocket
    const client = new MultiplayerClient(multiplayerWsUrl());
    await client.connect();

    client.subscribe((msg: ServerMessage) => this.handleServerMessage(msg));
    this.client = client;
    return client;
  }

  private async createRoom(): Promise<void> {
    try {
      this.setStatus('Creando sala en el servidor...');
      const client = await this.ensureClient();
      const playerName = this.guestNameInput?.value.trim() || 'Invitado';

      client.send({
        type: 'create_room',
        payload: {
          song_id: this.selectedSongId,
          mode: this.selectedMode,
          player_name: playerName,
          is_public: (document.getElementById('vs-room-public') as HTMLInputElement | null)?.checked ?? false,
        },
      });
    } catch (e) {
      console.error(e);
      this.setStatus('Error al conectar con el servidor de salas', true);
    }
  }

  private async refreshPublicRooms(): Promise<void> {
    const list = document.getElementById('vs-public-rooms');
    if (!list) return;
    list.replaceChildren();
    try {
      const res = await fetch(`${multiplayerOrigin()}/rooms`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        rooms?: Array<{ code: string; song_id: string; mode: GameMode; host_name: string }>;
      };
      const rooms = body.rooms ?? [];
      if (rooms.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'vs-public-empty';
        empty.textContent = 'No hay salas públicas esperando rival.';
        list.append(empty);
        return;
      }
      const modes: Record<GameMode, string> = {
        classic: 'Clásico',
        sudden_death: 'Muerte súbita',
        face_off: 'Ataques',
      };
      for (const room of rooms) {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `${room.host_name} · ${modes[room.mode] ?? room.mode} · ${room.code}`;
        const join = document.createElement('button');
        join.type = 'button';
        join.className = 'vs-btn-secondary';
        join.textContent = 'Unirme';
        join.addEventListener('click', () => {
          void this.joinRoom(room.code);
        });
        item.append(label, join);
        list.append(item);
      }
    } catch {
      const empty = document.createElement('p');
      empty.className = 'vs-public-empty';
      empty.textContent = 'No se pudo cargar la lista de salas.';
      list.replaceChildren(empty);
    }
  }

  private async joinRoom(code: string): Promise<void> {
    try {
      this.setStatus(`Uniéndose a la sala ${code}...`);
      const client = await this.ensureClient();
      const playerName = this.guestNameInput?.value.trim() || 'Invitado';

      client.send({
        type: 'join_room',
        payload: {
          room_code: code,
          player_name: playerName,
          as_spectator: false,
        },
      });
    } catch (e) {
      console.error(e);
      this.setStatus('Error al conectar con el servidor', true);
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created': {
        this.currentRoomCode = msg.payload.room_code;
        this.mySessionId = msg.payload.session_id;
        this.myRole = msg.payload.role;
        this.selectedSongId = msg.payload.song_id;
        this.selectedMode = msg.payload.mode;
        this.showActiveRoom(msg.payload.room_code, msg.payload.role, [
          {
            session_id: msg.payload.session_id,
            name: this.guestNameInput?.value || 'Host',
            role: 'host',
            ready: false,
            score: 0,
            combo: 0,
            accuracy: 100,
          },
        ]);
        this.preloadSong();
        this.setStatus('Sala creada. La canción ya está cargada. Comparte el código.');
        break;
      }

      case 'room_joined': {
        this.currentRoomCode = msg.payload.room_code;
        this.mySessionId = msg.payload.session_id;
        this.myRole = msg.payload.role;
        this.selectedSongId = msg.payload.song_id;
        this.selectedMode = msg.payload.mode;
        this.showActiveRoom(msg.payload.room_code, msg.payload.role, msg.payload.players);
        this.preloadSong();
        this.setStatus(this.songPrepared
          ? 'Unido. La canción ya está cargada. Marcate como listo.'
          : 'Unido, pero no se pudo cargar la canción.', !this.songPrepared);
        break;
      }

      case 'room_updated': {
        this.updatePlayersUI(msg.payload.players);
        break;
      }

      case 'game_starting': {
        this.handleGameStarting(msg.payload.start_at_epoch_ms, msg.payload.countdown_ms);
        break;
      }

      case 'opponent_progress': {
        if (msg.payload.session_id !== this.mySessionId) {
          gameplayEngine.updateRivalHUD('Rival', msg.payload.score, msg.payload.accuracy);
        }
        break;
      }

      case 'apply_attack': {
        if (msg.payload.from_session_id !== this.mySessionId) {
          gameplayEngine.applyAttackEffect(msg.payload.attack_type, msg.payload.duration_ms);
        }
        break;
      }

      case 'rematch_requested': {
        const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
        const rematchBtn = document.getElementById('perf-btn-rematch');
        if (rematchStatusEl) {
          rematchStatusEl.textContent = '¡El rival aceptó la revancha! Reiniciando...';
          rematchStatusEl.hidden = false;
        }
        if (rematchBtn) {
          rematchBtn.textContent = 'Revancha Aceptada ✓';
        }
        break;
      }

      case 'error': {
        this.setStatus(msg.payload.message, true);
        break;
      }

      case 'room_closing': {
        const secs = Math.max(1, Math.round(msg.payload.closes_in_secs));
        const text = msg.payload.reason === 'empty'
          ? `La sala está vacía y se borrará en ${secs}s.`
          : `Sin actividad: la sala se borrará en ${secs}s. Seguí jugando para mantenerla.`;
        this.setStatus(text, true);
        this.showLiveNotice(text);
        break;
      }

      case 'room_closed': {
        const text = msg.payload.reason === 'empty'
          ? 'La sala se borró porque quedó vacía.'
          : 'La sala se borró por inactividad.';
        this.showLiveNotice(text);
        this.currentRoomCode = null;
        this.mySessionId = null;
        this.myRole = null;
        gameplayEngine.isVersusActive = false;
        if (this.lobbyViewSection) this.lobbyViewSection.hidden = true;
        if (this.lobbyConfigSection) this.lobbyConfigSection.hidden = false;
        this.setStatus(text, true);
        break;
      }
    }
  }

  private startLocalMatch(): void {
    const first = this.guestNameInput?.value.trim() || 'Jugador 1';
    const secondInput = document.getElementById('vs-local-name-2') as HTMLInputElement | null;
    const second = secondInput?.value.trim() || 'Jugador 2';
    this.localNames = [first, second];
    this.localTurn = 0;
    this.localFirst = null;
    if (!this.preloadSong()) {
      this.setStatus('No se pudo cargar la canción', true);
      return;
    }
    this.armLocalEngine();
    const screen = this.selectedSongId === 'chords_progression' ? 'chords' : 'notes';
    goToScreen(screen);
    this.setStatus(`Turno de ${first}. Cuando termine, pasa el aparato.`);
  }

  private armLocalEngine(): void {
    gameplayEngine.isVersusActive = false;
    gameplayEngine.isFaceOffMode = false;
    gameplayEngine.isLocalHotseat = true;
    gameplayEngine.localPassHandoff = false;
    gameplayEngine.attackStreak = 0;
    gameplayEngine.updateAttackHUD();
    gameplayEngine.onTriggerAttack = null;
    gameplayEngine.onProgressUpdate = null;
    gameplayEngine.onNoteHitCallback = null;
    gameplayEngine.onNoteMissCallback = null;
    gameplayEngine.onMatchFinished = (score, _combo, accuracy) => {
      this.onLocalTurnDone(score, accuracy);
    };
    gameplayEngine.onLocalRetry = () => {
      this.continueLocal();
    };
  }

  private onLocalTurnDone(score: number, accuracy: number): void {
    const names = this.localNames;
    if (!names) return;
    const verdict = document.getElementById('perf-verdict-text');
    const retryLabel = document.querySelector('#perf-btn-retry span');
    const practice = document.getElementById('perf-btn-practice');
    const vsBox = document.getElementById('perf-vs-comparison');
    if (this.localTurn === 0) {
      this.localFirst = { score, accuracy, combo: gameplayEngine.maxCombo };
      gameplayEngine.localPassHandoff = true;
      if (verdict) verdict.textContent = `${names[0]} hizo ${score} pts. Pasá el aparato: le toca a ${names[1]}.`;
      if (retryLabel) retryLabel.textContent = `Turno de ${names[1]}`;
      if (practice) practice.hidden = true;
      if (vsBox) vsBox.hidden = true;
      return;
    }
    const first = this.localFirst;
    gameplayEngine.localPassHandoff = false;
    if (practice) practice.hidden = false;
    if (retryLabel) retryLabel.textContent = 'Otra vez';
    if (!first || !vsBox) return;
    vsBox.hidden = false;
    const banner = document.getElementById('perf-vs-banner');
    const myScore = document.getElementById('perf-vs-my-score');
    const myAcc = document.getElementById('perf-vs-my-acc');
    const rivalScore = document.getElementById('perf-vs-rival-score');
    const rivalAcc = document.getElementById('perf-vs-rival-acc');
    const rivalLabel = document.getElementById('perf-vs-rival-label');
    const localBadge = vsBox.querySelector('.player-local .perf-vs-badge');
    if (localBadge) localBadge.textContent = names[0];
    if (rivalLabel) rivalLabel.textContent = names[1];
    if (myScore) myScore.textContent = `${first.score} pts`;
    if (myAcc) myAcc.textContent = `${Math.round(first.accuracy)}% Precisión`;
    if (rivalScore) rivalScore.textContent = `${score} pts`;
    if (rivalAcc) rivalAcc.textContent = `${Math.round(accuracy)}% Precisión`;
    if (banner) {
      if (first.score > score) banner.textContent = `Gana ${names[0]}`;
      else if (score > first.score) banner.textContent = `Gana ${names[1]}`;
      else banner.textContent = 'Empate';
    }
    if (verdict) verdict.textContent = 'Misma canción, dos turnos.';
  }

  private continueLocal(): void {
    const names = this.localNames;
    if (!names) return;
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';
    if (gameplayEngine.localPassHandoff) {
      this.localTurn = 1;
      gameplayEngine.localPassHandoff = false;
    } else {
      this.localTurn = 0;
      this.localFirst = null;
      const retryLabel = document.querySelector('#perf-btn-retry span');
      if (retryLabel) retryLabel.textContent = 'Reintentar';
    }
    this.armLocalEngine();
    gameplayEngine.restartPerformance();
  }

  /** Carga el chart en memoria sin salir del lobby. Host y guest lo hacen al entrar a la sala. */
  private preloadSong(): boolean {
    if (this.selectedSongId === 'fur_elise') {
      gameplayEngine.loadCustomSong(furEliseSong);
    } else if (this.selectedSongId === 'chords_progression') {
      gameplayEngine.init('chords');
    } else if (this.selectedSongId === 'sultans_swing') {
      gameplayEngine.init('notes');
    } else {
      this.songPrepared = false;
      return false;
    }
    this.songPrepared = true;
    return true;
  }

  private songLabel(songId: string): string {
    switch (songId) {
      case 'fur_elise': return '🎼 Für Elise';
      case 'chords_progression': return '🎶 Acordes (Am, C, Em)';
      default: return '🎸 Melodía';
    }
  }

  private showActiveRoom(code: string, role: PlayerRole, players: PlayerSummary[]): void {
    if (this.lobbyConfigSection) this.lobbyConfigSection.hidden = true;
    if (this.lobbyViewSection) this.lobbyViewSection.hidden = false;

    if (this.roomCodeDisplay) this.roomCodeDisplay.textContent = code;
    const songBadge = document.getElementById('vs-room-song-badge');
    if (songBadge) {
      songBadge.textContent = this.songLabel(this.selectedSongId);
    }
    if (this.roomLinkInput) {
      this.roomLinkInput.value = `${window.location.origin}${window.location.pathname}#vs?code=${code}`;
    }

    if (this.startBtn) {
      this.startBtn.hidden = role !== 'host';
    }

    this.updatePlayersUI(players);
  }

  private updatePlayersUI(players: PlayerSummary[]): void {
    if (!this.playersListEl) return;
    this.playersListEl.innerHTML = '';

    let allReady = players.length >= 2;

    for (const p of players) {
      if (!p.ready) allReady = false;

      const card = document.createElement('div');
      card.className = `vs-player-card${p.role === 'host' ? ' is-host' : ''}`;
      const avatar = document.createElement('div');
      avatar.className = 'vs-avatar';
      avatar.textContent = p.role === 'host' ? '👑' : '🎸';
      const info = document.createElement('div');
      info.className = 'vs-player-info';
      const name = document.createElement('strong');
      const you = p.session_id === this.mySessionId ? ' (Tú)' : '';
      name.textContent = `${p.name}${you}`;
      const role = document.createElement('span');
      role.className = 'vs-player-role';
      role.textContent = p.role.toUpperCase();
      info.append(name, role);
      const status = document.createElement('div');
      status.className = `vs-player-status ${p.ready ? 'ready' : 'waiting'}`;
      status.textContent = p.ready ? '✓ Listo' : 'Esperando...';
      card.append(avatar, info, status);
      this.playersListEl.appendChild(card);
    }

    if (this.startBtn && this.myRole === 'host') {
      this.startBtn.disabled = !allReady;
      this.startBtn.title = allReady ? 'Iniciar partida' : 'Esperando a que ambos jugadores estén listos';
    }
  }

  /**
   * Sincronización NTP y cuenta regresiva coordinada
   */
  private handleGameStarting(startAtEpochMs: number, _countdownMs: number): void {
    if (!this.client) return;

    // Cerrar modal de resultados si venimos de una revancha
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';

    this.setStatus('¡Partida sincronizada! Comenzando...');

    this.preloadSong();
    const screen = this.selectedSongId === 'chords_progression' ? 'chords' : 'notes';
    goToScreen(screen);

    // Configurar modo Versus y modo de juego (Face-Off, etc.)
    gameplayEngine.isVersusActive = true;
    gameplayEngine.isLocalHotseat = false;
    gameplayEngine.localPassHandoff = false;
    gameplayEngine.onLocalRetry = null;
    gameplayEngine.isFaceOffMode = this.selectedMode === 'face_off';
    gameplayEngine.attackStreak = 0;
    gameplayEngine.updateAttackHUD();

    // Enlazar hook de ataque disparado por el jugador (Face-Off)
    gameplayEngine.onTriggerAttack = (attackType, durationMs) => {
      this.client?.send({
        type: 'send_attack',
        payload: {
          attack_type: attackType,
          duration_ms: durationMs,
        },
      });
    };

    // Telemetría en tiempo real
    gameplayEngine.onProgressUpdate = (score, combo, accuracy, measure) => {
      this.client?.send({
        type: 'player_progress',
        payload: { score, combo, accuracy, measure },
      });
    };
    gameplayEngine.onNoteHitCallback = (noteId, rating, centsOffset) => {
      this.client?.send({
        type: 'note_hit',
        payload: { note_id: noteId, rating, cents_offset: centsOffset },
      });
    };
    gameplayEngine.onNoteMissCallback = (noteId) => {
      this.client?.send({
        type: 'note_hit',
        payload: { note_id: noteId, rating: 'MISS', cents_offset: 0 },
      });
    };
    gameplayEngine.onMatchFinished = (finalScore, maxCombo, accuracy, hits, totalNotes) => {
      // Checksum anti-cheat ligero: hash FNV-1a (score + hits + combo + songId)
      const raw = `${this.selectedSongId}:${finalScore}:${maxCombo}:${accuracy.toFixed(1)}:${hits}:${totalNotes}`;
      let hash = 0x811c9dc5;
      for (let i = 0; i < raw.length; i++) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      const checksum = (hash >>> 0).toString(16).padStart(8, '0');

      this.client?.send({
        type: 'submit_summary',
        payload: {
          final_score: finalScore,
          max_combo: maxCombo,
          accuracy,
          hits,
          total_notes: totalNotes,
          checksum,
        },
      });
    };

    // Intervalo de espera de sincronización exacta con reloj NTP
    const syncCheckInterval = window.setInterval(() => {
      const serverNow = this.client?.getServerNow() ?? Date.now();
      const diff = startAtEpochMs - serverNow;

      if (diff <= 3000) {
        window.clearInterval(syncCheckInterval);
        gameplayEngine.beginWithCountdown();
      }
    }, 50);
  }

  private leaveRoom(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.currentRoomCode = null;
    this.mySessionId = null;
    this.myRole = null;

    if (this.lobbyViewSection) this.lobbyViewSection.hidden = true;
    if (this.lobbyConfigSection) this.lobbyConfigSection.hidden = false;
    this.setStatus('Has salido de la sala.');
    void this.refreshPublicRooms();
  }

  private setStatus(msg: string, isError = false): void {
    if (!this.statusMsgEl) return;
    this.statusMsgEl.textContent = msg;
    this.statusMsgEl.className = `vs-status-box ${isError ? 'error' : 'info'}`;
    this.statusMsgEl.hidden = false;
  }

  private showLiveNotice(msg: string): void {
    const rival = document.getElementById('hud-vs-rival');
    const badge = document.getElementById('hud-vs-rival-badge');
    if (!rival || !badge || !gameplayEngine.isVersusActive) return;
    rival.hidden = false;
    badge.textContent = msg;
  }

  private checkUrlForRoomCode(): void {
    const hash = window.location.hash;
    if (hash.includes('code=')) {
      const match = hash.match(/code=([A-Za-z0-9]+)/);
      if (match && match[1]) {
        const code = match[1].toUpperCase();
        if (this.roomCodeInput) this.roomCodeInput.value = code;
        goToScreen('vs');
        this.joinRoom(code);
      }
    }
  }
}

export const versusLobby = new VersusLobby();
