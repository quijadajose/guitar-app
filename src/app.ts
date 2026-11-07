import { guitarAudio } from './audio/audioEngine';
import { startEditorTour } from './editorTour';
import { songEditor } from './components/editor';
import { gameplayEngine } from './components/gameplay';
import { sessionCalibrator } from './components/calibration';
import { tunerMotion } from './components/tunerMotion';
import type { PitchMatchResult } from './types/audio.types';
import { registerScreenSwitcher, takeQueuedGameplaySong, recallSong } from './screens';
import { publishLiveFrame } from './audio/liveFeed';
import { TUNER_IN_TUNE_CENTS } from './audio/pitchMatch';
import { type DifficultyLevel } from './services/supabase';
import { bindPlayerGate } from './screens/playerGate';
import { pitchLab } from './debug/pitchLab';
import { applyNoteNaming, readNotationView } from './notation/notationPreference';
import { demoSheetProject, encodeWav, triggerDownload } from './app/helpers';
import { animateStringVibration, attachMicForScreen, detachAllMicListeners, fillTunerPitchLabel, grantMicAndAttach, markStringTuned, queryMicPermissionState, rememberMicGranted, resetTunerActiveState, setupTuner, showTunerComplete, startTunerMicrophone, stopTunerMicrophone, syncMicForScreen } from './app/tuner';
import { bindTunerDebugPanel, drawTunerDebug, startTunerDebug, stopTunerDebug } from './app/tunerDebug';
import { renderSongPicker, setupSongPickerTabs } from './app/songPicker';
import { setupNavigation } from './app/navigation';
import { setupAccount, setupNotationSettings } from './app/settings';
import { resizeCanvases, setupGameplay, startGameplayMicrophone, stopGameplayMicrophone } from './app/gameplaySetup';
import { setupHotkeys } from './app/hotkeys';
import { checkHash, joinRoomWhenReady, refreshBackends } from './app/routing';

export class GuitarApp {
  public screens: Record<string, HTMLElement | null> = {};
  public navBtns: NodeListOf<HTMLElement>;
  public skipBtns: NodeListOf<HTMLElement>;
  public menuCards: NodeListOf<HTMLElement>;
  public backBtns: NodeListOf<HTMLElement>;

  public currentScreenId: string = 'menu';
  public multiplayerOnline = false;
  public supabaseOnline = false;
  public readonly flowOrder: string[] = ['tuner', 'songs', 'chords', 'menu'];

  // Tuner state
  public activePeg: number = 2;
  public tunedStrings: Set<number> = new Set<number>();
  public readonly tuningOrder: number[] = [6, 5, 4, 3, 2, 1];
  public tunerCooldownTimer: number | null = null;
  public autoProgressTimer: number | null = null;
  public isMicActive: boolean = false;
  public hasGrantedMicPermission: boolean = false;
  tunerMicCandidate: number | null = null;
  /** Milliseconds the same open string has been detected continuously. */
  tunerMicStableFrames: number = 0;
  tunerMicInTuneMs: number = 0;
  tunerMicLastFrameAt: number = 0;
  tunerSmoothedCents: number | null = null;
  tunerLastPitchTime: number = 0;
  tunerPitchSlots: { name: Element | null; spanish: Element | null; freq: Element | null } | null = null;
  readonly micScreens = new Set(['tuner', 'notes', 'chords', 'fretboard']);

  public readonly tuningInfo: Record<number, { name: string; string: number; freq: number; noteSpanish: string; cents: number }> = {
    1: { name: 'E4', string: 1, freq: 329.63, noteSpanish: 'Mi agudo', cents: 0 },
    2: { name: 'B3', string: 2, freq: 246.94, noteSpanish: 'Si', cents: 0 },
    3: { name: 'G3', string: 3, freq: 196.00, noteSpanish: 'Sol', cents: 0 },
    4: { name: 'D3', string: 4, freq: 146.83, noteSpanish: 'Re', cents: 0 },
    5: { name: 'A2', string: 5, freq: 110.00, noteSpanish: 'La', cents: 0 },
    6: { name: 'E2', string: 6, freq: 82.41, noteSpanish: 'Mi grave', cents: 0 }
  };

  // Practice state
  public isGameplayMicActive: boolean = false;

