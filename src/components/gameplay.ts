import { guitarAudio } from '../audio/audioEngine';
import { chordMatchesChroma } from '../audio/chords';
import { cloneTemplate, firstElement, setSlotText, fillFromTemplate, fillSvgFromTemplate } from '../dom';
import type { NoteTrackItem, ChordTrackItem, GameplayMode, GameplaySessionMode } from '../types/gameplay.types';
import type { SongProject } from '../types/editor.types';
import { goToScreen } from '../screens';
import { noteDurationSteps, noteStartStepIndex, noteStep, STEPS_PER_BEAT } from '../rhythm';
import { fingerCapsuleClass, sanitizeCssColor, sanitizeFinger, sanitizeSongProject } from '../songSafety';

interface TrackNoteWithDOM extends NoteTrackItem {
  el?: HTMLElement;
}

interface TrackChordWithDOM extends ChordTrackItem {
  el?: HTMLElement;
}

interface ChordDiagramDot {
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
  public isPlaying: boolean = false;
  public mode: GameplayMode = 'notes';
  public sessionMode: GameplaySessionMode = 'performance';
  public isLooping: boolean = false;
  public loopStartRatio: number | null = null;
  public loopEndRatio: number | null = null;
  private loopHandleDrag: 'start' | 'end' | null = null;
  public isCustomSongLoaded: boolean = false;
  public score: number = 0;
  public targetScore: number = 3450;
  public multiplier: number = 1;
  public combo: number = 0;
  public comboInTier: number = 0;
  public maxCombo: number = 0;
  public songTitle: string = 'Melodía de Guitarra';
  public progress: number = 0;
  public bpm: number = 85;
  public scrollSpeed: number = 220;
  public lastTime: number = 0;
  public animationFrame: number | null = null;
  public isCountingDown: boolean = false;
  private countdownTimer: number | null = null;

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

  /** How far before or after a note the mic may score it, in seconds. */
  private static readonly MIC_TIMING_WINDOW = 0.45;
  /** Shortest gap between two mic-scored attacks, in milliseconds (~7 notes per second). */
  private static readonly MIC_REFRACTORY_MS = 140;
  /** How long after an attack to wait before reading its pitch, in milliseconds. */
  private static readonly MIC_ATTACK_SETTLE_MS = 45;
  private static readonly MIC_CENTS_TOLERANCE = 50;
  private static readonly MIC_OCTAVE_CENTS_TOLERANCE = 35;

  private micRefractoryUntil: number = 0;
  private micAttackPendingAt: number = 0;
  private micLastAttackFreq: number = 0;

  public currentActiveChordName: string = 'Am';

