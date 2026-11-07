import { MultiplayerClient } from '../services/network/multiplayerClient';
import type { GameMode, PlayerRole, PlayerSummary, ServerMessage } from '../types/multiplayer';
import type { PublicRoomRow } from './versusLobby/shared';
import { playerName, setupListeners, showPath } from './versusLobby/listeners';
import { createRoom, ensureClient, handleDisconnect, handleServerMessage, joinRoom, readMode } from './versusLobby/connection';
import { refreshPublicRooms, renderPublicRooms } from './versusLobby/publicRooms';
import { armLocalEngine, continueLocal, loadServerSongs, onLocalTurnDone, preloadSong, startLocalMatch } from './versusLobby/localMatch';
import { appendChat, checkUrlForRoomCode, clearStatus, clearSyncCheck, handleGameStarting, leaveRoom, paintRoomSettings, pushRoomSettings, resetRoomState, setStatus, showActiveRoom, showLiveNotice, songLabel, updatePlayersUI } from './versusLobby/roomUI';

export class VersusLobby {
  client: MultiplayerClient | null = null;
  connecting: Promise<MultiplayerClient> | null = null;
  public currentRoomCode: string | null = null;
  mySessionId: string | null = null;
  myRole: PlayerRole | null = null;
  publicRooms: PublicRoomRow[] = [];
  roomPublic = false;
  selectedMode: GameMode = 'classic';
  selectedSongId = 'sultans_swing';
  songPrepared = false;
  serverSongEvents: Map<string, number> | null = null;
  serverSongsLoading = false;
  localNames: [string, string] | null = null;
  localTurn: 0 | 1 = 0;
  localFirst: { score: number; accuracy: number; combo: number } | null = null;
  rematchPending = false;
  syncCheckInterval: number | null = null;

  // DOM Elements
  container: HTMLElement | null = null;
  roomCodeInput: HTMLInputElement | null = null;
  roomCodeDisplay: HTMLElement | null = null;
  roomLinkInput: HTMLInputElement | null = null;
  playersListEl: HTMLElement | null = null;
  readyBtn: HTMLButtonElement | null = null;
  startBtn: HTMLButtonElement | null = null;
  lobbyViewSection: HTMLElement | null = null;
  lobbyConfigSection: HTMLElement | null = null;
  statusMsgEl: HTMLElement | null = null;

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

  playerName(): string { return playerName(); }

  showPath(path: 'how' | 'local' | 'online'): void { return showPath(this, path); }

  setupListeners(): void { return setupListeners(this); }

  readMode(raw: string | null | undefined): GameMode { return readMode(raw); }

  async ensureClient(): Promise<MultiplayerClient> { return ensureClient(this); }

  /** El socket se cerró sin que el usuario saliera (servidor caído, red, timeout). */
  handleDisconnect(client: MultiplayerClient): void { return handleDisconnect(this, client); }

  async createRoom(): Promise<void> { return createRoom(this); }

  async refreshPublicRooms(): Promise<void> { return refreshPublicRooms(this); }

  renderPublicRooms(): void { return renderPublicRooms(this); }

  async joinRoom(code: string): Promise<void> { return joinRoom(this, code); }

  handleServerMessage(msg: ServerMessage): void { return handleServerMessage(this, msg); }

  startLocalMatch(): void { return startLocalMatch(this); }

  armLocalEngine(): void { return armLocalEngine(this); }

  onLocalTurnDone(score: number, accuracy: number): void { return onLocalTurnDone(this, score, accuracy); }

  continueLocal(): void { return continueLocal(this); }

  /** Carga el chart en memoria sin salir del lobby. Host y guest lo hacen al entrar a la sala. */
  preloadSong(): boolean { return preloadSong(this); }

  /** Catálogo de canciones del servidor (GET /songs). Si no responde, no se bloquea: el servidor igual valida. */
  loadServerSongs(): void { return loadServerSongs(this); }

  songLabel(songId: string): string { return songLabel(songId); }

  showActiveRoom(code: string, role: PlayerRole, players: PlayerSummary[]): void { return showActiveRoom(this, code, role, players); }

  appendChat(name: string, text: string): void { return appendChat(name, text); }

  paintRoomSettings(): void { return paintRoomSettings(this); }

  pushRoomSettings(): void { return pushRoomSettings(this); }

  updatePlayersUI(players: PlayerSummary[]): void { return updatePlayersUI(this, players); }

  clearSyncCheck(): void { return clearSyncCheck(this); }

  /**
   * Sincronización NTP y cuenta regresiva coordinada
   */
  handleGameStarting(startAtEpochMs: number, _countdownMs: number): void { return handleGameStarting(this, startAtEpochMs, _countdownMs); }

  resetRoomState(): void { return resetRoomState(this); }

  leaveRoom(): void { return leaveRoom(this); }

  setStatus(msg: string, isError = false): void { return setStatus(this, msg, isError); }

  clearStatus(): void { return clearStatus(this); }

  showLiveNotice(msg: string): void { return showLiveNotice(msg); }

  checkUrlForRoomCode(): void { return checkUrlForRoomCode(this); }
}

export const versusLobby = new VersusLobby();
