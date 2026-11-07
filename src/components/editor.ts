import { safeGet, safeSet } from '../storage';
import type { SongProject, LegacySongProject, EditorChord } from '../types/editor.types';
import { lastContentStepIndex } from '../rhythm';
import { fillSvgFromTemplate } from '../dom';
import { sanitizeSongProject } from '../songSafety';
import { getEditorSongId, newSongId, setEditorSongId, upsertLibrarySong } from '../songLibrary';
import { furEliseSong } from '../songs/furElise';
import { cocoVideoSong, videoSongs } from '../songs/videoSongs';
import { setupEventListeners, setupPopoverEvents } from './editor/controls';
import { handleSelectedAudioFile, processPendingAudioFile, revokeReferenceObjectUrl, setupAudioExtractionEvents, showEditorMessage } from './editor/audioImport';
import { formatAudioTime, insertCurrentInspectedNote, inspectAudioAtTime, removeReferenceAudio, setupAudioPlayerEvents, setupReferenceAudioPlayer, toggleReferenceAudio } from './editor/referenceAudio';
import { playSequencerStep, startDualPlayback, startSequencerPlayback, stopDualPlayback, stopSequencerPlayback, toggleDualPlayback, toggleSequencerPlayback } from './editor/sequencer';
import { applySelectedNote, clearAllPlacedItems, deleteSelectedNote, handleCellClick, promptAddChord, renderChordBlocks, renderGrid, renderHeaderMeasures, updateStats } from './editor/grid';
import { exportSongJSON, importSongJSON, playInGame } from './editor/io';

export class SongEditor {
  public currentSong: SongProject = {
    title: 'Mi Canción',
    section: 'Canción',
    bpm: 85,
    mode: 'notes',
    measures: 8,
    notes: [],
    chords: []
  };
  public currentLibraryId: string = getEditorSongId();

  // Audio Reference Player state
  public referenceAudio: HTMLAudioElement | null = null;
  public isReferenceAudioPlaying: boolean = false;
  public pendingFileToExtract: File | null = null;
  public decodedAudioBuffer: AudioBuffer | null = null;
  public currentInspectedNote: { freq: number; string: number; fret: number; finger: number; name: string } | null = null;

  // In-Editor Sequencer Playback state
  public isSequencerPlaying: boolean = false;
  public sequencerPlayInterval: number | null = null;
  public currentSequencerBeat: number = 0;
  public isDualPlaybackPlaying: boolean = false;
  referenceObjectUrl: string | null = null;

  extractionGeneration = 0;

  public selectedCell: { string: number; measure: number; beat: number; step: number; cellElement?: HTMLElement } | null = null;
  public selectedFret: number = 3;
  public selectedFinger: number = 1;
  public selectedChord: string = 'Am';
  public selectedChordColor: string = '#ea5b57';
  public selectedDuration: number = 4;
  public selectedNoteDuration: number = 1;

  setSvgIcon(el: Element | null, kind: 'play' | 'pause' | 'pause-filled' | 'upload'): void {
    if (!el) return;
    const ids = {
      play: 'tpl-svg-play',
      pause: 'tpl-svg-pause',
      'pause-filled': 'tpl-svg-pause-filled',
      upload: 'tpl-svg-upload'
    } as const;
    try {
      fillSvgFromTemplate(el, ids[kind]);
    } catch {
      // ignore missing templates
    }
  }

  ensurePlayhead(): HTMLElement | null {
    const matrix = document.getElementById('editor-matrix-grid');
    if (!matrix) return null;
    let playhead = document.getElementById('editor-playhead-line');
    if (!playhead || playhead.parentElement !== matrix) {
      playhead = document.createElement('div');
      playhead.className = 'editor-playhead-line';
      playhead.id = 'editor-playhead-line';
      playhead.style.display = 'none';
      matrix.appendChild(playhead);
    } else if (playhead !== matrix.lastElementChild) {
      matrix.appendChild(playhead);
    }
    return playhead;
  }