  public setSpeed(speed: number | string): void {
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

  public setSessionMode(mode: GameplaySessionMode): void {
    this.sessionMode = mode;
    if (mode === 'performance') {
      this.isLooping = false;
      this.setSpeed(1.0);
    }
    this.updateSessionModeUI();
    this.updateSpeedUI();
    this.updateLoopRegionUI();
  }

  public hasLoopRegion(): boolean {
    return this.loopStartRatio !== null && this.loopEndRatio !== null && this.loopEndRatio - this.loopStartRatio > 0.01;
  }

  private loopMinGap(): number {
    return Math.max(0.035, 0.7 / Math.max(this.songDuration, 1));
  }

  public loopStartTime(): number {
    return (this.loopStartRatio ?? 0) * this.songDuration;
  }

  public loopEndTime(): number {
    return (this.loopEndRatio ?? 1) * this.songDuration;
  }

  public clearLoopRegion(): void {
    this.loopStartRatio = null;
    this.loopEndRatio = null;
    this.updateLoopRegionUI();
  }

  public setLoopPoint(ratio: number): void {
    if (this.sessionMode !== 'practice') {
      this.setSessionMode('practice');
    }
    const clamped = Math.max(0, Math.min(1, ratio));
    const minGap = this.loopMinGap();

    if (this.loopStartRatio === null) {
      this.loopStartRatio = clamped;
      this.loopEndRatio = Math.min(1, clamped + minGap);
    } else if (this.loopEndRatio === null) {
      this.placeLoopEnd(clamped, minGap);
    } else {
      const distStart = Math.abs(clamped - this.loopStartRatio);
      const distEnd = Math.abs(clamped - this.loopEndRatio);
      if (distStart <= distEnd) {
        this.loopStartRatio = Math.min(clamped, this.loopEndRatio - minGap);
      } else {
        this.loopEndRatio = Math.max(clamped, this.loopStartRatio + minGap);
      }
    }

    this.loopStartRatio = Math.max(0, Math.min(1 - minGap, this.loopStartRatio));
    this.loopEndRatio = Math.max((this.loopStartRatio ?? 0) + minGap, Math.min(1, this.loopEndRatio ?? 1));
    this.isLooping = true;
    this.updateSessionModeUI();
    this.updateLoopRegionUI();
  }

  private placeLoopEnd(clamped: number, minGap: number): void {
    const start = this.loopStartRatio ?? 0;
    if (clamped < start) {
      this.loopEndRatio = start;
      this.loopStartRatio = Math.max(0, clamped);
    } else {
      this.loopEndRatio = clamped;
    }
    if ((this.loopEndRatio ?? 0) - (this.loopStartRatio ?? 0) < minGap) {
      this.loopEndRatio = Math.min(1, (this.loopStartRatio ?? 0) + minGap);
    }
  }

  public updateLoopRegionUI(): void {
    const show = this.sessionMode === 'practice' && this.loopStartRatio !== null;
    document.querySelectorAll<HTMLElement>('.timeline-loop-region').forEach(region => {
      if (!show) {
        region.hidden = true;
        return;
      }
      region.hidden = false;
      const start = (this.loopStartRatio ?? 0) * 100;
      const end = (this.loopEndRatio ?? (this.loopStartRatio ?? 0) + 2) * 100;
      region.style.left = `${start}%`;
      region.style.width = `${Math.max(1.2, end - start)}%`;
    });
  }

  public toggleLoop(): void {
    if (this.sessionMode === 'performance') {
      this.setSessionMode('practice');
    }
    this.isLooping = !this.isLooping;
    this.updateSessionModeUI();
  }

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

    const speedControls = document.querySelectorAll<HTMLElement>('.hud-speed-controller-pill');
    speedControls.forEach(pill => {
      if (this.sessionMode === 'performance') {
        pill.classList.add('performance-locked');
      } else {
        pill.classList.remove('performance-locked');
      }
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
      this.notesTrack = JSON.parse(JSON.stringify(this.defaultNotes));
      this.buildDOMNotes();
    } else {
      this.targetScore = 3050;
      this.songDuration = 22.0;
      this.chordsTrack = JSON.parse(JSON.stringify(this.defaultChords));
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
    this.mode = song.mode;
    this.songTitle = song.title || song.section || 'Canción';
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
        return {
          id: n.id || idx,
          string: n.string,
          fret: n.fret,
          time: stepIndex * stepSeconds + 1.5,
          finger: sanitizeFinger(n.finger),
          label: `${n.fret}`,
          hit: false,
          duration: dur
        };
      });
      this.notesTrack.sort((a, b) => a.time - b.time);
      this.buildDOMNotes();
    } else {
      this.targetScore = Math.max(1200, (song.chords.length || 4) * 750);
      this.chordsTrack = song.chords.map((c, idx) => {
        const beatIndex = (c.measure - 1) * 4 + (c.beat - 1);
        const dur = c.duration || 4;
        return {
          id: c.id || idx,
          chord: c.chord,
          time: beatIndex * beatSeconds + 1.5,
          width: dur * 70,
          color: sanitizeCssColor(c.color),
          label: c.chord,
          hit: false
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
      capsule.style.width = `${Math.max(70, (note.duration ?? 4) * 44)}px`;
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

    this.chordsTrack.forEach(chord => {
      const blockFrag = cloneTemplate('tpl-game-chord-block');
      const block = firstElement<HTMLElement>(blockFrag);
      if (!block) return;
      block.dataset.chord = chord.chord;
      block.style.background = sanitizeCssColor(chord.color);
      block.style.width = `${chord.width}px`;
      block.style.left = '0px';
      block.style.willChange = 'transform';
      setSlotText(block, 'label', chord.label);

      block.addEventListener('click', () => {
        this.userPlayChord(chord.chord);
      });

      chord.el = block;
      container.appendChild(blockFrag);
    });
  }

  public startPlaying(): void {
    if (this.isCountingDown) return;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.wasPlayingThisSession = true;
      this.lastTime = performance.now();
      this.updatePlayPauseIcons();
      this.loop(this.lastTime);
    }
  }

  public pausePlaying(): void {
    this.isPlaying = false;
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
    if (this.isCountingDown) return;
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

    this.renderFrame();
    this.updateUI();

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
      badgeText = '⭐ ⭐ ⭐ 3 ESTRELLAS (EXCELENTE)';
    } else if (accuracy >= 70) {
      stars = 2;
      verdict = '¡MUY BUENA INTERPRETACIÓN!';
      badgeText = '⭐ ⭐ 2 ESTRELLAS (MUY BIEN)';
    } else if (accuracy >= 40) {
      stars = 1;
      verdict = '¡BUEN INTENTO! VAS POR BUEN CAMINO';
      badgeText = '⭐ 1 ESTRELLA (BUENO)';
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

    modal.style.display = 'flex';
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

    if (this.mode === 'notes') {
      this.renderNotesMotion(width, height, hitZoneX);
    } else {
      this.renderChordsMotion(width, height, hitZoneX);
    }
  }

  public renderNotesMotion(width: number, height: number, hitZoneX: number): void {
    const container = document.querySelector('#view-notes .fretboard-canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : null;
    const stringEls = container ? container.querySelectorAll<HTMLElement>('.track-string') : null;

    const stringYs: Record<number, number> = {};
    if (stringEls && stringEls.length === 6 && containerRect && containerRect.height > 0) {
      stringEls.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        stringYs[index + 1] = (rect.top - containerRect.top) + (rect.height / 2);
      });
    } else {
      for (let s = 1; s <= 6; s++) {
        stringYs[s] = height * this.stringRatios[s];
      }
    }

    this.notesTrack.forEach(note => {
      if (!note.el) return;

      const noteX = hitZoneX + (note.time - this.currentTime) * this.scrollSpeed;
      const noteY = stringYs[note.string] || (height * 0.7);

      if (noteX > -260 && noteX < width + 300) {
        note.el.style.display = 'flex';
        note.el.style.transform = `translate3d(${noteX}px, ${noteY}px, 0) translateY(-50%)`;
      } else {
        note.el.style.display = 'none';
      }

      if (!note.hit && !note.missed) {
        if (this.currentTime > note.time + 0.45) {
          note.missed = true;
          this.triggerNoteMiss(note);
        }
      }
    });

    let ballY = height * 0.7;

    let prevNote: TrackNoteWithDOM | null = null;
    let nextNote: TrackNoteWithDOM | null = null;

    for (let i = 0; i < this.notesTrack.length; i++) {
      const n = this.notesTrack[i];
      if (n.time <= this.currentTime) {
        prevNote = n;
      } else {
        nextNote = n;
        break;
      }
    }

    if (prevNote && nextNote) {
      const interval = nextNote.time - prevNote.time;
      const u = Math.max(0, Math.min(1, (this.currentTime - prevNote.time) / interval));
      const startY = stringYs[prevNote.string];
      const endY = stringYs[nextNote.string];
      const baseY = startY + (endY - startY) * u;
      const arcPeak = 75;
      const bounceHeight = 4 * arcPeak * u * (1 - u);
      ballY = baseY - bounceHeight;
    } else if (nextNote) {
      const timeToHit = nextNote.time - this.currentTime;
      const u = Math.max(0, 1 - timeToHit / 2.0);
      const targetY = stringYs[nextNote.string];
      const arcPeak = 65;
      const bounceHeight = 4 * arcPeak * u * (1 - u);
      ballY = targetY - bounceHeight;
    } else if (prevNote) {
      ballY = stringYs[prevNote.string];
    }

    const ballEl = document.querySelector<HTMLElement>('#view-notes .bouncing-ball');
    if (ballEl) {
      ballEl.style.left = `${hitZoneX}px`;
      ballEl.style.top = `${ballY}px`;
    }

    const canvas = document.querySelector<HTMLCanvasElement>('#view-notes .trajectory-canvas');
    if (canvas) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.setLineDash([4, 8]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

        for (let i = 0; i < this.notesTrack.length - 1; i++) {
          const n1 = this.notesTrack[i];
          const n2 = this.notesTrack[i + 1];

          const x1 = hitZoneX + (n1.time - this.currentTime) * this.scrollSpeed;
          const y1 = stringYs[n1.string];
          const x2 = hitZoneX + (n2.time - this.currentTime) * this.scrollSpeed;
          const y2 = stringYs[n2.string];

          if (x2 > -100 && x1 < width + 100) {
            const arcWidth = x2 - x1;
            const peak = Math.min(90, Math.max(50, arcWidth * 0.25));

            ctx.beginPath();
            for (let px = 0; px <= arcWidth; px += 5) {
              const t = px / arcWidth;
              const curX = x1 + px;
              const baseY = y1 + (y2 - y1) * t;
              const curY = baseY - 4 * peak * t * (1 - t);

              if (px === 0) ctx.moveTo(curX, curY);
              else ctx.lineTo(curX, curY);
            }
            ctx.stroke();
          }
        }

        if (this.notesTrack.length > 0) {
          const firstNote = this.notesTrack[0];
          const fx = hitZoneX + (firstNote.time - this.currentTime) * this.scrollSpeed;
          const fy = stringYs[firstNote.string];
          const preBounceW = 140;

          for (let bx = fx - preBounceW * 2; bx < fx; bx += preBounceW) {
            if (bx + preBounceW > -50 && bx < width + 50) {
              ctx.beginPath();
              for (let px = 0; px <= preBounceW; px += 5) {
                const t = px / preBounceW;
                const curX = bx + px;
                const curY = fy - 4 * 60 * t * (1 - t);
                if (px === 0) ctx.moveTo(curX, curY);
                else ctx.lineTo(curX, curY);
              }
              ctx.stroke();
            }
          }
        }

        ctx.restore();
      }
    }
  }

