import { guitarAudio } from './audio/audioEngine';
import { songEditor } from './components/editor';
import { gameplayEngine } from './components/gameplay';
import { sessionCalibrator } from './components/calibration';
import { tunerMotion } from './components/tunerMotion';
import type { PitchMatchResult } from './types/audio.types';
import { cloneTemplate, slot } from './dom';
import { registerScreenSwitcher, takeQueuedGameplaySong, queueGameplaySong } from './screens';
import { listNotePickerItems, removeLibrarySong, clearLibrary } from './songLibrary';
import { soundProbeSong } from './songs/soundProbe';

export class GuitarApp {
  public screens: Record<string, HTMLElement | null> = {};
  public navBtns: NodeListOf<HTMLElement>;
  public skipBtns: NodeListOf<HTMLElement>;
  public menuCards: NodeListOf<HTMLElement>;
  public backBtns: NodeListOf<HTMLElement>;

  public currentScreenId: string = 'menu';
  public readonly flowOrder: string[] = ['tuner', 'songs', 'chords', 'menu'];

  // Tuner state
  public activePeg: number = 2;
  public tunedStrings: Set<number> = new Set<number>();
  public readonly tuningOrder: number[] = [6, 5, 4, 3, 2, 1];
  public tunerCooldownTimer: number | null = null;
  public autoProgressTimer: number | null = null;
  public isMicActive: boolean = false;
  public hasGrantedMicPermission: boolean = false;
  private tunerMicCandidate: number | null = null;
  /** Milliseconds the same open string has been detected continuously. */
  private tunerMicStableFrames: number = 0;
  private tunerMicInTuneMs: number = 0;
  private tunerMicLastFrameAt: number = 0;
  private tunerSmoothedCents: number | null = null;
  private tunerLastPitchTime: number = 0;
  private tunerPitchSlots: { name: Element | null; spanish: Element | null; freq: Element | null } | null = null;
  private readonly micScreens = new Set(['tuner', 'notes', 'chords', 'fretboard']);

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

  constructor() {
    this.screens = {
      menu: document.getElementById('view-menu'),
      songs: document.getElementById('view-songs'),
      tuner: document.getElementById('view-tuner'),
      notes: document.getElementById('view-notes'),
      chords: document.getElementById('view-chords'),
      editor: document.getElementById('view-editor')
    };

    this.navBtns = document.querySelectorAll<HTMLElement>('.view-tab-btn');
    this.skipBtns = document.querySelectorAll<HTMLElement>('.btn-skip');
    this.menuCards = document.querySelectorAll<HTMLElement>('[data-nav]');
    this.backBtns = document.querySelectorAll<HTMLElement>('.btn-back-menu');
  }

  public init(): void {
    this.setupNavigation();
    this.setupTuner();
    this.fillTunerPitchLabel('E4', 'Mi agudo', '329.6');
    this.setupGameplay();
    this.setupHotkeys();
    sessionCalibrator.bind();

    songEditor.init();
    gameplayEngine.setupScrubbingListeners();

    this.hasGrantedMicPermission =
      guitarAudio.hasMicPermission || sessionStorage.getItem('guitar_mic_granted') === '1';

    registerScreenSwitcher((id: string) => this.switchScreen(id));

    this.checkHash();
    this.activePeg = 2;
    document.querySelectorAll<HTMLElement>('.tuner-peg-badge').forEach(b => {
      b.classList.toggle('active', parseInt(b.getAttribute('data-peg') || '0') === 2);
    });
  }

  public switchScreen(targetId: string): void {
    if (!this.screens[targetId]) {
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
    if (window.location.hash !== `#${targetId}`) {
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
      this.renderSongPicker();
    }

    if (targetId === 'notes' || targetId === 'chords') {
      if (queued) {
        gameplayEngine.loadCustomSong(queued);
      } else if (fromId === 'editor') {
        gameplayEngine.loadCustomSong(songEditor.currentSong);
      } else if (!gameplayEngine.isCustomSongLoaded) {
        gameplayEngine.setMode(targetId === 'chords' ? 'chords' : 'notes');
      }
      requestAnimationFrame(() => {
        if (gameplayEngine.mode === 'notes') gameplayEngine.buildDOMNotes();
        else gameplayEngine.buildDOMChords();
        gameplayEngine.renderFrame();
        sessionCalibrator.start(() => gameplayEngine.beginWithCountdown());
      });
    } else {
      sessionCalibrator.abort();
      gameplayEngine.cancelCountdown();
      gameplayEngine.wasPlayingThisSession = false;
      gameplayEngine.pausePlaying();
      if (targetId === 'editor') {
        songEditor.renderGrid();
      }
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

  private setupNavigation(): void {
    this.navBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const target = btn.getAttribute('data-target');
        if (target) this.switchScreen(target);
      });
    });