  // Song Picker State
  public activeSongTab: 'lessons' | 'yours' | 'community' = 'lessons';
  public playKind: 'notes' | 'chords' = 'notes';
  public communityPage: number = 1;
  public communityDifficulty: DifficultyLevel = 'all';
  public communitySearch: string = '';
  public communityTotalPages: number = 1;
  communityDebounceTimer: number | null = null;
  /** Cada render del selector incrementa esto; una respuesta vieja de la red no pisa la vista actual. */
  songPickerGeneration = 0;
  loadedSheet: Promise<typeof import('./notation/sheetView')> | null = null;
  versusReady: Promise<{ joinFromLocation: () => void }> | null = null;
  waitingForPlayerToJoin = false;

  loadSheet(): Promise<typeof import('./notation/sheetView')> {
    this.loadedSheet ??= import('./notation/sheetView');
    return this.loadedSheet;
  }

  ensureVersus(): Promise<{ joinFromLocation: () => void }> {
    this.versusReady ??= import('./components/versusLobby').then(({ versusLobby }) => {
      versusLobby.init();
      return versusLobby;
    });
    return this.versusReady;
  }

  constructor() {
    this.screens = {
      menu: document.getElementById('view-menu'),
      songs: document.getElementById('view-songs'),
      tuner: document.getElementById('view-tuner'),
      notes: document.getElementById('view-notes'),
      chords: document.getElementById('view-chords'),
      editor: document.getElementById('view-editor'),
      vs: document.getElementById('view-vs')
    };

    this.navBtns = document.querySelectorAll<HTMLElement>('.view-tab-btn');
    this.skipBtns = document.querySelectorAll<HTMLElement>('.btn-skip');
    this.menuCards = document.querySelectorAll<HTMLElement>('[data-nav]');
    this.backBtns = document.querySelectorAll<HTMLElement>('.btn-back-menu');
  }

  public init(): void {
    this.setupNavigation();
    this.setupTuner();
    this.setupGameplay();
    this.setupHotkeys();
    sessionCalibrator.bind();

    songEditor.init();
    gameplayEngine.setupScrubbingListeners();
    this.setupNotationSettings();
    this.setupAccount();
    bindPlayerGate();
    pitchLab.bind();
    void this.refreshBackends();

    this.hasGrantedMicPermission =
      guitarAudio.hasMicPermission || sessionStorage.getItem('guitar_mic_granted') === '1';

    registerScreenSwitcher((id: string) => this.switchScreen(id));

    this.checkHash();
    this.activePeg = 0;
  }