  public renderChordsMotion(width: number, height: number, hitZoneX: number): void {
    const chordBaseY = height * 0.62;

    let currentActiveChord: TrackChordWithDOM | null = null;
    let closestUpcoming: TrackChordWithDOM | null = null;
    let minUpcomingDiff = Infinity;

    for (const chord of this.chordsTrack) {
      const blockWidth = chord.width || 300;
      const startX = hitZoneX + (chord.time - this.currentTime) * this.scrollSpeed;
      const endX = startX + blockWidth;

      if (hitZoneX >= startX - 20 && hitZoneX <= endX + 40) {
        currentActiveChord = chord;
        break;
      }

      const diff = chord.time - this.currentTime;
      if (diff > 0 && diff < minUpcomingDiff) {
        minUpcomingDiff = diff;
        closestUpcoming = chord;
      }
    }

    const chordToDisplay = currentActiveChord || closestUpcoming || this.chordsTrack[0];
    if (chordToDisplay && chordToDisplay.chord !== this.currentActiveChordName) {
      this.updateHudChordCard(chordToDisplay.chord);
    }

    this.chordsTrack.forEach(chord => {
      if (!chord.el) return;

      const chordX = hitZoneX + (chord.time - this.currentTime) * this.scrollSpeed;

      if (chordX > -400 && chordX < width + 400) {
        chord.el.style.display = 'flex';
        chord.el.style.transform = `translate3d(${chordX}px, 0, 0)`;
      } else {
        chord.el.style.display = 'none';
      }

      if (this.isPlaying && !chord.hit && !chord.missed && this.currentTime > chord.time + 0.55) {
        chord.missed = true;
        this.triggerChordMiss(chord);
      }
    });

    const ballEl = document.querySelector<HTMLElement>('#view-chords .bouncing-ball');
    let ballY = chordBaseY;
    if (this.isPlaying) {
      const cycle = (this.currentTime * 2) % 1;
      const h = Math.sin(cycle * Math.PI) * 35;
      ballY = chordBaseY - h;
    }
    if (ballEl) {
      ballEl.style.left = `${hitZoneX}px`;
      ballEl.style.top = `${ballY}px`;
    }

    const canvas = document.querySelector<HTMLCanvasElement>('#view-chords .trajectory-canvas');
    if (canvas) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.setLineDash([4, 8]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

        for (let i = 0; i < this.chordsTrack.length - 1; i++) {
          const c1 = this.chordsTrack[i];
          const c2 = this.chordsTrack[i + 1];
          const x1 = hitZoneX + (c1.time - this.currentTime) * this.scrollSpeed;
          const x2 = hitZoneX + (c2.time - this.currentTime) * this.scrollSpeed;

          if (x2 > -100 && x1 < width + 100) {
            const arcW = x2 - x1;
            ctx.beginPath();
            for (let px = 0; px <= arcW; px += 6) {
              const t = px / arcW;
              const curX = x1 + px;
              const curY = chordBaseY - 4 * 70 * t * (1 - t);
              if (px === 0) ctx.moveTo(curX, curY);
              else ctx.lineTo(curX, curY);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }

  public triggerNoteHit(note: TrackNoteWithDOM): void {
    guitarAudio.playString(note.string, note.fret);
    guitarAudio.playHitSound();

    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboInTier++;

    if (this.comboInTier >= 5) {
      this.comboInTier = 0;
      if (this.multiplier < 4) {
        this.multiplier++;
        this.triggerMultiplierPopup();
      }
    }

    this.score += 150 * this.multiplier;
    if (this.score > this.targetScore) this.score = this.targetScore;

    if (note.el) {
      note.el.classList.remove('miss-flash');
      note.el.classList.add('hit-flash');
      setTimeout(() => note.el?.classList.remove('hit-flash'), 220);
    }

    const ball = document.querySelector('#view-notes .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${150 * this.multiplier}`, false);
    this.markTimelineResult('n', note.id, 'hit');
    this.updateUI();
  }

  public triggerNoteMiss(note: TrackNoteWithDOM): void {
    this.combo = 0;
    this.comboInTier = 0;
    this.multiplier = 1;

    guitarAudio.playMissSound();

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
      const diff = Math.abs(this.currentTime - note.time);
      if (diff <= 0.28 && diff < minDiff) {
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
  private isNewAttack(freq: number, isOnset: boolean): boolean {
    const now = performance.now();

    if (isOnset && now >= this.micRefractoryUntil && this.micAttackPendingAt === 0) {
      // Don't read the pitch at the attack itself: the string is still broadband noise there and
      // the tracker is still reporting whatever was ringing before. Let the tone settle first.
      this.micAttackPendingAt = now;
    }

    if (this.micAttackPendingAt > 0) {
      if (now - this.micAttackPendingAt < GameplayEngine.MIC_ATTACK_SETTLE_MS) return false;
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
      const diff = Math.abs(this.currentTime - note.time);
      if (diff <= GameplayEngine.MIC_TIMING_WINDOW && diff < minDiff) {
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

    if (exactFretMatched || matchesPitch) {
      bestNote.hit = true;
      this.triggerNoteHit(bestNote);
    }
  }

  public handleMicChordDetected(freq: number, chroma?: Float32Array | null, isOnset: boolean = true): void {
    if (!this.isPlaying || this.mode !== 'chords') return;
    if (!this.isNewAttack(freq, isOnset)) return;

    let bestChord: TrackChordWithDOM | null = null;
    let minDiff = Infinity;

    for (const chord of this.chordsTrack) {
      if (chord.hit || chord.missed) continue;
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff <= 0.55 && diff < minDiff) {
        minDiff = diff;
        bestChord = chord;
      }
    }

    if (!bestChord) return;
    if (!chordMatchesChroma(bestChord.chord, freq, chroma)) return;

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
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff <= 0.5 && diff < minDiff) {
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
    this.combo = 0;
    this.comboInTier = 0;
    this.multiplier = 1;

    guitarAudio.playMissSound();

    if (chord.el) {
      chord.el.classList.add('miss-flash');
    }

    this.spawnScoreParticle('MISS', true);
    this.markTimelineResult('c', chord.id, 'miss');
    this.updateUI();
  }

  public updateHudChordCard(chordName: string): void {
    this.currentActiveChordName = chordName;

    const titleEl = document.querySelector('.hud-chord-card-title');
    if (titleEl) {
      titleEl.textContent = chordName;
    }

    const cardEl = document.querySelector('.hud-chord-card');
    if (cardEl) {
      cardEl.setAttribute('title', `Acorde actual: ${chordName}`);
      cardEl.classList.add('pulse');
      setTimeout(() => cardEl.classList.remove('pulse'), 250);
    }

    const svgEl = document.querySelector('.hud-chord-mini-svg');
    if (svgEl) {
      svgEl.querySelectorAll('.hud-finger-dot').forEach(dot => dot.remove());

      const diagram = this.chordDiagrams[chordName] || this.chordDiagrams['Am'];
      if (diagram && diagram.dots) {
        diagram.dots.forEach(d => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'hud-finger-dot');
          circle.setAttribute('cx', d.cx.toString());
          circle.setAttribute('cy', d.cy.toString());
          circle.setAttribute('r', '4.5');
          circle.setAttribute('fill', d.color);
          svgEl.appendChild(circle);
        });
      }
    }
  }

  public triggerChordHit(chord: TrackChordWithDOM): void {
    guitarAudio.playChord(chord.chord);
    guitarAudio.playHitSound();

    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboInTier++;

    if (this.comboInTier >= 3) {
      this.comboInTier = 0;
      if (this.multiplier < 4) {
        this.multiplier++;
        this.triggerMultiplierPopup();
      }
    }

    this.score += 300 * this.multiplier;
    if (this.score > this.targetScore) this.score = this.targetScore;

    if (chord.el) {
      chord.el.classList.add('hit-flash');
      setTimeout(() => chord.el?.classList.remove('hit-flash'), 220);
    }

    const ball = document.querySelector('#view-chords .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${300 * this.multiplier}`);
    this.markTimelineResult('c', chord.id, 'hit');
    this.updateUI();
  }

  public triggerMultiplierPopup(): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const multBox = document.querySelector(`${activeViewId} .hud-multiplier-box`);
    if (multBox) {
      multBox.classList.add('multiplier-up');
      setTimeout(() => multBox.classList.remove('multiplier-up'), 380);
    }
  }

  public spawnScoreParticle(text: string, isMiss: boolean = false): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const container = document.querySelector(`${activeViewId} .fretboard-canvas-container`);
    if (!container) return;

    const particle = document.createElement('div');
    particle.className = `hit-score-particle ${isMiss ? 'particle-miss' : ''}`;
    particle.textContent = text;
    particle.style.left = '35%';
    particle.style.top = isMiss ? '42%' : '38%';
    container.appendChild(particle);

    setTimeout(() => {
      particle.remove();
    }, 850);
  }

  public renderTimelineMarkers(): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const trackArea = document.querySelector(`${activeViewId} .timeline-track-area`);
    if (!trackArea) return;

    trackArea.querySelectorAll('.timeline-mini-marker').forEach(m => m.remove());

    if (this.mode === 'notes') {
      const fingerColors: Record<number, string> = {
        0: '#8a929e',
        1: '#f5a623',
        2: '#00d2ff',
        3: '#e024c3',
        4: '#8e44ad'
      };

      this.notesTrack.forEach(n => {
        const leftPercent = (n.time / this.songDuration) * 100;
        if (leftPercent >= 0 && leftPercent <= 100) {
          const marker = document.createElement('div');
          marker.className = 'timeline-mini-marker type-note';
          marker.dataset.tlId = `n-${n.id}`;
          marker.style.left = `${leftPercent}%`;
          marker.style.background = fingerColors[sanitizeFinger(n.finger)] || '#f5a623';
          if (n.hit) marker.classList.add('is-hit');
          if (n.missed) marker.classList.add('is-miss');
          trackArea.appendChild(marker);
        }
      });
    } else {
      this.chordsTrack.forEach(c => {
        const leftPercent = (c.time / this.songDuration) * 100;
        const widthPercent = Math.max(3, (c.width / (this.scrollSpeed * this.songDuration)) * 100);
        if (leftPercent >= 0 && leftPercent <= 100) {
          const marker = document.createElement('div');
          marker.className = 'timeline-mini-marker type-chord';
          marker.dataset.tlId = `c-${c.id}`;
          marker.style.left = `${leftPercent}%`;
          marker.style.width = `${widthPercent}%`;
          marker.style.background = sanitizeCssColor(c.color);
          if (c.hit) marker.classList.add('is-hit');
          if (c.missed) marker.classList.add('is-miss');
          trackArea.appendChild(marker);
        }
      });
    }
  }

  public markTimelineResult(kind: 'n' | 'c', id: number, result: 'hit' | 'miss'): void {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const marker = document.querySelector(`${activeViewId} .timeline-mini-marker[data-tl-id="${kind}-${id}"]`);
    if (!marker) return;
    marker.classList.remove('is-hit', 'is-miss');
    marker.classList.add(result === 'hit' ? 'is-hit' : 'is-miss');
  }

  public setupScrubbingListeners(): void {
    const trackAreas = document.querySelectorAll<HTMLElement>('.timeline-track-area');
    trackAreas.forEach(track => {
      let isDragging = false;

      const ratioFromEvent = (e: MouseEvent | TouchEvent): number | null => {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      };

      const handleSeek = (e: MouseEvent | TouchEvent) => {
        const ratio = ratioFromEvent(e);
        if (ratio === null) return;
        if (this.loopHandleDrag) {
          const minGap = this.loopMinGap();
          if (this.loopHandleDrag === 'start') {
            this.loopStartRatio = Math.min(ratio, (this.loopEndRatio ?? 1) - minGap);
            this.loopStartRatio = Math.max(0, this.loopStartRatio);
          } else {
            this.loopEndRatio = Math.max(ratio, (this.loopStartRatio ?? 0) + minGap);
            this.loopEndRatio = Math.min(1, this.loopEndRatio);
          }
          this.updateLoopRegionUI();
          return;
        }
        this.seekTo(ratio);
      };

      track.addEventListener('mousedown', (e) => {
        const handle = (e.target as HTMLElement).closest('.timeline-loop-handle');
        if (handle) {
          e.preventDefault();
          e.stopPropagation();
          this.loopHandleDrag = handle.classList.contains('is-start') ? 'start' : 'end';
          if (this.sessionMode !== 'practice') this.setSessionMode('practice');
          this.isLooping = true;
          isDragging = true;
          return;
        }
        if (e.shiftKey) {
          const ratio = ratioFromEvent(e);
          if (ratio !== null) this.setLoopPoint(ratio);
          return;
        }
        isDragging = true;
        handleSeek(e);
      });

      track.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.clearLoopRegion();
      });

      window.addEventListener('mousemove', (e) => {
        if (isDragging) {
          handleSeek(e);
        }
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
        this.loopHandleDrag = null;
      });

      track.addEventListener('touchstart', (e) => {
        isDragging = true;
        handleSeek(e);
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (isDragging) {
          handleSeek(e);
        }
      }, { passive: true });

      window.addEventListener('touchend', () => {
        isDragging = false;
        this.loopHandleDrag = null;
      });
    });

    this.setupHUDListeners();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      const onGameplay = document.getElementById('view-notes')?.classList.contains('view-active')
        || document.getElementById('view-chords')?.classList.contains('view-active');
      if (!onGameplay) return;
      if (this.isCountingDown) this.cancelCountdown();
      if (this.isPlaying) this.pausePlaying();
    });

    document.querySelectorAll<HTMLElement>('.fretboard-canvas-container').forEach(canvas => {
      canvas.addEventListener('click', (e) => {
        if (this.isCountingDown || !this.isPlaying) return;
        const target = e.target as HTMLElement;
        if (target.closest('.timeline-track-area') || target.closest('.play-pause-btn')) return;
        e.preventDefault();
        this.pausePlaying();
      });
    });

    const resumeBtn = document.getElementById('pause-resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startPlaying();
      });
    }

    const pauseExitBtn = document.getElementById('pause-exit-btn');
    if (pauseExitBtn) {
      pauseExitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.wasPlayingThisSession = false;
        this.pausePlaying();
        goToScreen('menu');
      });
    }
  }

  public setupHUDListeners(): void {
    // Mode switcher buttons
    document.querySelectorAll<HTMLElement>('.mode-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isPlaying) return;
        const sMode = (btn.getAttribute('data-session-mode') || 'performance') as GameplaySessionMode;
        this.setSessionMode(sMode);
        guitarAudio.playClickSound();
      });
    });

    // Speed slider
    document.querySelectorAll<HTMLInputElement>('.gameplay-speed-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        this.setSpeed(val / 100);
      });
    });

    // Step speed buttons
    document.querySelectorAll<HTMLElement>('.speed-minus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.adjustSpeed(-0.1);
        guitarAudio.playClickSound();
      });
    });

    document.querySelectorAll<HTMLElement>('.speed-plus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.adjustSpeed(0.1);
        guitarAudio.playClickSound();
      });
    });

    // Loop toggle button
    document.querySelectorAll<HTMLElement>('.hud-loop-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleLoop();
        guitarAudio.playClickSound();
      });
    });

    // Performance Results Modal buttons
    const retryBtn = document.getElementById('perf-btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.retryPerformance();
      });
    }

    const practiceBtn = document.getElementById('perf-btn-practice');
    if (practiceBtn) {
      practiceBtn.addEventListener('click', () => {
        this.switchToPracticeFromModal();
      });
    }

    const exitBtn = document.getElementById('perf-btn-exit');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        const modal = document.getElementById('performance-results-modal');
        if (modal) modal.style.display = 'none';

        goToScreen(this.isCustomSongLoaded ? 'editor' : 'menu');
      });
    }
  }

  public retryPerformance(): void {
    const modal = document.getElementById('performance-results-modal');
    if (modal) modal.style.display = 'none';

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