  setPlaybackButtonState(playing: boolean): void {
    const playBtnText = document.getElementById('editor-play-seq-text');
    const playBtnIcon = document.getElementById('editor-play-seq-icon');
    if (playBtnText) playBtnText.textContent = playing ? 'Pausar' : 'Pista';
    this.setSvgIcon(playBtnIcon, playing ? 'pause' : 'play');
  }

  playbackStepCount(): number {
    const last = lastContentStepIndex(this.currentSong);
    return last < 0 ? 0 : last + 1;
  }

  public presets: Record<string, LegacySongProject & { chords: (EditorChord & { durationBeats?: number })[] }> = {
    fur_elise: furEliseSong,
    coco_recuerdame: cocoVideoSong,
    ...videoSongs,
    empty_notes: {
      title: 'Nueva Melodía',
      section: 'Sección 1',
      bpm: 90,
      mode: 'notes',
      measures: 8,
      notes: [],
      chords: []
    }
  };

  public init(): void {
    this.fillPresetSelect();
    this.loadFromStorage();
    this.setupEventListeners();
    this.renderHeaderMeasures();
    this.renderGrid();
    this.updateStats();
    upsertLibrarySong(this.currentLibraryId, this.currentSong);
  }

  fillPresetSelect(): void {
    const presetSelect = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
    if (!presetSelect) return;
    presetSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Elegí una plantilla';
    presetSelect.appendChild(placeholder);
    for (const [key, song] of Object.entries(this.presets)) {
      if (key === 'empty_notes') continue;
      const option = document.createElement('option');
      option.value = key;
      option.textContent = song.title;
      presetSelect.appendChild(option);
    }
  }

  public loadFromStorage(): void {
    try {
      const saved = safeGet('guitar_custom_song') || safeGet('yousician_custom_song');
      if (saved) {
        const parsed = sanitizeSongProject(JSON.parse(saved));
        if (!parsed) throw new Error('invalid song');
        this.currentSong = parsed;
        this.currentSong.mode = 'notes';
        this.currentLibraryId = getEditorSongId();
        this.updateToolbarUI();
      } else {
        this.currentLibraryId = newSongId();
        setEditorSongId(this.currentLibraryId);
        this.loadPreset('coco_recuerdame');
      }
    } catch {
      this.currentLibraryId = newSongId();
      setEditorSongId(this.currentLibraryId);
      this.loadPreset('coco_recuerdame');
    }
  }

  public saveToStorage(): void {
    try {
      safeSet('guitar_custom_song', JSON.stringify(this.currentSong));
      setEditorSongId(this.currentLibraryId);
      upsertLibrarySong(this.currentLibraryId, this.currentSong);
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  public loadPreset(presetKey: string): void {
    const key = presetKey === 'yousician_notes' ? 'fur_elise' : presetKey;
    const p = this.presets[key];
    if (!p) return;
    this.currentSong = sanitizeSongProject(JSON.parse(JSON.stringify(p))) ?? this.currentSong;
    this.currentLibraryId = newSongId();
    setEditorSongId(this.currentLibraryId);
    this.updateToolbarUI();
    this.renderGrid();
    this.updateStats();
  }

  public updateToolbarUI(): void {
    const titleInput = document.getElementById('editor-song-title') as HTMLInputElement | null;
    const bpmSlider = document.getElementById('editor-bpm-slider') as HTMLInputElement | null;
    const bpmVal = document.getElementById('editor-bpm-val');
    const modeBtns = document.querySelectorAll<HTMLElement>('.editor-mode-btn');

    if (titleInput) titleInput.value = this.currentSong.title;
    if (bpmSlider) bpmSlider.value = this.currentSong.bpm.toString();
    if (bpmVal) bpmVal.textContent = this.currentSong.bpm.toString();

    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.currentSong.mode);
    });

