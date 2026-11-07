import { guitarAudio } from '../audio/audioEngine';
import { CHORD_RULES, NOTE_RULES, Scoreboard } from '../game/scoring';
import { chordMatchesChroma } from '../audio/chords';
import { cloneTemplate, firstElement, setSlotText, fillFromTemplate, fillSvgFromTemplate } from '../dom';
import type { NoteTrackItem, ChordTrackItem, GameplayMode, GameplaySessionMode } from '../types/gameplay.types';
import type { SongProject } from '../types/editor.types';
import { rememberSong } from '../screens';
import { noteDurationSteps, noteStartStepIndex, noteStep, STEPS_PER_BEAT } from '../rhythm';
import { fingerCapsuleClass, sanitizeCssColor, sanitizeFinger, sanitizeSongProject } from '../songSafety';
import { SOUND_PROBE_TITLE } from '../songs/soundProbe';
import { armPracticeLoop, clearLoopRegion, hasLoopRegion, loopEndTime, loopMinGap, loopStartTime, placeLoopEnd, setLoopPoint, toggleLoop, updateLoopRegionUI } from './gameplay/loopRegion';
import { renderChordsMotion, renderNotesMotion } from './gameplay/motion';
import { markTimelineResult, renderTimelineMarkers } from './gameplay/timeline';
import { setupHUDListeners, setupScrubbingListeners } from './gameplay/listeners';
import { spawnScoreParticle, spawnTimingLabel, triggerMultiplierPopup, updateHudChordCard } from './gameplay/feedback';
import { applyAttackEffect, launchAttack, updateAttackHUD, updateRivalHUD } from './gameplay/attacks';

export interface TrackNoteWithDOM extends NoteTrackItem {
  el?: HTMLElement;
  /** Seconds the colored block stays on the hit line and can still be played. */
  hold: number;
}

export interface TrackChordWithDOM extends ChordTrackItem {
  el?: HTMLElement;
  hold: number;
}

export interface ChordDiagramDot {
  cx: number;
  cy: number;
  color: string;
  finger: number;
}

/**
 * Gameplay engine: scrolling notes, bounce path, mic hits, loop/speed, and a simple star rating.
 */
export class GameplayEngine {
  public wasPlayingThisSession: boolean = false;
  probeLog: string[] = [];
  probeLoggedIds = new Set<number>();
  public isPlaying: boolean = false;
  public mode: GameplayMode = 'notes';
  public sessionMode: GameplaySessionMode = 'performance';
  public isLooping: boolean = false;
  public loopStartRatio: number | null = null;
  public loopEndRatio: number | null = null;
  loopHandleDrag: 'start' | 'end' | null = null;
  public isCustomSongLoaded: boolean = false;
  /** Screen the player came from, so "Salir" returns there instead of guessing. */
  public exitTarget: 'editor' | 'songs' | 'menu' = 'menu';
  /** When set, playback is the sheet cursor instead of the fretboard loop. */
  public sheetClock: { play(): void; pause(): void } | null = null;
  /** Moves the sheet cursor from the gameplay clock. */
  public sheetFrame: (() => void) | null = null;
  public loadedProject: SongProject | null = null;
  /** Puntaje, combo y multiplicador: reglas en src/game/scoring.ts. */
  public board: Scoreboard = new Scoreboard(3450);
  public get score(): number { return this.board.score; }
  public set score(value: number) { this.board.score = value; }
  public get targetScore(): number { return this.board.targetScore; }
  public set targetScore(value: number) { this.board.targetScore = value; }
  public get multiplier(): number { return this.board.multiplier; }
  public set multiplier(value: number) { this.board.multiplier = value; }
  public get combo(): number { return this.board.combo; }
  public set combo(value: number) { this.board.combo = value; }
  public get comboInTier(): number { return this.board.comboInTier; }
  public set comboInTier(value: number) { this.board.comboInTier = value; }
  public get maxCombo(): number { return this.board.maxCombo; }
  public set maxCombo(value: number) { this.board.maxCombo = value; }
  public songTitle: string = 'Melodía de Guitarra';
  public progress: number = 0;
  public bpm: number = 85;
  public scrollSpeed: number = 220;
  public lastTime: number = 0;
  public animationFrame: number | null = null;
  public isCountingDown: boolean = false;
  public isCalibrating: boolean = false;
  countdownTimer: number | null = null;
  wakeLockSentinel: any = null;

  // Hooks para Modo Multijugador Versus
  public isVersusActive: boolean = false;
  public isLocalHotseat: boolean = false;
  /** Primer jugador ya terminó; Reintentar arranca el turno del segundo. */
  public localPassHandoff: boolean = false;
  public rivalLastScore: number = 0;
  public rivalLastAccuracy: number = 0;
  public onProgressUpdate: ((score: number, combo: number, accuracy: number, measure: number) => void) | null = null;
  public onNoteHitCallback: ((noteId: number, rating: string, centsOffset: number) => void) | null = null;
  public onNoteMissCallback: ((noteId: number) => void) | null = null;
  public onMatchFinished: ((finalScore: number, maxCombo: number, accuracy: number, hits: number, totalNotes: number) => void) | null = null;
  public onLocalRetry: (() => void) | null = null;
  lastProgressEmitTime: number = 0;

  public updateRivalHUD(rivalName: string, rivalScore: number, accuracy: number = 100): void { return updateRivalHUD(this, rivalName, rivalScore, accuracy); }

  // Face-Off attack streak charge
  public isFaceOffMode: boolean = false;
  public attackStreak: number = 0;
  public readonly attackThreshold: number = 8;
  public onTriggerAttack: ((attackType: 'invert_screen' | 'blind_strings' | 'turbo_speed', durationMs: number) => void) | null = null;

  public updateAttackHUD(): void { return updateAttackHUD(this); }

  public launchAttack(): void { return launchAttack(this); }

  /**
   * Aplicar efectos de ataque en modo Face-Off (trampas)
   */
  public applyAttackEffect(attackType: 'invert_screen' | 'blind_strings' | 'turbo_speed', durationMs: number = 3000): void { return applyAttackEffect(this, attackType, durationMs); }

