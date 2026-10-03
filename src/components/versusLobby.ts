import { MultiplayerClient } from '../services/network/multiplayerClient';
import { multiplayerOrigin, multiplayerWsUrl } from '../services/network/serverStatus';
import type { GameMode, PlayerRole, PlayerSummary, ServerMessage } from '../types/multiplayer';
import { goToScreen } from '../screens';
import { readPlayer } from '../player';
import { gameplayEngine } from './gameplay';
import { furEliseSong } from '../songs/furElise';

const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const GAME_MODES: readonly GameMode[] = ['classic', 'sudden_death', 'face_off'];
const SONG_IDS = ['sultans_swing', 'fur_elise', 'chords_progression'] as const;

type PublicRoomRow = { code: string; song_id: string; mode: GameMode; host_name: string };

function asPublicRoom(raw: unknown): PublicRoomRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'string' || !ROOM_CODE.test(r.code)) return null;
  if (typeof r.song_id !== 'string' || typeof r.host_name !== 'string') return null;
  if (!GAME_MODES.includes(r.mode as GameMode)) return null;
  return { code: r.code, song_id: r.song_id, mode: r.mode as GameMode, host_name: r.host_name.slice(0, 24) };
}

export class VersusLobby {
  private client: MultiplayerClient | null = null;
  private connecting: Promise<MultiplayerClient> | null = null;
  public currentRoomCode: string | null = null;
  private mySessionId: string | null = null;
  private myRole: PlayerRole | null = null;
  private publicRooms: PublicRoomRow[] = [];
  private roomPublic = false;
  private selectedMode: GameMode = 'classic';
  private selectedSongId = 'sultans_swing';
  private songPrepared = false;
  private localNames: [string, string] | null = null;
  private localTurn: 0 | 1 = 0;
  private localFirst: { score: number; accuracy: number; combo: number } | null = null;
  private rematchPending = false;
  private syncCheckInterval: number | null = null;

  // DOM Elements
  private container: HTMLElement | null = null;
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

    this.roomCodeInput = document.getElementById('vs-room-code-input') as HTMLInputElement;
    this.roomCodeDisplay = document.getElementById('vs-display-room-code');
    this.roomLinkInput = document.getElementById('vs-room-link-copy') as HTMLInputElement;
    this.playersListEl = document.getElementById('vs-players-list');
    this.readyBtn = document.getElementById('vs-btn-ready') as HTMLButtonElement;
    this.startBtn = document.getElementById('vs-btn-start') as HTMLButtonElement;
    this.lobbyViewSection = document.getElementById('vs-active-room');
    this.lobbyConfigSection = document.getElementById('vs-room-creation');
    this.statusMsgEl = document.getElementById('vs-status-msg');