  public switchScreen(targetId: string): void {
    const hashRaw = window.location.hash.replace(/^#/, '');
    const roomLink = hashRaw.startsWith('vs') && /(?:^|[?&])code=/i.test(hashRaw);
    if (targetId === 'vs' && !this.multiplayerOnline && !roomLink) {
      targetId = 'menu';
    } else if (targetId === 'vs') {
      void this.ensureVersus();
    }

    // Solo ids propios: evita que un hash raro (#__proto__, #constructor) llegue a this.screens[...].
    if (!Object.prototype.hasOwnProperty.call(this.screens, targetId) || !this.screens[targetId]) {
      console.warn(`Screen ${targetId} not found`);
      return;
    }

    const fromId = this.currentScreenId;
    const alreadyVisible = fromId === targetId && this.screens[targetId]?.classList.contains('view-active');
    const queued = targetId === 'notes' || targetId === 'chords' ? takeQueuedGameplaySong() : null;

    if (alreadyVisible && !queued) {
      return;
    }

    this.currentScreenId = targetId;
    const account = document.getElementById('hub-account');
    if (account) account.hidden = targetId === 'notes' || targetId === 'chords';
    const hashScreen = window.location.hash.replace(/^#/, '').split('?')[0];
    if (hashScreen !== targetId) {
      window.location.hash = targetId;
    }

    this.navBtns.forEach(btn => {
      const isTarget = btn.getAttribute('data-target') === targetId;
      btn.classList.toggle('active', isTarget);
    });

    Object.keys(this.screens).forEach(id => {
      const view = this.screens[id];
      if (view) {
        if (id === targetId) {
          view.classList.remove('view-hidden');
          view.classList.add('view-active');
        } else {
          view.classList.remove('view-active');
          view.classList.add('view-hidden');
        }
      }
    });

    if (targetId === 'songs') {
      void this.renderSongPicker();
    }

    const notesView = this.screens.notes;
    const useSheet = targetId === 'notes' && readNotationView() === 'sheet';
    notesView?.classList.toggle('is-sheet', useSheet);

    if (targetId === 'notes' || targetId === 'chords') {
      if (fromId !== 'notes' && fromId !== 'chords') {
        gameplayEngine.exitTarget = fromId === 'editor' ? 'editor' : fromId === 'songs' ? 'songs' : 'menu';
      }
      if (queued) {
        gameplayEngine.loadCustomSong(queued);
      } else if (fromId === 'editor') {
        gameplayEngine.loadCustomSong(songEditor.currentSong);
      } else if (!gameplayEngine.isCustomSongLoaded) {
        const saved = recallSong(targetId === 'chords' ? 'chords' : 'notes');
        if (saved) gameplayEngine.loadCustomSong(saved);
        else gameplayEngine.setMode(targetId === 'chords' ? 'chords' : 'notes');
      }
      applyNoteNaming();
      if (useSheet) {
        gameplayEngine.cancelCountdown();
        gameplayEngine.pausePlaying();
        const project = gameplayEngine.loadedProject ?? demoSheetProject(gameplayEngine.notesTrack, gameplayEngine.songTitle);
        void this.loadSheet().then(({ renderSheet }) => renderSheet(project));
        requestAnimationFrame(() => {
          sessionCalibrator.start(() => gameplayEngine.beginWithCountdown());
        });
      } else {
        void this.loadedSheet?.then(({ clearSheet }) => clearSheet());
        requestAnimationFrame(() => {
          if (gameplayEngine.mode === 'notes') gameplayEngine.buildDOMNotes();
          else gameplayEngine.buildDOMChords();
          gameplayEngine.renderFrame();
          sessionCalibrator.start(() => gameplayEngine.beginWithCountdown());
        });
      }
    } else {
      sessionCalibrator.abort();
      gameplayEngine.cancelCountdown();
      gameplayEngine.wasPlayingThisSession = false;
      gameplayEngine.pausePlaying();
      if (targetId === 'editor') {
        songEditor.renderGrid();
        window.setTimeout(() => startEditorTour(), 400);
      }
      if (targetId !== 'notes') void this.loadedSheet?.then(({ clearSheet }) => clearSheet());
    }

    setTimeout(() => this.resizeCanvases(), 50);

    try {
      guitarAudio.playClickSound();
    } catch {
      // ignore
    }

    this.detachAllMicListeners();
    if (targetId !== 'tuner') {
      tunerMotion.stop();
    }

    void this.syncMicForScreen(targetId);
  }

  async refreshBackends(): Promise<void> { return refreshBackends(this); }

  setupAccount(): void { return setupAccount(); }

  setupNotationSettings(): void { return setupNotationSettings(); }

  setupNavigation(): void { return setupNavigation(this); }

  setupSongPickerTabs(): void { return setupSongPickerTabs(this); }

  async renderSongPicker(): Promise<void> { return renderSongPicker(this); }

  joinRoomWhenReady(): void { return joinRoomWhenReady(this); }

  checkHash(): void { return checkHash(this); }

  // ================= TUNER LOGIC =================
  setupTuner(): void { return setupTuner(this); }

  public activatePeg(
    pegNum: number,
    manualCents?: number,
    playSound: boolean = false,
    vibrate: boolean = false,
    commitTune: boolean = false
  ): void {
    this.activePeg = pegNum;
    const info = this.tuningInfo[pegNum];
    if (!info) return;

    if (this.tunerCooldownTimer !== null) {
      clearTimeout(this.tunerCooldownTimer);
      this.tunerCooldownTimer = null;
    }

    document.querySelectorAll<HTMLElement>('.tuner-peg-badge').forEach(b => {
      const bPeg = parseInt(b.getAttribute('data-peg') || '0', 10);
      b.classList.toggle('active', bPeg === pegNum);
    });

    if (playSound) {
      try {
        guitarAudio.playString(info.string, 0, 2.5, 0.95);
      } catch (e) {
        console.warn('Audio error:', e);
      }
    }

    if (vibrate) {
      this.animateStringVibration(pegNum, 1400, this.isMicActive);
    }

    const hasReading = manualCents !== undefined;
    const effectiveCents = hasReading ? manualCents : 0;
    const meterOffset = hasReading ? Math.max(-40, Math.min(40, effectiveCents)) / 40 : 0;
    const isInTune = hasReading && Math.abs(effectiveCents) <= TUNER_IN_TUNE_CENTS;

    const pitchIndicator = document.getElementById('tuner-pitch-indicator');
    if (pitchIndicator) {
      pitchIndicator.style.setProperty('--tuner-offset', String(meterOffset));
      pitchIndicator.classList.toggle('in-tune', isInTune);
    }

    if (isInTune && commitTune) {
      this.markStringTuned(pegNum);
    }

    const tunerPitchLabel = document.getElementById('tuner-pitch-label');
    if (tunerPitchLabel) {
      this.fillTunerPitchLabel(info.name, info.noteSpanish, info.freq.toFixed(1));
    }

    const tunerCentsLabel = document.getElementById('tuner-cents-label');
    if (tunerCentsLabel) {
      if (!hasReading) {
        // Al tocar la clavija sin micrófono no hay lectura: no mostrar «0 cents (Demasiado bajo)».
        tunerCentsLabel.textContent = 'Escuchá la nota de referencia';
        tunerCentsLabel.style.color = 'var(--text-muted)';
      } else if (isInTune) {
        tunerCentsLabel.textContent = '¡Afinada!';
        tunerCentsLabel.style.color = 'var(--accent)';
      } else if (effectiveCents > 0) {
        tunerCentsLabel.textContent = `+${effectiveCents} cents (Demasiado alto)`;
        tunerCentsLabel.style.color = 'var(--danger)';
      } else {
        tunerCentsLabel.textContent = `${effectiveCents} cents (Demasiado bajo)`;
        tunerCentsLabel.style.color = 'var(--danger)';
      }
    }

    this.tunerCooldownTimer = window.setTimeout(() => {
      this.resetTunerActiveState();
    }, 700);
  }

  fillTunerPitchLabel(name: string, spanish: string, freq: string): void { return fillTunerPitchLabel(this, name, spanish, freq); }

  public animateStringVibration(stringNum: number, durationMs: number = 650, sustain = false): void { return animateStringVibration(stringNum, durationMs, sustain); }

  public markStringTuned(pegNum: number): void { return markStringTuned(this, pegNum); }

  public showTunerComplete(): void { return showTunerComplete(); }

  public resetTunerActiveState(): void { return resetTunerActiveState(this); }

  micGateGen = 0;

  async queryMicPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> { return queryMicPermissionState(); }

  rememberMicGranted(): void { return rememberMicGranted(this); }

  async syncMicForScreen(targetId: string): Promise<void> { return syncMicForScreen(this, targetId); }

  detachAllMicListeners(): void { return detachAllMicListeners(this); }

  async attachMicForScreen(screenId: string): Promise<void> { return attachMicForScreen(this, screenId); }

  async grantMicAndAttach(): Promise<void> { return grantMicAndAttach(this); }

  public async startTunerMicrophone(): Promise<boolean> { return startTunerMicrophone(this); }

  tunerDebugFrame: Float32Array | null = null;
  tunerDebugRms = 0;
  tunerDebugFreq: number | null = null;
  tunerDebugRaf = 0;

  tunerDebugCapture: { sampleRate: number; samples: Float32Array } | null = null;
  tunerDebugReadings: string[] = [];
  tunerDebugTag = 'ruido';

  startTunerDebug(): void { return startTunerDebug(this); }

  stopTunerDebug(): void { return stopTunerDebug(this); }

  bindTunerDebugPanel(): void { return bindTunerDebugPanel(this); }

  downloadCapture(
    capture: { sampleRate: number; samples: Float32Array },
    readings: string[]
  ): void {
    const wav = encodeWav(capture.samples, capture.sampleRate);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(wav, `microfono-${stamp}.wav`);
    const report = {
      sampleRate: capture.sampleRate,
      samples: capture.samples.length,
      readings
    };
    triggerDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `microfono-${stamp}.json`);
  }

  drawTunerDebug(): void { return drawTunerDebug(this); }

  onTunerPitch = (data: PitchMatchResult): void => {
    // Antes se leía data.rms antes de comprobar que data existiera.
    if (!data) return;
    this.tunerDebugRms = data.rms;
    this.tunerDebugFreq = data.freq;
    publishLiveFrame({
      tag: this.tunerDebugTag,
      rms: data.rms,
      freq: data.freq,
      note: data.stringMatch?.name ?? null,
      cents: data.stringMatch?.cents ?? null,
      wave: this.tunerDebugFrame ? Array.from(this.tunerDebugFrame).slice(0, 128) : []
    });
    if (guitarAudio.capturing) {
      const note = data.stringMatch ? `${data.stringMatch.name} ${data.stringMatch.cents}c` : '—';
      this.tunerDebugReadings.push(`${data.rms.toFixed(4)} ${data.freq ? data.freq.toFixed(1) : '—'}Hz ${note}`);
      if (this.tunerDebugReadings.length > 400) this.tunerDebugReadings.shift();
    }
    const now = performance.now();

    if (data.freq && data.stringMatch) {
      const match = data.stringMatch;

      if (this.tunerMicCandidate === match.string) {
        const dt = this.tunerMicLastFrameAt ? now - this.tunerMicLastFrameAt : 16;
        this.tunerMicStableFrames += dt;
      } else {
        this.tunerMicCandidate = match.string;
        this.tunerMicStableFrames = 0;
        this.tunerMicInTuneMs = 0;
        this.tunerSmoothedCents = match.cents;
      }

      if (this.tunerMicStableFrames < 120) {
        this.tunerMicLastFrameAt = now;
        return;
      }

      if (this.tunerSmoothedCents === null || this.activePeg !== match.string) {
        this.tunerSmoothedCents = match.cents;
      } else {
        this.tunerSmoothedCents = this.tunerSmoothedCents * 0.72 + match.cents * 0.28;
      }

      const rounded = Math.round(this.tunerSmoothedCents);
      const inTune = Math.abs(rounded) <= TUNER_IN_TUNE_CENTS;
      const dt = this.tunerMicLastFrameAt ? now - this.tunerMicLastFrameAt : 16;
      this.tunerMicLastFrameAt = now;
      this.tunerMicInTuneMs = inTune ? this.tunerMicInTuneMs + dt : 0;

      if (now - this.tunerLastPitchTime > 80) {
        this.tunerLastPitchTime = now;
        const commitTune = inTune && this.tunerMicInTuneMs >= 280;
        this.activatePeg(match.string, rounded, false, true, commitTune);
      }
    } else if (data.freq) {
      this.tunerMicCandidate = null;
      this.tunerMicStableFrames = 0;
      this.tunerMicInTuneMs = 0;
    } else if (!this.tunerMicLastFrameAt || now - this.tunerMicLastFrameAt > 400) {
      this.tunerSmoothedCents = null;
      this.tunerMicCandidate = null;
      this.tunerMicStableFrames = 0;
      this.tunerMicInTuneMs = 0;
      this.tunerMicLastFrameAt = 0;
      tunerMotion.release();
    }
  };

  public stopTunerMicrophone(): void { return stopTunerMicrophone(this); }

  // ================= GAMEPLAY CONTROLS =================
  setupGameplay(): void { return setupGameplay(this); }

  public resizeCanvases(): void { return resizeCanvases(); }

  public async startGameplayMicrophone(): Promise<void> { return startGameplayMicrophone(this); }

  onGameplayPitch = (data: PitchMatchResult): void => {
    if (!this.isGameplayMicActive || !data) return;
    if (sessionCalibrator.isActive) {
      sessionCalibrator.feed(data);
      return;
    }
    publishLiveFrame({
      tag: gameplayEngine.expectedLiveLabel(),
      rms: data.rms,
      freq: data.freq,
      note: data.stringMatch?.name ?? (data.fretMatch ? `s${data.fretMatch.string}f${data.fretMatch.fret}` : null),
      cents: data.stringMatch?.cents ?? data.fretMatch?.cents ?? null,
      wave: []
    });
    // The attack frame itself rarely has a stable pitch, so onsets must get through even with
    // freq === null; otherwise a repeated note (same pitch twice) is never registered.
    if (!data.freq && !data.isOnset) return;
    if (!gameplayEngine.isPlaying) return;

    const freq = data.freq ?? 0;
    if (gameplayEngine.mode === 'notes') {
      gameplayEngine.handleMicNoteDetected(freq, data.freq ? data.fretMatch : null, data.isOnset);
    } else if (gameplayEngine.mode === 'chords') {
      gameplayEngine.handleMicChordDetected(freq, data.chroma, data.isOnset);
    }
  };

  public stopGameplayMicrophone(): void { return stopGameplayMicrophone(this); }

  setupHotkeys(): void { return setupHotkeys(this); }
}

export const guitarApp = new GuitarApp();