  async requestScreenWakeLock(): Promise<void> {
    if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
      try {
        if (!this.wakeLockSentinel || this.wakeLockSentinel.released) {
          this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
          this.wakeLockSentinel.addEventListener('release', () => {
            this.wakeLockSentinel = null;
          });
        }
      } catch {
        // Ignorar si el usuario deniega permisos o no se admite en el contexto actual
      }
    }
  }

  releaseScreenWakeLock(): void {
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch {
        // Ignorar
      }
      this.wakeLockSentinel = null;
    }
  }

  public defaultNotes: NoteTrackItem[] = [
    { id: 1, string: 2, fret: 3, time: 2.0, finger: 1, label: '3', hit: false },
    { id: 2, string: 2, fret: 0, time: 4.5, finger: 0, label: '0', hit: false },
    { id: 3, string: 3, fret: 2, time: 7.0, finger: 2, label: '2', hit: false },
    { id: 4, string: 1, fret: 1, time: 9.5, finger: 1, label: '1', hit: false },
    { id: 5, string: 2, fret: 3, time: 12.0, finger: 1, label: '3', hit: false },
    { id: 6, string: 3, fret: 0, time: 14.5, finger: 0, label: '0', hit: false },
    { id: 7, string: 2, fret: 3, time: 17.0, finger: 1, label: '3', hit: false },
    { id: 8, string: 2, fret: 0, time: 19.5, finger: 0, label: '0', hit: false }
  ];

  public defaultChords: ChordTrackItem[] = [
    { id: 1, chord: 'Am', time: 2.5, width: 330, color: '#ea5b57', label: 'Am', hit: false },
    { id: 2, chord: 'Am', time: 6.5, width: 300, color: '#aa22e6', label: 'Am', hit: false },
    { id: 3, chord: 'C',  time: 10.5, width: 330, color: '#27ae60', label: 'C', hit: false },
    { id: 4, chord: 'Em', time: 14.5, width: 300, color: '#e67e22', label: 'Em', hit: false },
    { id: 5, chord: 'Am', time: 18.5, width: 330, color: '#ea5b57', label: 'Am', hit: false }
  ];

  public notesTrack: TrackNoteWithDOM[] = [];
  public chordsTrack: TrackChordWithDOM[] = [];

  public currentTime: number = 0;
  public songDuration: number = 22.0;
  public speedMultiplier: number = 1.0;

  public readonly stringRatios: Record<number, number> = {
    1: 0.355,
    2: 0.465,
    3: 0.576,
    4: 0.687,
    5: 0.797,
    6: 0.907
  };

  public readonly chordDiagrams: Record<string, { dots: ChordDiagramDot[] }> = {
    'Am': {
      dots: [
        { cx: 33, cy: 28, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 56, color: '#00d2ff', finger: 2 },
        { cx: 63, cy: 42, color: '#e024c3', finger: 3 }
      ]
    },
    'C': {
      dots: [
        { cx: 33, cy: 28, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 56, color: '#00d2ff', finger: 2 },
        { cx: 93, cy: 70, color: '#e024c3', finger: 3 }
      ]
    },
    'Em': {
      dots: [
        { cx: 63, cy: 70, color: '#00d2ff', finger: 2 },
        { cx: 63, cy: 56, color: '#e024c3', finger: 3 }
      ]
    },
    'G': {
      dots: [
        { cx: 63, cy: 70, color: '#00d2ff', finger: 2 },
        { cx: 93, cy: 78, color: '#e024c3', finger: 3 },
        { cx: 93, cy: 14, color: '#f39c12', finger: 1 }
      ]
    },
    'D': {
      dots: [
        { cx: 63, cy: 42, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 14, color: '#00d2ff', finger: 2 },
        { cx: 93, cy: 28, color: '#e024c3', finger: 3 }
      ]
    },
    'Dm': {
      dots: [
        { cx: 33, cy: 14, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 42, color: '#00d2ff', finger: 2 },
        { cx: 93, cy: 28, color: '#e024c3', finger: 3 }
      ]
    },
    'F': {
      dots: [
        { cx: 33, cy: 14, color: '#f39c12', finger: 1 },
        { cx: 33, cy: 28, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 42, color: '#00d2ff', finger: 2 },
        { cx: 93, cy: 56, color: '#e024c3', finger: 3 }
      ]
    },
    'E': {
      dots: [
        { cx: 33, cy: 42, color: '#f39c12', finger: 1 },
        { cx: 63, cy: 70, color: '#00d2ff', finger: 2 },
        { cx: 63, cy: 56, color: '#e024c3', finger: 3 }
      ]
    }
  };

  /** How early a note still counts, before its colored block reaches the line. */
  static readonly HIT_EARLY = 0.2;
  /** Shortest gap between two mic-scored attacks, in milliseconds (~7 notes per second). */
  static readonly MIC_REFRACTORY_MS = 140;
  /** How long after an attack to wait before reading its pitch, in milliseconds. */
  static readonly MIC_ATTACK_SETTLE_MS = 45;
  /** Give up on an attack whose pitch never stabilises (muted pluck, noise). */
  static readonly MIC_ATTACK_MAX_WAIT_MS = 250;
  static readonly MIC_CENTS_TOLERANCE = 50;
  static readonly MIC_OCTAVE_CENTS_TOLERANCE = 35;

  micRefractoryUntil: number = 0;
  micAttackPendingAt: number = 0;
  micLastAttackFreq: number = 0;

  public currentActiveChordName: string = 'Am';

  public setSpeed(speed: number | string): void {
    if (this.sessionMode === 'performance') return;
    const val = typeof speed === 'string' ? parseFloat(speed) : speed;
    this.speedMultiplier = Math.max(0.25, Math.min(1.5, val || 1.0));
    this.updateSpeedUI();
  }

  public adjustSpeed(delta: number): void {
    const current = Math.round(this.speedMultiplier * 100);
    const step = Math.round(delta * 100);
    const nextPercent = Math.max(25, Math.min(150, current + step));
    this.setSpeed(nextPercent / 100);
  }

  noteIsOpen(time: number, hold: number): boolean {
    // Allows hitting the note anywhere across its full colored block (from arrival until it ends)
    // plus a comfortable leeway before arrival
    return this.currentTime >= time - GameplayEngine.HIT_EARLY && this.currentTime <= time + hold + 0.15;
  }

  public expectedLiveLabel(): string {
    if (!this.isPlaying) return 'pausa';
    if (this.mode === 'notes') {
      const note = this.notesTrack.find(item => !item.hit && !item.missed && this.noteIsOpen(item.time, item.hold));
      return note ? `s${note.string}f${note.fret}` : 'fin';
    }
    const chord = this.chordsTrack.find(item => !item.hit && !item.missed && this.noteIsOpen(item.time, item.hold));
    return chord ? chord.chord : 'fin';
  }

  public setSessionMode(mode: GameplaySessionMode): void {
    this.sessionMode = mode;
    if (mode === 'performance') {
      this.isLooping = false;
      this.speedMultiplier = 1;
      this.updateSpeedUI();
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!this.isPlaying) {
      this.armPracticeLoop();
    }
    this.updateSessionModeUI();
    this.updateSpeedUI();
    this.updateLoopRegionUI();
  }

  /** Paused practice: place repeat brackets around the playhead so a range can be looped. */
  armPracticeLoop(): void { return armPracticeLoop(this); }

  public hasLoopRegion(): boolean { return hasLoopRegion(this); }

  loopMinGap(): number { return loopMinGap(this); }

  public loopStartTime(): number { return loopStartTime(this); }

  public loopEndTime(): number { return loopEndTime(this); }

  public clearLoopRegion(): void { return clearLoopRegion(this); }

  public setLoopPoint(ratio: number): void { return setLoopPoint(this, ratio); }

  placeLoopEnd(clamped: number, minGap: number): void { return placeLoopEnd(this, clamped, minGap); }

  public updateLoopRegionUI(): void { return updateLoopRegionUI(this); }

  public toggleLoop(): void { return toggleLoop(this); }

  public updateSpeedUI(): void {
    const percent = Math.round(this.speedMultiplier * 100);
    document.querySelectorAll<HTMLInputElement>('.gameplay-speed-slider').forEach(slider => {
      slider.value = percent.toString();
    });
    document.querySelectorAll('.gameplay-speed-label').forEach(lbl => {
      lbl.textContent = `${percent} % Velocidad`;
    });
  }

  public updateSessionModeUI(): void {
    document.querySelectorAll('.gameplay-view').forEach(view => {
      view.classList.toggle('is-practice', this.sessionMode === 'practice');
    });
    document.querySelectorAll('.mode-btn-practice').forEach(btn => {
      btn.classList.toggle('active', this.sessionMode === 'practice');
    });
    document.querySelectorAll('.mode-btn-performance').forEach(btn => {
      btn.classList.toggle('active', this.sessionMode === 'performance');
    });

    document.querySelectorAll<HTMLElement>('.hud-loop-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', this.isLooping);
      btn.textContent = this.isLooping ? 'Bucle' : 'Sin bucle';
      btn.title = this.isLooping ? 'La pista se repetirá al terminar' : 'La pista se detiene al terminar';
    });

    const locked = this.sessionMode === 'performance';
    document.querySelectorAll('.hud-speed-controller-pill, .hud-loop-toggle-btn').forEach(el => {
      el.classList.toggle('performance-locked', locked);
    });
    document.querySelectorAll<HTMLInputElement>('.gameplay-speed-slider').forEach(slider => {
      slider.disabled = locked;
    });
    this.updateLoopRegionUI();
  }

  public seekTo(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.currentTime = clamped * this.songDuration;
    this.progress = clamped;

    const list: Array<{ hit: boolean; missed?: boolean; time: number; el?: HTMLElement }> =
      this.mode === 'notes' ? this.notesTrack : this.chordsTrack;

    list.forEach(item => {
      if (item.time >= this.currentTime) {
        item.hit = false;
        item.missed = false;
        if (item.el) {
          item.el.classList.remove('hit-flash');
          item.el.classList.remove('miss-flash');
        }
      }
    });

    this.renderFrame();
    this.renderTimelineMarkers();
    this.updateUI();
  }

  public init(mode: GameplayMode = 'notes'): void {
    this.mode = mode;
    this.isCustomSongLoaded = false;
    this.loadedProject = null;
    this.score = 0;
    this.multiplier = 1;
    this.combo = 0;
    this.comboInTier = 0;
    this.maxCombo = 0;
    this.songTitle = mode === 'notes' ? 'Melodía de Guitarra' : 'Progresión de Acordes';
    this.currentTime = 0;
    this.progress = 0;
    this.clearLoopRegion();

    if (mode === 'notes') {
      this.targetScore = 3450;
      this.songDuration = 22.0;
      this.notesTrack = (JSON.parse(JSON.stringify(this.defaultNotes)) as TrackNoteWithDOM[])
        .map(note => ({ ...note, hold: note.hold || 1.2 }));
      this.buildDOMNotes();
    } else {
      this.targetScore = 3050;
      this.songDuration = 22.0;
      this.chordsTrack = (JSON.parse(JSON.stringify(this.defaultChords)) as TrackChordWithDOM[])
        .map(chord => ({ ...chord, hold: chord.hold || chord.width / this.scrollSpeed }));
      this.buildDOMChords();
    }

    this.renderTimelineMarkers();
    this.updateUI();
    this.setSessionMode('performance');
    this.renderFrame();
    this.updatePlayPauseIcons();
  }

  public setMode(mode: GameplayMode): void {
    this.init(mode);
  }

  public loadCustomSong(songData: SongProject): void {
    const song = sanitizeSongProject(songData);
    if (!song) return;
    this.isCustomSongLoaded = true;
    this.loadedProject = song;
    rememberSong(song);
    this.mode = song.mode;
    this.songTitle = song.title || song.section || 'Canción';
    this.probeLog = [];
    this.probeLoggedIds.clear();
    this.bpm = song.bpm;
    this.scrollSpeed = (this.bpm / 60) * 160;
    const beatSeconds = 60 / this.bpm;
    this.score = 0;
    this.combo = 0;
    this.comboInTier = 0;
    this.maxCombo = 0;
    this.currentTime = 0;
    this.progress = 0;
    this.clearLoopRegion();

    if (this.mode === 'notes') {
      this.targetScore = Math.max(1200, (song.notes.length || 6) * 450);
      this.notesTrack = song.notes.map((n, idx) => {
        const stepIndex = noteStartStepIndex(n.measure, noteStep(n));
        const stepSeconds = beatSeconds / STEPS_PER_BEAT;
        const dur = noteDurationSteps(n);
        const hold = Math.max(stepSeconds, dur * stepSeconds);
        return {
          id: n.id || idx,
          string: n.string,
          fret: n.fret,
          time: stepIndex * stepSeconds + 1.5,
          finger: sanitizeFinger(n.finger),
          label: `${n.fret}`,
          hit: false,
          duration: dur,
          hold
        };
      });
      this.notesTrack.sort((a, b) => a.time - b.time);
      this.buildDOMNotes();
    } else {
      this.targetScore = Math.max(1200, (song.chords.length || 4) * 750);
      this.chordsTrack = song.chords.map((c, idx) => {
        const beatIndex = (c.measure - 1) * 4 + (c.beat - 1);
        const dur = c.duration || 4;
        const hold = Math.max(beatSeconds, dur * beatSeconds);
        return {
          id: c.id || idx,
          chord: c.chord,
          time: beatIndex * beatSeconds + 1.5,
          width: hold * this.scrollSpeed,
          color: sanitizeCssColor(c.color),
          label: c.chord,
          hit: false,
          hold
        };
      });
      this.chordsTrack.sort((a, b) => a.time - b.time);
      this.buildDOMChords();
    }

    const lastEvent = this.mode === 'notes'
      ? this.notesTrack.reduce((max, n) => Math.max(max, n.time), 0)
      : this.chordsTrack.reduce((max, c) => Math.max(max, c.time), 0);
    this.songDuration = Math.max(lastEvent + 2.2, 4);

    this.renderTimelineMarkers();
    this.updateUI();
    this.setSessionMode('performance');
    this.renderFrame();
  }

  public buildDOMNotes(): void {
    const container = document.querySelector('#view-notes .fretboard-canvas-container');
    if (!container) return;

    container.querySelectorAll('.game-note-capsule').forEach(el => el.remove());

    const fingerColors: Record<number, string> = {
      0: 'linear-gradient(180deg, #8a929e 0%, #6e7683 100%)',
      1: 'linear-gradient(180deg, #f5a623 0%, #e67e22 100%)',
      2: 'linear-gradient(180deg, #00d2ff 0%, #0099cc 100%)',
      3: 'linear-gradient(180deg, #e024c3 0%, #b8149e 100%)',
      4: 'linear-gradient(180deg, #8e44ad 0%, #6c3483 100%)'
    };

    this.notesTrack.forEach(note => {
      const capsule = document.createElement('div');
      capsule.className = `game-note-capsule ${fingerCapsuleClass(note.finger)}`;
      capsule.dataset.string = note.string.toString();
      capsule.dataset.fret = note.fret.toString();
      capsule.textContent = note.label;
      const fill = fingerColors[sanitizeFinger(note.finger)];
      if (fill) {
        capsule.style.background = fill;
      }
      capsule.style.width = `${Math.max(36, note.hold * this.scrollSpeed)}px`;
      capsule.style.left = '0px';
      capsule.style.top = '0px';
      capsule.style.willChange = 'transform';

      capsule.addEventListener('click', () => {
        this.userPlayString(note.string, note.fret);
      });

      note.el = capsule;
      container.appendChild(capsule);
    });
  }

  public buildDOMChords(): void {
    const container = document.querySelector('#view-chords .fretboard-canvas-container');
    if (!container) return;

    container.querySelectorAll('.game-chord-block').forEach(el => el.remove());

    this.chordsTrack.forEach((chord, idx) => {
      const blockFrag = cloneTemplate('tpl-game-chord-block');
      const block = firstElement<HTMLElement>(blockFrag);
      if (!block) return;
      block.dataset.chord = chord.chord;

      // Themed CSS classes matching Screenshot 2
      if (chord.color === '#ea5b57' || chord.chord === 'Am' && idx === 0) {
        block.classList.add('chord-block-coral');
      } else if (chord.color === '#aa22e6' || chord.chord === 'Am') {
        block.classList.add('chord-block-purple');
      } else if (chord.color === '#27ae60' || chord.chord === 'C') {
        block.classList.add('chord-block-green');
      } else if (chord.color === '#e67e22' || chord.chord === 'Em') {
        block.classList.add('chord-block-orange');
      } else {
        block.style.background = sanitizeCssColor(chord.color);
      }

      block.style.width = `${chord.width}px`;
      block.style.left = '0px';
      block.style.willChange = 'transform';
      setSlotText(block, 'label', chord.label);
      setSlotText(block, 'section', idx === 0 ? 'Parte 1' : `Parte ${idx + 1}`);

      block.addEventListener('click', () => {
        this.userPlayChord(chord.chord);
      });

      chord.el = block;
      container.appendChild(blockFrag);
    });
  }

  /** Sheet playback reports time from the first note. Gameplay notes include a 1.5s lead-in. */
  public adoptSheetClock(secondsFromStart: number, playing: boolean): void {
    this.currentTime = secondsFromStart + 1.5;
    this.isPlaying = playing;
    if (!playing || this.mode !== 'notes') return;
    for (const note of this.notesTrack) {
      if (!note.hit && !note.missed && this.currentTime > note.time + note.hold + 0.12) {
        note.missed = true;
        this.triggerNoteMiss(note);
      }
    }
  }

  public startPlaying(): void {
    if (this.isCountingDown) return;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.wasPlayingThisSession = true;
      this.lastTime = performance.now();
      this.updatePlayPauseIcons();
      this.requestScreenWakeLock();
      if (this.sheetClock) {
        this.sheetClock.play();
        return;
      }
      this.loop(this.lastTime);
    }
  }

  public pausePlaying(): void {
    this.sheetClock?.pause();
    this.isPlaying = false;
    this.releaseScreenWakeLock();
    this.updatePlayPauseIcons();
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  public beginWithCountdown(): void {
    this.cancelCountdown();
    this.pausePlaying();
    this.wasPlayingThisSession = false;
    this.updatePlayPauseIcons();

    const overlay = document.getElementById('gameplay-countdown-overlay');
    const numberEl = document.getElementById('gameplay-countdown-number');
    if (!overlay || !numberEl) {
      this.startPlaying();
      return;
    }

    this.isCountingDown = true;
    overlay.hidden = false;
    const steps = ['3', '2', '1'];
    let i = 0;

    const tick = () => {
      if (!this.isCountingDown) return;
      if (i < steps.length) {
        numberEl.textContent = steps[i];
        numberEl.classList.remove('pop');
        void numberEl.offsetWidth;
        numberEl.classList.add('pop');
        try {
          guitarAudio.playClickSound();
        } catch {
          // ignore
        }
        i += 1;
        this.countdownTimer = window.setTimeout(tick, 700);
      } else {
        this.cancelCountdown();
        this.startPlaying();
      }
    };

    tick();
  }

  public cancelCountdown(): void {
    this.isCountingDown = false;
    if (this.countdownTimer !== null) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    const overlay = document.getElementById('gameplay-countdown-overlay');
    if (overlay) overlay.hidden = true;
  }

  public togglePlay(): void {
    if (this.isCountingDown || this.isCalibrating) return;
    if (this.isPlaying) {
      this.pausePlaying();
    } else {
      this.startPlaying();
    }
  }

  public updatePlayPauseIcons(): void {
    document.querySelectorAll('.gameplay-view').forEach(view => {
      view.classList.toggle('is-playing', this.isPlaying);
    });

    const pauseOverlay = document.getElementById('gameplay-pause-overlay');
    const onGameplay = document.getElementById('view-notes')?.classList.contains('view-active')
      || document.getElementById('view-chords')?.classList.contains('view-active');
    if (pauseOverlay) {
      const show = onGameplay && !this.isPlaying && this.wasPlayingThisSession && !this.isCountingDown;
      pauseOverlay.hidden = !show;
    }

    const playBtns = document.querySelectorAll('.play-pause-btn');
    playBtns.forEach(btn => {
      const label = btn.querySelector('.btn-play-pause-label');
      if (label) {
        label.textContent = this.isPlaying ? 'Pausa' : 'Reproducir';
      }
      const icon = btn.querySelector('.icon-hud-play');
      if (icon) {
        fillSvgFromTemplate(icon, this.isPlaying ? 'tpl-svg-pause' : 'tpl-svg-play');
      } else {
        fillFromTemplate(btn, this.isPlaying ? 'tpl-icon-pause' : 'tpl-icon-play');
      }
    });
  }

  public loop(now: number): void {
    if (!this.isPlaying) return;
    const rawDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const dt = rawDt * this.speedMultiplier;

    this.currentTime += dt;
    const useRegion = this.sessionMode === 'practice' && this.isLooping && this.hasLoopRegion();
    const loopEnd = useRegion ? this.loopEndTime() : this.songDuration;
    const loopStart = useRegion ? this.loopStartTime() : 0;

    if (this.currentTime >= loopEnd) {
      if (this.isLooping && this.sessionMode === 'practice') {
        this.currentTime = loopStart;
        if (useRegion) this.resetHitsInLoop();
        else this.resetHits();
      } else if (this.currentTime >= this.songDuration) {
        this.currentTime = this.songDuration;
        this.progress = 1.0;
        this.renderFrame();
        this.updateUI();
        this.pausePlaying();
        this.finishPerformance();
        return;
      }
    }

    this.progress = this.currentTime / this.songDuration;

    // Emisión periódica de telemetría si está en modo Versus (7 Hz / cada 150 ms)
    if (this.isVersusActive && this.onProgressUpdate && now - this.lastProgressEmitTime > 150) {
      this.lastProgressEmitTime = now;
      const accuracy = this.targetScore > 0 ? (this.score / this.targetScore) * 100 : 100;
      this.onProgressUpdate(this.score, this.combo, accuracy, Math.floor(this.currentTime / 2));
    }

    this.renderFrame();
    this.updateUI();
    this.sheetFrame?.();

    this.animationFrame = requestAnimationFrame((t) => this.loop(t));
  }

  public finishPerformance(): void {
    let total = 0;
    let hits = 0;

    if (this.mode === 'notes') {
      total = this.notesTrack.length;
      hits = this.notesTrack.filter(n => n.hit).length;
    } else {
      total = this.chordsTrack.length;
      hits = this.chordsTrack.filter(c => c.hit).length;
    }

    const effectiveTotal = Math.max(1, total);
    const accuracy = Math.round((hits / effectiveTotal) * 100);

    let stars = 0;
    let verdict = 'SIGUE PRACTICANDO';
    let badgeText = 'INTÉNTALO DE NUEVO';

    if (accuracy >= 90) {
      stars = 3;
      verdict = accuracy === 100 ? '¡INTERPRETACIÓN PERFECTA! IMPECABLE' : '¡MAGNÍFICO! CASI PERFECTO';
      badgeText = '3 estrellas · Excelente';
    } else if (accuracy >= 70) {
      stars = 2;
      verdict = '¡MUY BUENA INTERPRETACIÓN!';
      badgeText = '2 estrellas · Muy bien';
    } else if (accuracy >= 40) {
      stars = 1;
      verdict = '¡BUEN INTENTO! VAS POR BUEN CAMINO';
      badgeText = '1 estrella · Bueno';
    } else {
      stars = 0;
      verdict = 'PRACTICA MÁS DESPACIO PARA MEJORAR';
      badgeText = 'SIN ESTRELLAS';
    }

    guitarAudio.playStarFanfare(stars);

    this.wasPlayingThisSession = false;
    const pauseOverlay = document.getElementById('gameplay-pause-overlay');
    if (pauseOverlay) pauseOverlay.hidden = true;

    const modal = document.getElementById('performance-results-modal');
    if (!modal) return;

    const titleEl = document.getElementById('perf-song-title');
    if (titleEl) titleEl.textContent = this.songTitle || 'Canción';

    const verdictEl = document.getElementById('perf-verdict-text');
    if (verdictEl) verdictEl.textContent = verdict;

    const badgeEl = document.getElementById('perf-star-badge');
    if (badgeEl) {
      badgeEl.textContent = badgeText;
      badgeEl.className = `perf-star-badge stars-${stars}`;
    }

    const starItems = modal.querySelectorAll<HTMLElement>('.perf-star-item');
    starItems.forEach((starEl, index) => {
      starEl.classList.remove('earned', 'pop');
      if (index < stars) {
        setTimeout(() => {
          starEl.classList.add('earned', 'pop');
        }, 300 + index * 260);
      }
    });

    const accEl = document.getElementById('perf-stat-accuracy');
    if (accEl) accEl.textContent = `${accuracy}%`;

    const hitsEl = document.getElementById('perf-stat-hits');
    if (hitsEl) hitsEl.textContent = `${hits} / ${effectiveTotal}`;

    const comboEl = document.getElementById('perf-stat-combo');
    if (comboEl) comboEl.textContent = `${this.maxCombo}`;

    const scoreEl = document.getElementById('perf-stat-score');
    if (scoreEl) scoreEl.textContent = `${Math.round(this.score)}`;

    const probeBox = document.getElementById('probe-log');
    const probeText = document.getElementById('probe-log-text');
    if (probeBox && probeText) {
      const showProbe = this.songTitle === SOUND_PROBE_TITLE;
      probeBox.hidden = !showProbe;
      if (showProbe) probeText.textContent = this.formatProbeLog();
    }

    // Resultados específicos del Modo Versus
    const vsBox = document.getElementById('perf-vs-comparison');
    const rematchBtn = document.getElementById('perf-btn-rematch');
    const practiceBtn = document.getElementById('perf-btn-practice');
    if (practiceBtn && (this.isVersusActive || this.isLocalHotseat)) {
      practiceBtn.hidden = true;
    }
    if (vsBox && rematchBtn) {
      vsBox.hidden = !this.isVersusActive;
      rematchBtn.hidden = !this.isVersusActive;

      if (this.isVersusActive) {
        const myScoreEl = document.getElementById('perf-vs-my-score');
        const myAccEl = document.getElementById('perf-vs-my-acc');
        const bannerEl = document.getElementById('perf-vs-banner');
        if (myScoreEl) myScoreEl.textContent = `${Math.round(this.score)} pts`;
        if (myAccEl) myAccEl.textContent = `${accuracy}% Precisión`;

        // Calcular victoria o derrota
        const rivalScore = this.rivalLastScore || 0;
        if (bannerEl) {
          if (this.score > rivalScore) {
            bannerEl.textContent = '¡Victoria!';
            bannerEl.style.color = 'var(--accent)';
          } else if (this.score < rivalScore) {
            bannerEl.textContent = 'Derrota';
            bannerEl.style.color = 'var(--danger)';
          } else {
            bannerEl.textContent = '¡Empate!';
            bannerEl.style.color = 'var(--text)';
          }
        }
        if (this.onMatchFinished) {
          this.onMatchFinished(Math.round(this.score), this.maxCombo, accuracy, hits, effectiveTotal);
        }
      }
    }
    if (this.isLocalHotseat && this.onMatchFinished) {
      this.onMatchFinished(Math.round(this.score), this.maxCombo, accuracy, hits, effectiveTotal);
    }

    modal.style.display = 'flex';
  }

  formatProbeLog(): string {
    const header = 'esperado\toyó Hz\tdetectó\tcents\tresultado';
    return [header, ...this.probeLog].join('\n');
  }

  recordProbe(note: { id: number; string: number; fret: number }, heard: { freq: number; string: number | null; fret: number | null; cents: number | null; result: string } | null): void {
    if (this.songTitle !== SOUND_PROBE_TITLE || this.probeLoggedIds.has(note.id)) return;
    this.probeLoggedIds.add(note.id);
    const expected = `c${note.string} t${note.fret}`;
    if (!heard) {
      this.probeLog.push(`${expected}\t—\t—\t—\tsin ataque`);
      return;
    }
    const detected = heard.string != null && heard.fret != null ? `c${heard.string} t${heard.fret}` : '—';
    const cents = heard.cents == null ? '—' : `${heard.cents > 0 ? '+' : ''}${Math.round(heard.cents)}`;
    this.probeLog.push(`${expected}\t${heard.freq.toFixed(1)}\t${detected}\t${cents}\t${heard.result}`);
  }

  public resetHits(): void {
    const list: Array<{ hit: boolean; missed?: boolean; el?: HTMLElement }> =
      this.mode === 'notes' ? this.notesTrack : this.chordsTrack;

    list.forEach(item => {
      item.hit = false;
      item.missed = false;
      if (item.el) {
        item.el.classList.remove('hit-flash');
        item.el.classList.remove('miss-flash');
      }
    });
    this.resetMicState();
    this.renderTimelineMarkers();
  }

  public resetHitsInLoop(): void {
    const start = this.loopStartTime();
    const end = this.loopEndTime();
    const list: Array<{ hit: boolean; missed?: boolean; time: number; el?: HTMLElement }> =
      this.mode === 'notes' ? this.notesTrack : this.chordsTrack;

    list.forEach(item => {
      if (item.time < start || item.time > end + 0.05) return;
      item.hit = false;
      item.missed = false;
      if (item.el) {
        item.el.classList.remove('hit-flash');
        item.el.classList.remove('miss-flash');
      }
    });
    this.renderTimelineMarkers();
  }

  public renderFrame(): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const container = document.querySelector(`${activeViewId} .fretboard-canvas-container`);
    if (!container) return;

    const width = container.clientWidth || 1100;
    const height = container.clientHeight || 340;
    const hitZoneX = width * 0.35;
    const listenPx = 0.12 * this.scrollSpeed * 2;
    document.querySelectorAll<HTMLElement>(`${activeViewId} .game-hit-window`).forEach(band => {
      band.style.width = `${listenPx}px`;
    });

    if (this.mode === 'notes') {
      this.renderNotesMotion(width, height, hitZoneX);
    } else {
      this.renderChordsMotion(width, height, hitZoneX);
    }
  }

  public renderNotesMotion(width: number, height: number, hitZoneX: number): void { return renderNotesMotion(this, width, height, hitZoneX); }

  public renderChordsMotion(width: number, height: number, hitZoneX: number): void { return renderChordsMotion(this, width, height, hitZoneX); }

  public triggerNoteHit(note: TrackNoteWithDOM): void {
    // Sin sonido: con guitarra real ya se escucha lo que se tocó (repetir la nota
    // distrae y el micrófono puede volver a captarla); con teclado/clic,
    // userPlayString ya la hizo sonar. El acierto se marca solo de forma visual.

    const { points, multiplierUp } = this.board.hit(NOTE_RULES);
    if (multiplierUp) this.triggerMultiplierPopup();

    if (note.el) {
      note.el.classList.remove('miss-flash');
      note.el.classList.add('hit-flash');
      setTimeout(() => note.el?.classList.remove('hit-flash'), 220);
    }

    if (this.isVersusActive && this.onNoteHitCallback) {
      this.onNoteHitCallback(note.id, 'PERFECT', 0);
    }

    if (this.isVersusActive && this.isFaceOffMode) {
      if (this.attackStreak < this.attackThreshold) {
        this.attackStreak++;
        this.updateAttackHUD();
      }
    }

    const ball = document.querySelector('#view-notes .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${points}`, false);
    this.spawnTimingLabel(this.currentTime - note.time);
    this.markTimelineResult('n', note.id, 'hit');
    this.updateUI();
  }

  public triggerNoteMiss(note: TrackNoteWithDOM): void {
    this.board.miss();

    if (this.isVersusActive && this.isFaceOffMode) {
      this.attackStreak = 0;
      this.updateAttackHUD();
    }
    if (this.isVersusActive && this.onNoteMissCallback) {
      this.onNoteMissCallback(note.id);
    }

    // Sin sonido de error para no desconcentrar: el fallo se marca solo visualmente.
    if (note.el) {
      note.el.classList.add('miss-flash');
    }

    this.spawnScoreParticle('MISS', true);
    this.markTimelineResult('n', note.id, 'miss');
    this.updateUI();
  }

  public userPlayString(stringNum: number, fret: number = 0): void {
    guitarAudio.playString(stringNum, fret);

    if (!this.isPlaying || this.mode !== 'notes') return;

    let bestNote: TrackNoteWithDOM | null = null;
    let minDiff = Infinity;

    for (const note of this.notesTrack) {
      if (note.hit || note.missed) continue;
      if (!this.noteIsOpen(note.time, note.hold)) continue;
      const diff = Math.abs(this.currentTime - note.time);
      if (diff < minDiff) {
        minDiff = diff;
        bestNote = note;
      }
    }

    if (bestNote) {
      const stringMatches = parseInt(bestNote.string.toString()) === parseInt(stringNum.toString());
      const fretMatches = fret === undefined || parseInt(bestNote.fret.toString()) === parseInt(fret.toString());

      if (stringMatches && fretMatches) {
        bestNote.hit = true;
        this.triggerNoteHit(bestNote);
      } else {
        bestNote.missed = true;
        this.triggerNoteMiss(bestNote);
      }
    }
  }

  /**
   * Gate repeated frames of one ringing note down to a single scoring event.
   *
   * The mic callback fires every animation frame, and a plucked string rings for a second or
   * more. Without this, one pluck walks through every unhit note inside the timing window.
   */
  isNewAttack(freq: number, isOnset: boolean, requirePitch = true): boolean {
    const now = performance.now();

    if (isOnset && now >= this.micRefractoryUntil && this.micAttackPendingAt === 0) {
      // Don't read the pitch at the attack itself: the string is still broadband noise there and
      // the tracker is still reporting whatever was ringing before. Let the tone settle first.
      this.micAttackPendingAt = now;
    }

    if (this.micAttackPendingAt > 0) {
      if (now - this.micAttackPendingAt < GameplayEngine.MIC_ATTACK_SETTLE_MS) return false;
      // Settled but no pitch yet: keep waiting for a frame with one, up to a limit.
      if (requirePitch && freq <= 0) {
        if (now - this.micAttackPendingAt > GameplayEngine.MIC_ATTACK_MAX_WAIT_MS) this.micAttackPendingAt = 0;
        return false;
      }
      this.micAttackPendingAt = 0;
      this.micRefractoryUntil = now + GameplayEngine.MIC_REFRACTORY_MS;
      this.micLastAttackFreq = freq;
      return true;
    }

    if (now < this.micRefractoryUntil) return false;

    // Fallback for attacks with no transient of their own, such as a hammer-on or a slide.
    const pitchJumped = freq > 0 && this.micLastAttackFreq > 0 &&
      Math.abs(1200 * Math.log2(freq / this.micLastAttackFreq)) > 80;
    if (!pitchJumped) return false;

    this.micRefractoryUntil = now + GameplayEngine.MIC_REFRACTORY_MS;
    this.micLastAttackFreq = freq;
    return true;
  }

  public resetMicState(): void {
    this.micRefractoryUntil = 0;
    this.micAttackPendingAt = 0;
    this.micLastAttackFreq = 0;
  }

  public handleMicNoteDetected(
    freq: number,
    fretMatch?: { string: number; fret: number } | null,
    isOnset: boolean = true
  ): void {
    if (!this.isPlaying || this.mode !== 'notes') return;
    if (!this.isNewAttack(freq, isOnset)) return;

    let bestNote: TrackNoteWithDOM | null = null;
    let minDiff = Infinity;

    for (const note of this.notesTrack) {
      if (note.hit || note.missed) continue;
      const window = this.songTitle === SOUND_PROBE_TITLE ? 0.7 : note.hold;
      if (!this.noteIsOpen(note.time, window)) continue;
      const diff = Math.abs(this.currentTime - note.time);
      if (diff < minDiff) {
        minDiff = diff;
        bestNote = note;
      }
    }

    if (!bestNote) return;

    const targetFreq = guitarAudio.getFretFrequency(bestNote.string, bestNote.fret);
    const cents = 1200 * Math.log2(freq / targetFreq);
    const octaves = Math.round(cents / 1200);
    const centsInOctave = cents - octaves * 1200;

    const exactFretMatched = !!fretMatch &&
      fretMatch.string === bestNote.string &&
      fretMatch.fret === bestNote.fret;

    // Half a semitone around the target, plus a tighter allowance one octave away because
    // pitch trackers occasionally latch onto a harmonic of the string instead of its fundamental.
    const matchesPitch = Math.abs(cents) <= GameplayEngine.MIC_CENTS_TOLERANCE ||
      (Math.abs(octaves) === 1 && Math.abs(centsInOctave) <= GameplayEngine.MIC_OCTAVE_CENTS_TOLERANCE);

    const ok = exactFretMatched || matchesPitch;
    this.recordProbe(bestNote, {
      freq,
      string: fretMatch?.string ?? null,
      fret: fretMatch?.fret ?? null,
      cents: Number.isFinite(cents) ? cents : null,
      result: ok ? 'ok' : 'distinto'
    });

    if (ok) {
      bestNote.hit = true;
      this.triggerNoteHit(bestNote);
    } else if (freq > 0) {
      bestNote.missed = true;
      this.triggerNoteMiss(bestNote);
    }
  }

  public handleMicChordDetected(freq: number, chroma?: Float32Array | null, isOnset: boolean = true): void {
    if (!this.isPlaying || this.mode !== 'chords') return;
    // A strum is polyphonic, so YIN often has no single pitch; the chroma decides instead.
    if (!this.isNewAttack(freq, isOnset, false)) return;

    let bestChord: TrackChordWithDOM | null = null;
    let minDiff = Infinity;

    for (const chord of this.chordsTrack) {
      if (chord.hit || chord.missed) continue;
      if (!this.noteIsOpen(chord.time, chord.hold)) continue;
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff < minDiff) {
        minDiff = diff;
        bestChord = chord;
      }
    }

    if (!bestChord) return;
    if (!chordMatchesChroma(bestChord.chord, freq, chroma, guitarAudio.sessionProfile)) return;

    bestChord.hit = true;
    this.triggerChordHit(bestChord);
  }

  public userPlayChord(chordName: string): void {
    guitarAudio.playChord(chordName);

    if (!this.isPlaying || this.mode !== 'chords') return;

    let bestChord: TrackChordWithDOM | null = null;
    let minDiff = Infinity;

    for (const chord of this.chordsTrack) {
      if (chord.hit || chord.missed) continue;
      if (!this.noteIsOpen(chord.time, chord.hold)) continue;
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff < minDiff) {
        minDiff = diff;
        bestChord = chord;
      }
    }

    if (bestChord) {
      if (bestChord.chord === chordName) {
        bestChord.hit = true;
        this.triggerChordHit(bestChord);
      } else {
        bestChord.missed = true;
        this.triggerChordMiss(bestChord);
      }
    }
  }

  public triggerChordMiss(chord: TrackChordWithDOM): void {
    this.board.miss();

    if (this.isVersusActive && this.isFaceOffMode) {
      this.attackStreak = 0;
      this.updateAttackHUD();
    }
    if (this.isVersusActive && this.onNoteMissCallback) {
      this.onNoteMissCallback(chord.id);
    }

    // Sin sonido de error para no desconcentrar: el fallo se marca solo visualmente.
    if (chord.el) {
      chord.el.classList.add('miss-flash');
    }

    this.spawnScoreParticle('MISS', true);
    this.markTimelineResult('c', chord.id, 'miss');
    this.updateUI();
  }

  public updateHudChordCard(chordName: string): void { return updateHudChordCard(this, chordName); }

  public triggerChordHit(chord: TrackChordWithDOM): void {
    // Sin sonido (ver triggerNoteHit): userPlayChord ya hace sonar el acorde elegido.

    const { points, multiplierUp } = this.board.hit(CHORD_RULES);
    if (multiplierUp) this.triggerMultiplierPopup();

    if (this.isVersusActive && this.onNoteHitCallback) {
      this.onNoteHitCallback(chord.id, 'PERFECT', 0);
    }
    if (this.isVersusActive && this.isFaceOffMode) {
      if (this.attackStreak < this.attackThreshold) {
        this.attackStreak++;
        this.updateAttackHUD();
      }
    }

    if (chord.el) {
      chord.el.classList.add('hit-flash');
      setTimeout(() => chord.el?.classList.remove('hit-flash'), 220);
    }

    this.spawnTimingLabel(this.currentTime - chord.time);

    const ball = document.querySelector('#view-chords .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${points}`);
    this.markTimelineResult('c', chord.id, 'hit');
    this.updateUI();
  }

  public triggerMultiplierPopup(): void { return triggerMultiplierPopup(this); }

  /** Signed offset in seconds: negative is early, positive is late. */
  spawnTimingLabel(deltaSeconds: number): void { return spawnTimingLabel(this, deltaSeconds); }

  public spawnScoreParticle(text: string, isMiss: boolean = false, extraClass: string = ''): void { return spawnScoreParticle(this, text, isMiss, extraClass); }

  public renderTimelineMarkers(): void { return renderTimelineMarkers(this); }

  public markTimelineResult(kind: 'n' | 'c', id: number, result: 'hit' | 'miss'): void { return markTimelineResult(this, kind, id, result); }

  public setupScrubbingListeners(): void { return setupScrubbingListeners(this); }

  public setupHUDListeners(): void { return setupHUDListeners(this); }

  /** Resets duel state and returns the screen the player came from. */
  public leaveGameplay(): string {
    const fromDuel = this.isLocalHotseat || this.isVersusActive;
    this.isLocalHotseat = false;
    this.isVersusActive = false;
    this.localPassHandoff = false;
    this.onLocalRetry = null;
    const practice = document.getElementById('perf-btn-practice');
    if (practice) practice.hidden = false;
    const rematch = document.getElementById('perf-btn-rematch');
    if (rematch) rematch.hidden = true;
    const retryLabel = document.querySelector('#perf-btn-retry span');
    if (retryLabel) retryLabel.textContent = 'Reintentar';
    return fromDuel ? 'vs' : this.exitTarget;
  }

  public retryPerformance(): void {
    if (this.isLocalHotseat && this.onLocalRetry) {
      const next = this.onLocalRetry;
      this.onLocalRetry = null;
      next();
      return;
    }
    this.restartPerformance();
  }

  public restartPerformance(): void {
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';

    this.probeLog = [];
    this.probeLoggedIds.clear();
    this.currentTime = 0;
    this.progress = 0;
    this.score = 0;
    this.combo = 0;
    this.comboInTier = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.resetHits();
    this.renderFrame();
    this.updateUI();
    this.startPlaying();
    guitarAudio.playClickSound();
  }

  public switchToPracticeFromModal(): void {
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';

    this.setSessionMode('practice');
    this.isLooping = false;
    this.currentTime = 0;
    this.progress = 0;
    this.score = 0;
    this.combo = 0;
    this.comboInTier = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.resetHits();
    this.renderFrame();
    this.updateUI();
    this.startPlaying();
    guitarAudio.playClickSound();
  }

  public updateUI(): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';

    const scoreEls = document.querySelectorAll(`${activeViewId} .current-score`);
    scoreEls.forEach(el => el.textContent = Math.floor(this.score).toString());

    const targetScoreEls = document.querySelectorAll(`${activeViewId} .target-score`);
    targetScoreEls.forEach(el => el.textContent = this.targetScore.toString());

    const multTexts = document.querySelectorAll(`${activeViewId} .hud-multiplier-text`);
    multTexts.forEach(el => {
      el.textContent = `${this.multiplier}×`;
    });

    const comboDots = document.querySelectorAll(`${activeViewId} .hud-combo-dot`);
    comboDots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx < this.comboInTier);
    });

    const percent = Math.min(100, Math.max(0, this.progress * 100));

    const progressFills = document.querySelectorAll<HTMLElement>(`${activeViewId} .timeline-progress-green, ${activeViewId} .progress-fill`);
    progressFills.forEach(fill => {
      fill.style.width = `${percent}%`;
    });

    const playheads = document.querySelectorAll<HTMLElement>(`${activeViewId} .timeline-playhead`);
    playheads.forEach(pin => {
      pin.style.left = `${percent}%`;
    });
  }
}

export const gameplayEngine = new GameplayEngine();