    const chords = this.currentSong.mode === 'chords';
    const chordLane = document.getElementById('editor-chord-lane');
    if (chordLane) chordLane.classList.toggle('active', chords);
    document.querySelector('.editor-grid-scroll-area')?.classList.toggle('is-chords', chords);
    document.getElementById('view-editor')?.classList.toggle('is-chord-mode', chords);
    const hint = document.querySelector('.editor-hint span');
    if (hint && !chords) {
      hint.textContent = 'Haz clic en un pulso (cada celda es una semicorchea). En la nota elegí 1/16, 1/8, 1/4 o 1/2. Notas en la misma columna = a la vez.';
    }
  }

  setupEventListeners(): void { return setupEventListeners(this); }

  setupAudioExtractionEvents(): void { return setupAudioExtractionEvents(this); }

  showEditorMessage(message: string): void { return showEditorMessage(message); }

  applySong(song: SongProject): void {
    const safe = sanitizeSongProject(song);
    if (!safe) return;
    this.currentSong = safe;
    this.currentLibraryId = newSongId();
    setEditorSongId(this.currentLibraryId);
    this.updateToolbarUI();
    this.renderHeaderMeasures();
    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  revokeReferenceObjectUrl(): void { return revokeReferenceObjectUrl(this); }

  handleSelectedAudioFile(file: File): void { return handleSelectedAudioFile(this, file); }

  public async processPendingAudioFile(file: File): Promise<void> { return processPendingAudioFile(this, file); }

  setupAudioPlayerEvents(): void { return setupAudioPlayerEvents(this); }

  public setupReferenceAudioPlayer(audioSrc: string, title: string): void { return setupReferenceAudioPlayer(this, audioSrc, title); }

  /**
   * Real-time audio pitch inspector (Afinador de la pista en tiempo real)
   */
  public inspectAudioAtTime(currentTimeSeconds: number): void { return inspectAudioAtTime(this, currentTimeSeconds); }

  /**
   * Insert currently inspected note directly into the closest measure and beat
   */
  public insertCurrentInspectedNote(): void { return insertCurrentInspectedNote(this); }

  public toggleReferenceAudio(): void { return toggleReferenceAudio(this); }

  public removeReferenceAudio(): void { return removeReferenceAudio(this); }

  formatAudioTime(seconds: number): string { return formatAudioTime(seconds); }

  // =========================================================================
  // IN-EDITOR SEQUENCER PLAYBACK ENGINE
  // =========================================================================
  public toggleSequencerPlayback(): void { return toggleSequencerPlayback(this); }

  public startSequencerPlayback(): void { return startSequencerPlayback(this); }

  public playSequencerStep(): void { return playSequencerStep(this); }

  public stopSequencerPlayback(): void { return stopSequencerPlayback(this); }

  // =========================================================================
  // DUAL SIMULTANEOUS PLAYBACK (AUDIO DE REFERENCIA + NOTAS DE GUITARRA)
  // =========================================================================
  public toggleDualPlayback(): void { return toggleDualPlayback(this); }

  public async startDualPlayback(): Promise<void> { return startDualPlayback(this); }

  public stopDualPlayback(): void { return stopDualPlayback(this); }

  setupPopoverEvents(): void { return setupPopoverEvents(this); }

  public renderHeaderMeasures(): void { return renderHeaderMeasures(this); }

  public renderGrid(): void { return renderGrid(this); }

  public renderChordBlocks(): void { return renderChordBlocks(this); }

  public handleCellClick(cell: HTMLElement, stringNum: number, measure: number, beat: number, step: number, _event: MouseEvent): void { return handleCellClick(this, cell, stringNum, measure, beat, step, _event); }

  public applySelectedNote(): void { return applySelectedNote(this); }

  public deleteSelectedNote(): void { return deleteSelectedNote(this); }

  public promptAddChord(measure: number, beat: number): void { return promptAddChord(this, measure, beat); }

  public clearAllPlacedItems(): void { return clearAllPlacedItems(this); }

  public updateStats(): void { return updateStats(this); }

  public playInGame(): void { return playInGame(this); }

  public exportSongJSON(): void { return exportSongJSON(this); }

  public importSongJSON(event: Event): void { return importSongJSON(this, event); }
}

export const songEditor = new SongEditor();