    this.menuCards.forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const target = card.getAttribute('data-nav');
        if (target) this.switchScreen(target);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const target = card.getAttribute('data-nav');
          if (target) this.switchScreen(target);
        }
      });
    });

    this.backBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchScreen('menu');
      });
    });

    this.skipBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentIndex = this.flowOrder.indexOf(this.currentScreenId);
        const nextIndex = (currentIndex + 1) % this.flowOrder.length;
        this.switchScreen(this.flowOrder[nextIndex]);
      });
    });

    window.addEventListener('hashchange', () => this.checkHash());
  }

  private renderSongPicker(): void {
    const list = document.getElementById('song-picker-list');
    if (!list) return;
    list.replaceChildren();

    const items = listNotePickerItems(songEditor.presets);
    const lessons = [
      { id: 'builtin:sound_probe', source: 'leccion' as const, song: soundProbeSong },
      ...items.filter(item => item.source === 'leccion')
    ];
    const yours = items.filter(item => item.source === 'tuya');

    const addGroup = (label: string, rows: typeof items, emptyText?: string, yoursGroup = false): void => {
      const heading = document.createElement('div');
      heading.className = 'song-picker-group-row';
      const headingLabel = document.createElement('p');
      headingLabel.className = 'song-picker-group';
      headingLabel.textContent = label;
      heading.appendChild(headingLabel);
      if (yoursGroup && rows.length) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'song-picker-clear-btn';
        clearBtn.textContent = 'Vaciar';
        clearBtn.title = 'Borrar las canciones guardadas en este dispositivo';
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearLibrary();
          this.renderSongPicker();
        });
        heading.appendChild(clearBtn);
      }
      list.appendChild(heading);

      if (!rows.length && emptyText) {
        const empty = document.createElement('p');
        empty.className = 'song-picker-empty';
        empty.textContent = emptyText;
        list.appendChild(empty);
        return;
      }

      rows.forEach(item => {
        const row = document.createElement('div');
        row.className = 'song-picker-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'song-picker-item';
        const textWrap = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'song-picker-item-title';
        title.textContent = item.song.title;
        const meta = document.createElement('span');
        meta.className = 'song-picker-item-meta';
        meta.textContent = `${item.song.section} · ${item.song.notes.length} notas`;
        textWrap.append(title, meta);
        const bpm = document.createElement('span');
        bpm.className = 'song-picker-item-bpm';
        bpm.textContent = `${item.song.bpm} BPM`;
        btn.append(textWrap, bpm);
        btn.addEventListener('click', () => {
          queueGameplaySong(item.song);
          this.switchScreen('notes');
        });
        row.appendChild(btn);

        if (yoursGroup) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'song-picker-delete-btn';
          del.title = 'Quitar de Tus canciones';
          del.setAttribute('aria-label', 'Quitar');
          del.textContent = '×';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeLibrarySong(item.id);
            this.renderSongPicker();
          });
          row.appendChild(del);
        }

        list.appendChild(row);
      });
    };

    addGroup('Lecciones', lessons);
    addGroup('Tus canciones', yours, 'Todavía no hay nada del editor. Guardá una melodía ahí y aparece acá.', true);
  }

  private checkHash(): void {
    const hash = window.location.hash.replace('#', '');
    if (hash === this.currentScreenId && this.screens[hash]?.classList.contains('view-active')) {
      return;
    }
    if (this.screens[hash]) {
      this.switchScreen(hash);
    } else {
      this.switchScreen('menu');
    }
  }

  // ================= TUNER LOGIC =================
  private setupTuner(): void {
    const pegButtons = document.querySelectorAll<HTMLElement>('.tuner-peg-badge');
    const tunerContinueBtn = document.getElementById('tuner-continue-btn');
    const btnEnableMic = document.getElementById('tuner-btn-enable-mic');

    pegButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pegNum = parseInt(btn.getAttribute('data-peg') || '0');
        this.activatePeg(pegNum, undefined, true, true, false);
      });
    });

    if (tunerContinueBtn) {
      tunerContinueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchScreen('notes');
      });
    }

    if (btnEnableMic) {
      btnEnableMic.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.grantMicAndAttach();
      });
    }
  }

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
      const bPeg = parseInt(b.getAttribute('data-peg') || '0');
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
    const pxOffset = hasReading ? (Math.max(-40, Math.min(40, effectiveCents)) / 40) * 90 : 0;
    const isInTune = hasReading && Math.abs(effectiveCents) <= 5;

    const pitchIndicator = document.getElementById('tuner-pitch-indicator');
    if (pitchIndicator) {
      pitchIndicator.style.transform = `translateX(${pxOffset}px)`;
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
      if (isInTune) {
        tunerCentsLabel.textContent = '¡AFINADO!';
        tunerCentsLabel.style.color = '#00d68f';
      } else if (effectiveCents > 0) {
        tunerCentsLabel.textContent = `+${effectiveCents} cents (Demasiado alto)`;
        tunerCentsLabel.style.color = '#e74c3c';
      } else {
        tunerCentsLabel.textContent = `${effectiveCents} cents (Demasiado bajo)`;
        tunerCentsLabel.style.color = '#e74c3c';
      }
    }

    this.tunerCooldownTimer = window.setTimeout(() => {
      this.resetTunerActiveState();
    }, 700);
  }

  private fillTunerPitchLabel(name: string, spanish: string, freq: string): void {
    const tunerPitchLabel = document.getElementById('tuner-pitch-label');
    if (!tunerPitchLabel) return;
    if (!this.tunerPitchSlots) {
      tunerPitchLabel.replaceChildren(cloneTemplate('tpl-tuner-pitch-label'));
      this.tunerPitchSlots = {
        name: slot(tunerPitchLabel, 'name'),
        spanish: slot(tunerPitchLabel, 'spanish'),
        freq: slot(tunerPitchLabel, 'freq')
      };
    }
    if (this.tunerPitchSlots.name) this.tunerPitchSlots.name.textContent = name;
    if (this.tunerPitchSlots.spanish) this.tunerPitchSlots.spanish.textContent = spanish;
    if (this.tunerPitchSlots.freq) this.tunerPitchSlots.freq.textContent = freq;
  }

  public animateStringVibration(stringNum: number, durationMs: number = 650, sustain = false): void {
    tunerMotion.pluck(stringNum, sustain);
    if (!sustain) {
      window.setTimeout(() => tunerMotion.release(), durationMs);
    }
  }

  public markStringTuned(pegNum: number): void {
    const checkEl = document.getElementById(`tuner-check-${pegNum}`);
    const isNew = !this.tunedStrings.has(pegNum);
    this.tunedStrings.add(pegNum);

    if (checkEl) {
      checkEl.classList.add('tuned');
      if (isNew) {
        checkEl.classList.add('pop-in');
        setTimeout(() => checkEl.classList.remove('pop-in'), 600);
      }
    }

    if (isNew) {
      guitarAudio.playTunedChime();
    }

    if (this.tunedStrings.size === 6) {
      this.showTunerComplete();
    } else if (isNew) {
      if (this.autoProgressTimer) clearTimeout(this.autoProgressTimer);
      this.autoProgressTimer = window.setTimeout(() => {
        const nextUntuned = this.tuningOrder.find(s => !this.tunedStrings.has(s));
        if (nextUntuned) {
          this.activatePeg(nextUntuned, undefined, false, false, false);
        }
      }, 1200);
    }
  }

  public showTunerComplete(): void {
    const tunerCompleteTitle = document.getElementById('tuner-complete-title');
    const tunerPromptText = document.getElementById('tuner-prompt-text');
    const tunerCentsLabel = document.getElementById('tuner-cents-label');
    const tunerContinueBtn = document.getElementById('tuner-continue-btn');

    if (tunerCompleteTitle) {
      tunerCompleteTitle.textContent = '¡Listo, está afinado!';
      tunerCompleteTitle.classList.add('visible');
    }
    if (tunerPromptText) tunerPromptText.style.display = 'none';
    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'Todas las cuerdas afinadas correctamente';
      tunerCentsLabel.style.color = '#00d68f';
    }
    if (tunerContinueBtn) tunerContinueBtn.classList.add('visible');

    guitarAudio.playCompletionFanfare();
  }

  public resetTunerActiveState(): void {
    document.querySelectorAll<HTMLElement & { _vibrateTimeout?: number }>('.headstock-string').forEach(str => {
      str.classList.remove('vibrating');
      if (str._vibrateTimeout) {
        clearTimeout(str._vibrateTimeout);
        str._vibrateTimeout = undefined;
      }
    });

    document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));
    document.querySelectorAll('.tuner-peg-badge').forEach(b => b.classList.remove('active'));

    const pitchIndicator = document.getElementById('tuner-pitch-indicator');
    if (pitchIndicator) {
      pitchIndicator.style.transform = 'translateX(0px)';
      pitchIndicator.classList.remove('in-tune');
    }

    const tunerPromptText = document.getElementById('tuner-prompt-text');
    if (tunerPromptText && this.tunedStrings.size < 6) {
      tunerPromptText.textContent = 'Toca una cuerda para afinar';
    }

    const tunerCentsLabel = document.getElementById('tuner-cents-label');
    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'En espera de pulsación...';
      tunerCentsLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    }
  }

  private micGateGen = 0;

  private async queryMicPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state;
    } catch {
      return 'unknown';
    }
  }

  private rememberMicGranted(): void {
    this.hasGrantedMicPermission = true;
    guitarAudio.hasMicPermission = true;
    sessionStorage.setItem('guitar_mic_granted', '1');
  }

  private async syncMicForScreen(targetId: string): Promise<void> {
    const gen = ++this.micGateGen;
    const micOverlay = document.getElementById('tuner-mic-overlay');

    if (!this.micScreens.has(targetId)) {
      if (micOverlay) micOverlay.classList.add('hidden');
      guitarAudio.releaseMicrophone();
      this.isMicActive = false;
      this.isGameplayMicActive = false;
      return;
    }

    const perm = await this.queryMicPermissionState();
    if (gen !== this.micGateGen) return;

    const alreadyAllowed =
      perm === 'granted' ||
      this.hasGrantedMicPermission ||
      guitarAudio.hasMicPermission ||
      sessionStorage.getItem('guitar_mic_granted') === '1';

    if (alreadyAllowed) {
      this.rememberMicGranted();
      if (micOverlay) micOverlay.classList.add('hidden');
      await this.attachMicForScreen(targetId);
      return;
    }

    if (micOverlay) micOverlay.classList.remove('hidden');
  }

  private detachAllMicListeners(): void {
    guitarAudio.detachPitchListener(this.onTunerPitch);
    guitarAudio.detachPitchListener(this.onGameplayPitch);
    this.isMicActive = false;
    this.isGameplayMicActive = false;
  }

  private async attachMicForScreen(screenId: string): Promise<void> {
    this.detachAllMicListeners();
    if (screenId === 'tuner') {
      await this.startTunerMicrophone();
    } else if (screenId === 'notes' || screenId === 'chords') {
      await this.startGameplayMicrophone();
    }
  }

  private async grantMicAndAttach(): Promise<void> {
    const errEl = document.getElementById('tuner-mic-error');
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    const started = await guitarAudio.startMicrophonePitchTracking();
    if (!started) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
      }
      return;
    }
    this.rememberMicGranted();
    const micOverlay = document.getElementById('tuner-mic-overlay');
    if (micOverlay) micOverlay.classList.add('hidden');
    await this.attachMicForScreen(this.currentScreenId);
  }

  public async startTunerMicrophone(): Promise<boolean> {
    this.tunerMicCandidate = null;
    this.tunerMicStableFrames = 0;
    this.tunerMicInTuneMs = 0;
    this.tunerMicLastFrameAt = 0;
    this.tunerSmoothedCents = null;
    this.tunerLastPitchTime = 0;

    const started = await guitarAudio.startMicrophonePitchTracking(this.onTunerPitch);

    if (started) {
      this.isMicActive = true;
      this.rememberMicGranted();
      const micOverlay = document.getElementById('tuner-mic-overlay');
      if (micOverlay) micOverlay.classList.add('hidden');
      const tunerPromptText = document.getElementById('tuner-prompt-text');
      if (tunerPromptText && this.tunedStrings.size < 6) {
        tunerPromptText.textContent = 'Toca una cuerda para afinar';
      }
      return true;
    }

    const errEl = document.getElementById('tuner-mic-error');
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
    }
    return false;
  }

  private onTunerPitch = (data: PitchMatchResult): void => {
    if (!data) return;
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
      const inTune = Math.abs(rounded) <= 5;
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
    } else {
      this.tunerSmoothedCents = null;
      this.tunerMicCandidate = null;
      this.tunerMicStableFrames = 0;
      this.tunerMicInTuneMs = 0;
      this.tunerMicLastFrameAt = 0;
      tunerMotion.release();
    }
  };

  public stopTunerMicrophone(): void {
    guitarAudio.detachPitchListener(this.onTunerPitch);
    this.isMicActive = false;
  }

  // ================= GAMEPLAY CONTROLS =================
  private setupGameplay(): void {
    const playPauseBtns = document.querySelectorAll<HTMLElement>('.play-pause-btn');
    playPauseBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        gameplayEngine.togglePlay();
      });
    });

    document.querySelectorAll<HTMLElement>('.finger-legend-icon').forEach(hand => {
      hand.addEventListener('click', () => {
        const tooltip = document.getElementById('hand-legend-modal');
        if (tooltip) tooltip.classList.toggle('visible');
      });
    });

    document.addEventListener('click', (e) => {
      const modal = document.getElementById('hand-legend-modal');
      const target = e.target as HTMLElement;
      if (modal && modal.classList.contains('visible') && !target.closest('.finger-legend-icon') && !target.closest('#hand-legend-modal')) {
        modal.classList.remove('visible');
      }
    });

    window.addEventListener('resize', () => this.resizeCanvases());
    setTimeout(() => this.resizeCanvases(), 100);
  }

  public resizeCanvases(): void {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.trajectory-canvas');
    canvases.forEach(canvas => {
      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 0) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
      }
    });
    gameplayEngine.renderFrame();
  }

  public async startGameplayMicrophone(): Promise<void> {
    this.isGameplayMicActive = true;
    await guitarAudio.startMicrophonePitchTracking(this.onGameplayPitch);
  }

  private onGameplayPitch = (data: PitchMatchResult): void => {
    if (!this.isGameplayMicActive || !data) return;
    if (sessionCalibrator.isActive) {
      sessionCalibrator.feed(data);
      return;
    }
    if (!data.freq) return;
    if (!gameplayEngine.isPlaying) return;

    if (gameplayEngine.mode === 'notes') {
      gameplayEngine.handleMicNoteDetected(data.freq, data.fretMatch, data.isOnset);
    } else if (gameplayEngine.mode === 'chords') {
      gameplayEngine.handleMicChordDetected(data.freq, data.chroma, data.isOnset);
    }
  };

  public stopGameplayMicrophone(): void {
    this.isGameplayMicActive = false;
    guitarAudio.detachPitchListener(this.onGameplayPitch);
  }

  private setupHotkeys(): void {
    window.addEventListener('keydown', (e) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (typing) return;

      if (e.key === '1' && e.altKey) this.switchScreen('tuner');
      if (e.key === '2' && e.altKey) this.switchScreen('songs');
      if (e.key === '3' && e.altKey) this.switchScreen('chords');
      if (e.key === '4' && e.altKey) this.switchScreen('editor');

      const onGameplay = this.currentScreenId === 'notes' || this.currentScreenId === 'chords';
      if (onGameplay && (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === ' ')) {
        e.preventDefault();
        if (sessionCalibrator.isActive) {
          if (e.key === 'Escape') sessionCalibrator.skip();
          return;
        }
        if (gameplayEngine.isCountingDown) {
          gameplayEngine.cancelCountdown();
          return;
        }
        if (e.key === 'Escape') {
          if (gameplayEngine.isPlaying) gameplayEngine.pausePlaying();
          return;
        }
        gameplayEngine.togglePlay();
        return;
      }

      if (!e.altKey && !e.ctrlKey && !e.metaKey && gameplayEngine.isPlaying && onGameplay) {
        const keyMap: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
        if (keyMap[e.key]) {
          gameplayEngine.userPlayString(keyMap[e.key]);
        } else if (e.key === 'Enter') {
          const upcoming = gameplayEngine.notesTrack.find(n => !n.hit && !n.missed && Math.abs(gameplayEngine.currentTime - n.time) <= 0.4);
          if (upcoming) {
            gameplayEngine.userPlayString(upcoming.string, upcoming.fret);
          }
        }
      }
    });
  }
}

export const guitarApp = new GuitarApp();