    this.setupListeners();
    this.showPath('how');
  }

  public joinFromLocation(): void {
    this.checkUrlForRoomCode();
  }

  private playerName(): string {
    return readPlayer()?.name || 'Invitado';
  }

  private showPath(path: 'how' | 'local' | 'online'): void {
    const how = document.getElementById('vs-step-how');
    const setup = document.getElementById('vs-step-setup');
    const local = document.getElementById('vs-step-local');
    const online = document.getElementById('vs-step-online');
    if (how) how.hidden = path !== 'how';
    if (setup) setup.hidden = path === 'how';
    if (local) local.hidden = path !== 'local';
    if (online) online.hidden = path !== 'online';
    if (path === 'online') void this.refreshPublicRooms();
  }

  private setupListeners(): void {
    // Modo selector
    const modeButtons = this.container?.querySelectorAll<HTMLElement>('#vs-step-online [data-mode]');
    modeButtons?.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedMode = this.readMode(btn.getAttribute('data-mode'));
        this.renderPublicRooms();
      });
    });
    const localModes = this.container?.querySelectorAll<HTMLElement>('#vs-step-local [data-local-mode]');
    localModes?.forEach((btn) => {
      btn.addEventListener('click', () => {
        localModes.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedMode = this.readMode(btn.getAttribute('data-local-mode'));
      });
    });
    const localSongs = this.container?.querySelectorAll<HTMLElement>('#vs-step-local [data-local-song]');
    localSongs?.forEach((btn) => {
      btn.addEventListener('click', () => {
        localSongs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedSongId = btn.getAttribute('data-local-song') || 'sultans_swing';
      });
    });

    document.getElementById('vs-btn-create-room')?.addEventListener('click', () => {
      void this.createRoom();
    });

    document.getElementById('vs-btn-local')?.addEventListener('click', () => {
      this.startLocalMatch();
    });

    this.container?.querySelectorAll<HTMLElement>('[data-vs-path]').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.vsPath === 'online' ? 'online' : 'local';
        this.showPath(path);
      });
    });
    document.querySelector('#view-vs .btn-back-menu')?.addEventListener('click', (event) => {
      const how = document.getElementById('vs-step-how');
      if (this.client || this.currentRoomCode) {
        event.preventDefault();
        event.stopPropagation();
        this.leaveRoom();
        return;
      }
      if (how?.hidden) {
        event.preventDefault();
        event.stopPropagation();
        this.showPath('how');
      }
    }, true);

    document.getElementById('vs-btn-refresh-rooms')?.addEventListener('click', () => {
      void this.refreshPublicRooms();
    });

    // Unirse a sala
    document.getElementById('vs-btn-join-room')?.addEventListener('click', () => {
      const code = this.roomCodeInput?.value.trim().toUpperCase() ?? '';
      if (ROOM_CODE.test(code)) {
        void this.joinRoom(code);
      } else {
        this.setStatus('Ingresá un código de 5 letras o números', true);
      }
    });

    // Copiar enlace
    document.getElementById('vs-copy-code')?.addEventListener('click', () => {
      const link = this.roomLinkInput?.value;
      if (!link) return;
      if (!navigator.clipboard) {
        this.setStatus(`Copiá este enlace: ${link}`);
        return;
      }
      navigator.clipboard.writeText(link).then(() => {
        const button = document.getElementById('vs-copy-code');
        const label = button?.querySelector('.hub-kicker');
        button?.classList.add('is-copied');
        if (label) label.textContent = 'Enlace copiado';
        window.setTimeout(() => {
          button?.classList.remove('is-copied');
          if (label) label.textContent = 'Clic para copiar';
        }, 1400);
      }).catch(() => {
        this.setStatus(`No se pudo copiar. Enlace: ${link}`, true);
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.myRole !== 'host') return;
        this.selectedMode = this.readMode(btn.dataset.roomMode);
        this.paintRoomSettings();
        this.pushRoomSettings();
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-song]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.myRole !== 'host') return;
        this.selectedSongId = btn.dataset.roomSong || 'sultans_swing';
        this.paintRoomSettings();
        this.pushRoomSettings();
      });
    });
    document.getElementById('vs-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.getElementById('vs-chat-input') as HTMLInputElement | null;
      const text = input?.value.trim().slice(0, 180) ?? '';
      if (!text || !this.client) return;
      this.client.send({ type: 'chat', payload: { text } });
      if (input) input.value = '';
    });
    document.getElementById('vs-room-live-public')?.addEventListener('change', (event) => {
      if (this.myRole !== 'host') return;
      this.roomPublic = (event.target as HTMLInputElement).checked;
      this.pushRoomSettings();
    });

    // Botón Listo
    this.readyBtn?.addEventListener('click', () => {
      if (!this.client) return;
      if (!this.songPrepared && !this.preloadSong()) {
        this.setStatus('No se pudo cargar la canción de la sala', true);
        return;
      }
      const isReady = !(this.readyBtn?.classList.contains('ready-active') ?? false);
      // El estado real llega con room_updated; acá solo se pide el cambio.
      this.client.send({
        type: 'set_ready',
        payload: { ready: isReady },
      });
    });

    // Selector de Canción del Duelo
    const songTabs = this.container?.querySelectorAll<HTMLElement>('#vs-step-online [data-song]');
    songTabs?.forEach((btn) => {
      btn.addEventListener('click', () => {
        songTabs.forEach((tab) => tab.classList.remove('active'));
        btn.classList.add('active');
        this.selectedSongId = btn.getAttribute('data-song') || 'sultans_swing';
        this.renderPublicRooms();
      });
    });

    // Botón de Ataque / Trampas (Face-Off)
    document.getElementById('vs-attack-trigger-btn')?.addEventListener('click', () => {
      gameplayEngine.launchAttack();
    });

    // Tecla Espacio para disparar ataque en Face-Off cuando esté cargado
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && gameplayEngine.isVersusActive && gameplayEngine.isFaceOffMode) {
        e.preventDefault();
        if (gameplayEngine.attackStreak >= gameplayEngine.attackThreshold) {
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
      if (!this.client) return;
      const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
      const rematchBtn = document.getElementById('perf-btn-rematch') as HTMLButtonElement | null;
      if (rematchStatusEl) {
        rematchStatusEl.textContent = 'Solicitud de revancha enviada...';
        rematchStatusEl.hidden = false;
      }
      if (rematchBtn) {
        rematchBtn.disabled = true;
        rematchBtn.textContent = 'Esperando rival...';
      }

      // Antes el anfitrión mandaba start_game a ciegas a los 1,2 s, aunque el rival
      // no hubiera aceptado. Ahora cada uno se marca listo y el anfitrión arranca
      // cuando el servidor confirma que ambos lo están (ver room_updated).
      this.rematchPending = true;
      this.client.send({ type: 'request_rematch' });
      this.client.send({ type: 'set_ready', payload: { ready: true } });
    });
  }

  private readMode(raw: string | null | undefined): GameMode {
    return GAME_MODES.includes(raw as GameMode) ? (raw as GameMode) : 'classic';
  }

  private async ensureClient(): Promise<MultiplayerClient> {
    if (this.client?.isOpen) return this.client;
    // Doble clic en «Crear sala» abría dos sockets: compartir la conexión en curso.
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new MultiplayerClient(multiplayerWsUrl());
      await client.connect();
      client.subscribe((msg: ServerMessage) => this.handleServerMessage(msg));
      client.onClose(() => this.handleDisconnect(client));
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** El socket se cerró sin que el usuario saliera (servidor caído, red, timeout). */
  private handleDisconnect(client: MultiplayerClient): void {
    if (this.client !== client) return;
    this.client = null;
    this.clearSyncCheck();
    const wasInRoom = this.currentRoomCode !== null;
    this.resetRoomState();
    if (wasInRoom) {
      this.setStatus('Se perdió la conexión con el servidor de salas.', true);
      this.showLiveNotice('Conexión perdida');
    }
  }

  private async createRoom(): Promise<void> {
    try {
      this.setStatus('Creando sala en el servidor...');
      const client = await this.ensureClient();
      const playerName = this.playerName();
      this.roomPublic = (document.getElementById('vs-room-public') as HTMLInputElement | null)?.checked ?? false;

      client.send({
        type: 'create_room',
        payload: {
          song_id: this.selectedSongId,
          mode: this.selectedMode,
          player_name: playerName,
          is_public: this.roomPublic,
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
      const res = await fetch(`${multiplayerOrigin()}/rooms`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { rooms?: unknown };
      const rows = Array.isArray(body.rooms) ? body.rooms : [];
      this.publicRooms = rows
        .map(asPublicRoom)
        .filter((room): room is PublicRoomRow => room !== null)
        .slice(0, 100);
      this.renderPublicRooms();
    } catch {
      const empty = document.createElement('p');
      empty.className = 'song-picker-empty';
      empty.textContent = 'No se pudo cargar la lista de salas.';
      list.replaceChildren(empty);
    }
  }

  private renderPublicRooms(): void {
    const list = document.getElementById('vs-public-rooms');
    if (!list) return;
    list.replaceChildren();
    const count = document.getElementById('vs-public-count');
    if (count) count.textContent = String(this.publicRooms.length);
    const rooms = this.publicRooms.filter((room) => room.mode === this.selectedMode && room.song_id === this.selectedSongId);
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
        void this.joinRoom(room.code);
      });
      list.append(item);
    }
  }

  private async joinRoom(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!ROOM_CODE.test(normalized)) {
      this.setStatus('Código de sala inválido', true);
      return;
    }
    try {
      this.setStatus(`Uniéndose a la sala ${normalized}...`);
      const client = await this.ensureClient();
      const playerName = this.playerName();

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
        if (typeof msg.payload.is_public === 'boolean') this.roomPublic = msg.payload.is_public;
        this.showActiveRoom(msg.payload.room_code, msg.payload.role, [
          {
            session_id: msg.payload.session_id,
            name: this.playerName(),
            role: 'host',
            ready: false,
            score: 0,
            combo: 0,
            accuracy: 100,
          },
        ]);
        this.preloadSong();
        this.clearStatus();
        break;
      }

      case 'room_joined': {
        this.currentRoomCode = msg.payload.room_code;
        this.mySessionId = msg.payload.session_id;
        this.myRole = msg.payload.role;
        this.selectedSongId = msg.payload.song_id;
        this.selectedMode = msg.payload.mode;
        if (typeof msg.payload.is_public === 'boolean') this.roomPublic = msg.payload.is_public;
        this.showActiveRoom(msg.payload.room_code, msg.payload.role, msg.payload.players);
        this.preloadSong();
        if (msg.payload.role === 'spectator') {
          this.setStatus('La sala ya tiene dos jugadores: entraste como espectador.');
        } else {
          this.setStatus(this.songPrepared
            ? 'Unido. La canción ya está cargada. Marcate como listo.'
            : 'Unido, pero no se pudo cargar la canción.', !this.songPrepared);
        }
        break;
      }

      case 'room_updated': {
        this.updatePlayersUI(msg.payload.players);
        break;
      }

      case 'chat': {
        this.appendChat(msg.payload.name, msg.payload.text);
        break;
      }

      case 'room_settings': {
        this.selectedSongId = msg.payload.song_id;
        this.selectedMode = msg.payload.mode;
        this.roomPublic = msg.payload.is_public;
        this.paintRoomSettings();
        this.preloadSong();
        const songBadge = document.getElementById('vs-room-song-badge');
        if (songBadge) songBadge.textContent = this.songLabel(this.selectedSongId);
        break;
      }

      case 'game_starting': {
        this.rematchPending = false;
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
          gameplayEngine.applyAttackEffect(msg.payload.attack_type, Math.min(30_000, Math.max(0, msg.payload.duration_ms)));
        }
        break;
      }

      case 'rematch_requested': {
        if (msg.payload.by_session_id === this.mySessionId) break;
        const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
        if (rematchStatusEl) {
          rematchStatusEl.textContent = this.rematchPending
            ? '¡El rival aceptó la revancha! Reiniciando...'
            : 'El rival pide revancha. Tocá «Revancha» para aceptar.';
          rematchStatusEl.hidden = false;
        }
        break;
      }

      case 'error': {
        this.setStatus(String(msg.payload.message).slice(0, 200), true);
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
        this.resetRoomState();
        this.setStatus(text, true);
        break;
      }
    }
  }

  private startLocalMatch(): void {
    const localSong = document.querySelector<HTMLElement>('#vs-step-local [data-local-song].active');
    const localMode = document.querySelector<HTMLElement>('#vs-step-local [data-local-mode].active');
    if (localSong) this.selectedSongId = localSong.getAttribute('data-local-song') || 'sultans_swing';
    if (localMode) this.selectedMode = this.readMode(localMode.getAttribute('data-local-mode'));
    const first = this.playerName();
    const secondInput = document.getElementById('vs-local-name-2') as HTMLInputElement | null;
    const second = secondInput?.value.trim().slice(0, 20) || 'Jugador 2';
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
      const rematch = document.getElementById('perf-btn-rematch');
      if (rematch) rematch.hidden = true;
      if (vsBox) vsBox.hidden = true;
      return;
    }
    const first = this.localFirst;
    gameplayEngine.localPassHandoff = false;
    if (practice) practice.hidden = true;
    // La revancha rápida es del modo en línea; en local se usa «Otra vez».
    const rematch = document.getElementById('perf-btn-rematch');
    if (rematch) rematch.hidden = true;
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
    const chat = document.getElementById('vs-chat-log');
    if (chat) chat.replaceChildren();

    if (this.roomCodeDisplay) this.roomCodeDisplay.textContent = code;
    const songBadge = document.getElementById('vs-room-song-badge');
    if (songBadge) {
      songBadge.textContent = this.songLabel(this.selectedSongId);
    }
    if (this.roomLinkInput) {
      this.roomLinkInput.value = `${window.location.origin}${window.location.pathname}#vs?code=${encodeURIComponent(code)}`;
    }

    if (this.startBtn) {
      this.startBtn.hidden = role !== 'host';
    }
    if (this.readyBtn) {
      // Los espectadores no juegan.
      this.readyBtn.hidden = role === 'spectator';
    }
    this.paintRoomSettings();
    this.updatePlayersUI(players);
  }

  private appendChat(name: string, text: string): void {
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

  private paintRoomSettings(): void {
    const host = this.myRole === 'host';
    document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.roomMode === this.selectedMode);
      btn.disabled = !host;
    });
    document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-song]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.roomSong === this.selectedSongId);
      btn.disabled = !host;
    });
    const pub = document.getElementById('vs-room-live-public') as HTMLInputElement | null;
    if (pub) {
      pub.checked = this.roomPublic;
      pub.disabled = !host;
    }
  }

  private pushRoomSettings(): void {
    if (this.myRole !== 'host' || !this.client) return;
    if (!(SONG_IDS as readonly string[]).includes(this.selectedSongId)) return;
    this.client.send({
      type: 'update_room',
      payload: {
        song_id: this.selectedSongId,
        mode: this.selectedMode,
        is_public: this.roomPublic,
      },
    });
  }

  private updatePlayersUI(players: PlayerSummary[]): void {
    if (!this.playersListEl) return;
    this.playersListEl.replaceChildren();
    const list = Array.isArray(players) ? players.slice(0, 2) : [];

    let allReady = list.length >= 2;

    for (const p of list) {
      if (!p.ready) allReady = false;

      // Si el anfitrión se fue, el servidor promueve al invitado: reflejarlo.
      if (p.session_id === this.mySessionId && p.role !== this.myRole) {
        this.myRole = p.role;
        if (this.startBtn) this.startBtn.hidden = p.role !== 'host';
        this.paintRoomSettings();
      }

      const card = document.createElement('div');
      card.className = `vs-player-card${p.role === 'host' ? ' is-host' : ''}`;
      const avatar = document.createElement('div');
      avatar.className = 'vs-avatar';
      avatar.textContent = p.role === 'host' ? '👑' : '🎸';
      const info = document.createElement('div');
      info.className = 'vs-player-info';
      const name = document.createElement('strong');
      const you = p.session_id === this.mySessionId ? ' (Tú)' : '';
      name.textContent = `${String(p.name).slice(0, 24)}${you}`;
      const role = document.createElement('span');
      role.className = 'vs-player-role';
      role.textContent = String(p.role).toUpperCase();
      info.append(name, role);
      const status = document.createElement('div');
      status.className = `vs-player-status ${p.ready ? 'ready' : 'waiting'}`;
      status.textContent = p.ready ? '✓ Listo' : 'Esperando...';
      card.append(avatar, info, status);
      this.playersListEl.appendChild(card);

      // El botón «Listo» refleja lo que el servidor tiene, no lo que creemos haber mandado.
      if (p.session_id === this.mySessionId && this.readyBtn) {
        this.readyBtn.classList.toggle('ready-active', p.ready);
        this.readyBtn.textContent = p.ready ? '✓ Estoy listo' : 'Listo para tocar';
      }
    }

    if (this.startBtn && this.myRole === 'host') {
      this.startBtn.disabled = !allReady;
      this.startBtn.title = allReady ? 'Iniciar partida' : 'Esperando a que ambos jugadores estén listos';
    }

    // Revancha: el anfitrión arranca solo cuando los dos aceptaron.
    if (this.rematchPending && allReady && this.myRole === 'host' && this.client) {
      this.rematchPending = false;
      this.client.send({ type: 'start_game' });
    }
  }

  private clearSyncCheck(): void {
    if (this.syncCheckInterval !== null) {
      window.clearInterval(this.syncCheckInterval);
      this.syncCheckInterval = null;
    }
  }

  /**
   * Sincronización NTP y cuenta regresiva coordinada
   */
  private handleGameStarting(startAtEpochMs: number, _countdownMs: number): void {
    if (!this.client) return;
    if (this.myRole === 'spectator') {
      this.setStatus('La partida empezó. Los espectadores todavía no pueden verla en vivo.');
      return;
    }

    // Cerrar modal de resultados si venimos de una revancha
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';
    const rematchBtn = document.getElementById('perf-btn-rematch') as HTMLButtonElement | null;
    if (rematchBtn) {
      rematchBtn.disabled = false;
      rematchBtn.textContent = 'Revancha Rápida ⚡';
    }
    const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
    if (rematchStatusEl) rematchStatusEl.hidden = true;

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
        payload: { note_id: noteId, rating, cents_offset: Math.round(centsOffset) },
      });
    };
    gameplayEngine.onNoteMissCallback = (noteId) => {
      this.client?.send({
        type: 'note_hit',
        payload: { note_id: noteId, rating: 'MISS', cents_offset: 0 },
      });
    };
    gameplayEngine.onMatchFinished = (finalScore, maxCombo, accuracy, hits, totalNotes) => {
      // El servidor recalcula este hash con accuracy redondeada a 1 decimal:
      // mandar el mismo valor redondeado para que ambos lados coincidan.
      const acc = Math.round(Math.max(0, Math.min(100, accuracy)) * 10) / 10;
      const raw = `${this.selectedSongId}:${finalScore}:${maxCombo}:${acc.toFixed(1)}:${hits}:${totalNotes}`;
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
          accuracy: acc,
          hits,
          total_notes: totalNotes,
          checksum,
        },
      });
    };

    // Intervalo de espera de sincronización exacta con reloj NTP
    this.clearSyncCheck();
    const deadline = Date.now() + 15_000;
    this.syncCheckInterval = window.setInterval(() => {
      const serverNow = this.client?.getServerNow() ?? Date.now();
      const diff = startAtEpochMs - serverNow;

      if (diff <= 3000 || Date.now() > deadline) {
        this.clearSyncCheck();
        gameplayEngine.beginWithCountdown();
      }
    }, 50);
  }

  private resetRoomState(): void {
    this.clearSyncCheck();
    this.currentRoomCode = null;
    this.mySessionId = null;
    this.myRole = null;
    this.rematchPending = false;
    gameplayEngine.isVersusActive = false;
    gameplayEngine.isFaceOffMode = false;
    gameplayEngine.onTriggerAttack = null;
    gameplayEngine.onProgressUpdate = null;
    gameplayEngine.onNoteHitCallback = null;
    gameplayEngine.onNoteMissCallback = null;
    gameplayEngine.onMatchFinished = null;
    if (this.lobbyViewSection) this.lobbyViewSection.hidden = true;
    if (this.lobbyConfigSection) this.lobbyConfigSection.hidden = false;
  }

  private leaveRoom(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.resetRoomState();
    this.showPath('how');
    this.clearStatus();
  }

  private setStatus(msg: string, isError = false): void {
    if (!this.statusMsgEl) return;
    this.statusMsgEl.textContent = msg;
    this.statusMsgEl.className = `vs-status-box ${isError ? 'error' : 'info'}`;
    this.statusMsgEl.hidden = false;
  }

  private clearStatus(): void {
    if (!this.statusMsgEl) return;
    this.statusMsgEl.textContent = '';
    this.statusMsgEl.hidden = true;
  }

  private showLiveNotice(msg: string): void {
    const rival = document.getElementById('hud-vs-rival');
    // El badge tiene clase, no id: antes getElementById devolvía null y el aviso nunca se veía.
    const badge = rival?.querySelector<HTMLElement>('.hud-vs-rival-badge');
    if (!rival || !badge || !gameplayEngine.isVersusActive) return;
    rival.hidden = false;
    badge.textContent = msg;
  }

  private checkUrlForRoomCode(): void {
    const raw = window.location.hash.replace(/^#/, '');
    const code = new URLSearchParams(raw.split('?')[1] || '').get('code')?.trim().toUpperCase();
    if (!code || !ROOM_CODE.test(code)) return;
    if (this.currentRoomCode === code && this.client) return;
    if (this.roomCodeInput) this.roomCodeInput.value = code;
    this.showPath('online');
    void this.joinRoom(code);
  }
}

export const versusLobby = new VersusLobby();
