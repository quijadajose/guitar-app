import { guitarAudio } from '../audio/audioEngine';
import { audioExtractor } from '../audio/audioExtractor';
import { copyPcmChannels, extractionClient } from '../audio/extractionClient';
import type { SongProject, LegacySongProject, EditorNote, EditorChord } from '../types/editor.types';
import { beatFromStep, lastContentStepIndex, noteDurationSteps, noteStep, STEP_CELL_PX, STEPS_PER_BEAT, STEPS_PER_MEASURE } from '../rhythm';
import { gameplayEngine } from './gameplay';
import { fillSvgFromTemplate } from '../dom';
import { goToScreen, queueGameplaySong } from '../screens';
import {
  SONG_LIMITS,
  fingerChipClass,
  isAllowedJsonFile,
  isAllowedMediaFile,
  sanitizeCssColor,
  sanitizeDownloadName,
  sanitizePlainText,
  sanitizeSongProject
} from '../songSafety';
import { getEditorSongId, newSongId, setEditorSongId, upsertLibrarySong } from '../songLibrary';
import { furEliseSong } from '../songs/furElise';

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
  private referenceObjectUrl: string | null = null;

  private extractionGeneration = 0;

  public selectedCell: { string: number; measure: number; beat: number; step: number; cellElement?: HTMLElement } | null = null;
  public selectedFret: number = 3;
  public selectedFinger: number = 1;
  public selectedChord: string = 'Am';
  public selectedChordColor: string = '#ea5b57';
  public selectedDuration: number = 4;
  public selectedNoteDuration: number = 1;

  private setSvgIcon(el: Element | null, kind: 'play' | 'pause' | 'pause-filled' | 'upload'): void {
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

  private ensurePlayhead(): HTMLElement | null {
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

  private setPlaybackButtonState(playing: boolean): void {
    const playBtnText = document.getElementById('editor-play-seq-text');
    const playBtnIcon = document.getElementById('editor-play-seq-icon');
    if (playBtnText) playBtnText.textContent = playing ? 'Pausar' : 'Pista';
    this.setSvgIcon(playBtnIcon, playing ? 'pause' : 'play');
  }

  private playbackStepCount(): number {
    const last = lastContentStepIndex(this.currentSong);
    return last < 0 ? 0 : last + 1;
  }

  public presets: Record<string, LegacySongProject & { chords: (EditorChord & { durationBeats?: number })[] }> = {
    fur_elise: furEliseSong,
    coco_recuerdame: {
      title: 'Recuérdame (Coco)',
      section: 'Tema Principal',
      bpm: 88,
      mode: 'notes',
      measures: 8,
      notes: [
        { id: 1, measure: 1, beat: 2, string: 2, fret: 3, finger: 2 },
        { id: 2, measure: 1, beat: 3, string: 1, fret: 0, finger: 0 },
        { id: 3, measure: 1, beat: 4, string: 2, fret: 1, finger: 1 },
        { id: 4, measure: 2, beat: 1, string: 3, fret: 0, finger: 0 },
        { id: 5, measure: 2, beat: 3, string: 3, fret: 0, finger: 0 },
        { id: 6, measure: 2, beat: 4, string: 4, fret: 3, finger: 2 },
        { id: 7, measure: 3, beat: 1, string: 5, fret: 3, finger: 3 },
        { id: 8, measure: 3, beat: 2, string: 2, fret: 1, finger: 1 },
        { id: 9, measure: 3, beat: 3, string: 2, fret: 1, finger: 1 },
        { id: 10, measure: 3, beat: 4, string: 2, fret: 3, finger: 2 },
        { id: 11, measure: 4, beat: 1, string: 2, fret: 3, finger: 2 },
        { id: 12, measure: 4, beat: 2, string: 1, fret: 0, finger: 0 },
        { id: 13, measure: 4, beat: 3, string: 1, fret: 0, finger: 0 },
        { id: 14, measure: 4, beat: 4, string: 2, fret: 3, finger: 2 },
        { id: 15, measure: 5, beat: 1, string: 3, fret: 0, finger: 0 },
        { id: 16, measure: 5, beat: 2, string: 1, fret: 0, finger: 0 },
        { id: 17, measure: 5, beat: 3, string: 2, fret: 3, finger: 2 },
        { id: 18, measure: 5, beat: 4, string: 2, fret: 1, finger: 1 },
        { id: 19, measure: 6, beat: 1, string: 3, fret: 0, finger: 0 },
        { id: 20, measure: 6, beat: 2, string: 3, fret: 2, finger: 2 },
        { id: 21, measure: 6, beat: 3, string: 4, fret: 3, finger: 3 },
        { id: 22, measure: 6, beat: 4, string: 4, fret: 0, finger: 0 },
        { id: 23, measure: 7, beat: 1, string: 2, fret: 1, finger: 1 },
        { id: 24, measure: 7, beat: 2, string: 2, fret: 3, finger: 2 },
        { id: 25, measure: 7, beat: 3, string: 1, fret: 0, finger: 0 },
        { id: 26, measure: 7, beat: 4, string: 1, fret: 1, finger: 1 },
        { id: 27, measure: 8, beat: 1, string: 1, fret: 3, finger: 3 },
        { id: 28, measure: 8, beat: 2, string: 1, fret: 0, finger: 0 },
        { id: 29, measure: 8, beat: 3, string: 2, fret: 1, finger: 1 },
        { id: 30, measure: 8, beat: 4, string: 5, fret: 3, finger: 3 }
      ],
      chords: []
    },
    nothing_else_matters: {
      title: 'Nothing Else Matters (Completa)',
      section: 'Intro Acústico',
      bpm: 92,
      mode: 'notes',
      measures: 8,
      notes: [
        { id: 1, measure: 1, beat: 1, string: 6, fret: 0, finger: 0 },
        { id: 2, measure: 1, beat: 2, string: 3, fret: 0, finger: 0 },
        { id: 3, measure: 1, beat: 3, string: 2, fret: 0, finger: 0 },
        { id: 4, measure: 1, beat: 4, string: 1, fret: 0, finger: 0 },
        { id: 5, measure: 2, beat: 1, string: 2, fret: 0, finger: 0 },
        { id: 6, measure: 2, beat: 2, string: 3, fret: 0, finger: 0 },
        { id: 7, measure: 2, beat: 3, string: 1, fret: 7, finger: 3 },
        { id: 8, measure: 2, beat: 4, string: 2, fret: 0, finger: 0 },
        { id: 9, measure: 3, beat: 1, string: 1, fret: 7, finger: 3 },
        { id: 10, measure: 3, beat: 2, string: 1, fret: 0, finger: 0 },
        { id: 11, measure: 3, beat: 3, string: 2, fret: 0, finger: 0 },
        { id: 12, measure: 3, beat: 4, string: 3, fret: 0, finger: 0 },
        { id: 13, measure: 4, beat: 1, string: 1, fret: 7, finger: 3 },
        { id: 14, measure: 4, beat: 2, string: 1, fret: 8, finger: 4 },
        { id: 15, measure: 4, beat: 3, string: 1, fret: 7, finger: 3 },
        { id: 16, measure: 4, beat: 4, string: 1, fret: 0, finger: 0 },
        { id: 17, measure: 5, beat: 1, string: 1, fret: 5, finger: 2 },
        { id: 18, measure: 5, beat: 2, string: 1, fret: 3, finger: 1 },
        { id: 19, measure: 5, beat: 3, string: 1, fret: 2, finger: 1 },
        { id: 20, measure: 5, beat: 4, string: 1, fret: 0, finger: 0 },
        { id: 21, measure: 6, beat: 1, string: 2, fret: 3, finger: 2 },
        { id: 22, measure: 6, beat: 2, string: 2, fret: 0, finger: 0 },
        { id: 23, measure: 6, beat: 3, string: 3, fret: 0, finger: 0 },
        { id: 24, measure: 6, beat: 4, string: 4, fret: 2, finger: 1 },
        { id: 25, measure: 7, beat: 1, string: 6, fret: 0, finger: 0 },
        { id: 26, measure: 7, beat: 2, string: 3, fret: 0, finger: 0 },
        { id: 27, measure: 7, beat: 3, string: 2, fret: 0, finger: 0 },
        { id: 28, measure: 7, beat: 4, string: 1, fret: 0, finger: 0 },
        { id: 29, measure: 8, beat: 1, string: 6, fret: 0, finger: 0 },
        { id: 30, measure: 8, beat: 2, string: 4, fret: 2, finger: 2 },
        { id: 31, measure: 8, beat: 3, string: 3, fret: 2, finger: 3 },
        { id: 32, measure: 8, beat: 4, string: 1, fret: 0, finger: 0 }
      ],
      chords: []
    },
    hotel_california: {
      title: 'Hotel California (Completa)',
      section: 'Progresión Estrofa',
      bpm: 75,
      mode: 'chords',
      measures: 8,
      notes: [],
      chords: [
        { id: 1, measure: 1, beat: 1, chord: 'Am', duration: 4, durationBeats: 4, color: '#ea5b57' },
        { id: 2, measure: 2, beat: 1, chord: 'Em', duration: 4, durationBeats: 4, color: '#e67e22' },
        { id: 3, measure: 3, beat: 1, chord: 'G',  duration: 4, durationBeats: 4, color: '#27ae60' },
        { id: 4, measure: 4, beat: 1, chord: 'D',  duration: 4, durationBeats: 4, color: '#00d2ff' },
        { id: 5, measure: 5, beat: 1, chord: 'F',  duration: 4, durationBeats: 4, color: '#aa22e6' },
        { id: 6, measure: 6, beat: 1, chord: 'C',  duration: 4, durationBeats: 4, color: '#2ecc71' },
        { id: 7, measure: 7, beat: 1, chord: 'Dm', duration: 4, durationBeats: 4, color: '#e024c3' },
        { id: 8, measure: 8, beat: 1, chord: 'E',  duration: 4, durationBeats: 4, color: '#f39c12' }
      ]
    },
    basic_notes: {
      title: 'Canción básica',
      section: 'Canción',
      bpm: 85,
      mode: 'notes',
      measures: 8,
      notes: [
        { id: 1, measure: 1, beat: 3, string: 2, fret: 3, finger: 1 },
        { id: 2, measure: 2, beat: 3, string: 2, fret: 0, finger: 0 },
        { id: 3, measure: 3, beat: 3, string: 3, fret: 2, finger: 2 },
        { id: 4, measure: 4, beat: 3, string: 1, fret: 1, finger: 1 },
        { id: 5, measure: 5, beat: 3, string: 2, fret: 3, finger: 1 },
        { id: 6, measure: 6, beat: 3, string: 3, fret: 0, finger: 0 }
      ],
      chords: []
    },
    smoke_riff: {
      title: 'Smoke on the Water (Riff)',
      section: 'Intro Riff',
      bpm: 110,
      mode: 'notes',
      measures: 8,
      notes: [
        { id: 1, measure: 1, beat: 1, string: 4, fret: 0, finger: 0 },
        { id: 2, measure: 1, beat: 3, string: 4, fret: 3, finger: 1 },
        { id: 3, measure: 2, beat: 1, string: 4, fret: 5, finger: 3 },
        { id: 4, measure: 3, beat: 1, string: 4, fret: 0, finger: 0 },
        { id: 5, measure: 3, beat: 3, string: 4, fret: 3, finger: 1 },
        { id: 6, measure: 4, beat: 1, string: 4, fret: 6, finger: 4 },
        { id: 7, measure: 4, beat: 2, string: 4, fret: 5, finger: 3 },
        { id: 8, measure: 5, beat: 1, string: 4, fret: 0, finger: 0 },
        { id: 9, measure: 5, beat: 3, string: 4, fret: 3, finger: 1 },
        { id: 10, measure: 6, beat: 1, string: 4, fret: 5, finger: 3 },
        { id: 11, measure: 7, beat: 1, string: 4, fret: 3, finger: 1 },
        { id: 12, measure: 7, beat: 3, string: 4, fret: 0, finger: 0 }
      ],
      chords: []
    },
    chords_am_c: {
      title: 'Balada en Am',
      section: 'Parte 2',
      bpm: 80,
      mode: 'chords',
      measures: 8,
      notes: [],
      chords: [
        { id: 1, measure: 1, beat: 1, chord: 'Am', duration: 4, durationBeats: 4, color: '#ea5b57' },
        { id: 2, measure: 3, beat: 1, chord: 'Am', duration: 4, durationBeats: 4, color: '#aa22e6' },
        { id: 3, measure: 5, beat: 1, chord: 'C',  duration: 4, durationBeats: 4, color: '#27ae60' },
        { id: 4, measure: 7, beat: 1, chord: 'Em', duration: 4, durationBeats: 4, color: '#e67e22' }
      ]
    },
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

  private fillPresetSelect(): void {
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
      const saved = localStorage.getItem('guitar_custom_song') || localStorage.getItem('yousician_custom_song');
      if (saved) {
        const parsed = sanitizeSongProject(JSON.parse(saved));
        if (!parsed) throw new Error('invalid song');
        this.currentSong = parsed;
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
      localStorage.setItem('guitar_custom_song', JSON.stringify(this.currentSong));
      setEditorSongId(this.currentLibraryId);
      upsertLibrarySong(this.currentLibraryId, this.currentSong);
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  public loadPreset(presetKey: string): void {
    const key = presetKey === 'yousician_notes' ? 'basic_notes' : presetKey;
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
    const sectionInput = document.getElementById('editor-section-name') as HTMLInputElement | null;
    const bpmSlider = document.getElementById('editor-bpm-slider') as HTMLInputElement | null;
    const bpmVal = document.getElementById('editor-bpm-val');
    const modeBtns = document.querySelectorAll<HTMLElement>('.editor-mode-btn');

    if (titleInput) titleInput.value = this.currentSong.title;
    if (sectionInput) sectionInput.value = this.currentSong.section;
    if (bpmSlider) bpmSlider.value = this.currentSong.bpm.toString();
    if (bpmVal) bpmVal.textContent = this.currentSong.bpm.toString();

    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.currentSong.mode);
    });

    const chordLane = document.getElementById('editor-chord-lane');
    if (chordLane) {
      chordLane.classList.toggle('active', this.currentSong.mode === 'chords');
    }
  }

  private setupEventListeners(): void {
    const titleInput = document.getElementById('editor-song-title') as HTMLInputElement | null;
    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        this.currentSong.title = sanitizePlainText((e.target as HTMLInputElement).value, SONG_LIMITS.titleMax, 'Canción');
        this.saveToStorage();
      });
    }

    const sectionInput = document.getElementById('editor-section-name') as HTMLInputElement | null;
    if (sectionInput) {
      sectionInput.addEventListener('input', (e) => {
        this.currentSong.section = sanitizePlainText((e.target as HTMLInputElement).value, SONG_LIMITS.sectionMax, 'Canción');
        this.saveToStorage();
      });
    }

    const bpmSlider = document.getElementById('editor-bpm-slider') as HTMLInputElement | null;
    const bpmVal = document.getElementById('editor-bpm-val');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value);
        this.currentSong.bpm = val;
        if (bpmVal) bpmVal.textContent = val.toString();
        this.updateStats();
        this.saveToStorage();

        // If currently playing, restart with new BPM interval smoothly
        if (this.isSequencerPlaying) {
          const currentBeat = this.currentSequencerBeat;
          this.stopSequencerPlayback();
          this.startSequencerPlayback();
          this.currentSequencerBeat = currentBeat;
        }
      });
    }

    document.querySelectorAll<HTMLElement>('.editor-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as 'notes' | 'chords';
        this.currentSong.mode = mode;
        this.updateToolbarUI();
        this.renderGrid();
        this.saveToStorage();
      });
    });

    const presetSelect = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.loadPreset((e.target as HTMLSelectElement).value);
      });
    }

    const clearBtn = document.getElementById('editor-clear-all-btn');
    const clearModal = document.getElementById('editor-clear-confirm-modal');
    const hideClearModal = (): void => {
      if (clearModal) clearModal.style.display = 'none';
    };
    const showClearModal = (): void => {
      if (clearModal) clearModal.style.display = 'flex';
    };

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        showClearModal();
      });
    }
    document.getElementById('editor-clear-confirm-close')?.addEventListener('click', hideClearModal);
    document.getElementById('editor-clear-confirm-cancel')?.addEventListener('click', hideClearModal);
    document.getElementById('editor-clear-confirm-ok')?.addEventListener('click', () => {
      this.clearAllPlacedItems();
      hideClearModal();
    });
    if (clearModal) {
      clearModal.addEventListener('click', (e) => {
        if (e.target === clearModal) hideClearModal();
      });
    }

    const playGameBtn = document.getElementById('editor-play-game-btn');
    if (playGameBtn) {
      playGameBtn.addEventListener('click', () => {
        this.stopSequencerPlayback();
        this.playInGame();
      });
    }

    const playSeqBtn = document.getElementById('editor-play-seq-btn');
    if (playSeqBtn) {
      playSeqBtn.addEventListener('click', () => {
        if (this.isDualPlaybackPlaying) {
          this.stopDualPlayback();
        }
        this.toggleSequencerPlayback();
      });
    }

    const playBothBtn = document.getElementById('editor-play-both-btn');
    if (playBothBtn) {
      playBothBtn.addEventListener('click', () => {
        this.toggleDualPlayback();
      });
    }

    const exportBtn = document.getElementById('editor-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportSongJSON();
      });
    }

    const importBtn = document.getElementById('editor-import-btn');
    const fileInput = document.getElementById('editor-import-file') as HTMLInputElement | null;
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => {
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        this.importSongJSON(e);
      });
    }

    this.setupAudioExtractionEvents();
    this.setupAudioPlayerEvents();
    this.setupPopoverEvents();
  }

  private setupAudioExtractionEvents(): void {
    const extractBtn = document.getElementById('editor-audio-extract-btn');
    const fileInput = document.getElementById('editor-audio-extract-file') as HTMLInputElement | null;
    const modal = document.getElementById('audio-extract-modal');
    const closeBtn = document.getElementById('extract-modal-close-btn');
    const cancelBtn = document.getElementById('extract-btn-cancel');
    const dropzone = document.getElementById('extract-dropzone');
    const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;

    if (extractBtn && modal) {
      extractBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
      });
    }

    const closeModal = () => {
      extractionClient.cancel();
      this.extractionGeneration += 1;
      if (modal) modal.style.display = 'none';
      const progress = document.getElementById('extract-progress-wrap');
      if (progress) {
        progress.style.display = 'none';
        progress.classList.remove('is-error');
      }
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Dropzone & File Input events
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          this.handleSelectedAudioFile(files[0]);
        }
      });

      fileInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          this.handleSelectedAudioFile(files[0]);
        }
      });
    }

    // Process & Confirm button
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (this.pendingFileToExtract) {
          await this.processPendingAudioFile(this.pendingFileToExtract);
        }
      });
    }
  }

  private showEditorMessage(message: string): void {
    const hint = document.querySelector('.editor-hint span') || document.getElementById('extract-status-text');
    if (hint) hint.textContent = message;
  }

  private applySong(song: SongProject): void {
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

  private revokeReferenceObjectUrl(): void {
    if (this.referenceObjectUrl) {
      URL.revokeObjectURL(this.referenceObjectUrl);
      this.referenceObjectUrl = null;
    }
  }

  private handleSelectedAudioFile(file: File): void {
    if (!isAllowedMediaFile(file)) {
      this.pendingFileToExtract = null;
      this.showEditorMessage(
        file.size > SONG_LIMITS.audioMaxBytes
          ? 'El archivo supera el límite de 50 MB.'
          : 'Formato no permitido. Usá audio o video (mp3, wav, ogg, mp4…).'
      );
      const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    this.pendingFileToExtract = file;
    const mainText = document.getElementById('extract-drop-main-text');
    const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;

    if (mainText) {
      mainText.textContent = `Archivo seleccionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
      mainText.style.color = '#34d399';
    }

    if (confirmBtn) {
      confirmBtn.disabled = false;
    }
  }

  public async processPendingAudioFile(file: File): Promise<void> {
    if (!isAllowedMediaFile(file)) {
      this.showEditorMessage('Archivo de audio/video no permitido o demasiado grande.');
      return;
    }

    const progressWrap = document.getElementById('extract-progress-wrap');
    const progressFill = document.getElementById('extract-progress-fill');
    const statusText = document.getElementById('extract-status-text');

    if (progressWrap) {
      progressWrap.style.display = 'flex';
      progressWrap.classList.remove('is-error');
    }
      if (progressFill) progressFill.style.width = '8%';
    if (statusText) {
      statusText.classList.remove('is-error');
      statusText.textContent = `Leyendo ${file.name}…`;
    }

    const generation = ++this.extractionGeneration;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (generation !== this.extractionGeneration) return;

      if (progressFill) progressFill.style.width = '12%';
      if (statusText) statusText.textContent = 'Decodificando pista de audio…';

      const audioBuffer = await audioExtractor.decodeAudioFile(arrayBuffer);
      if (generation !== this.extractionGeneration) return;
      this.decodedAudioBuffer = audioBuffer;

      const sensitivitySelect = document.getElementById('extract-sensitivity') as HTMLSelectElement | null;
      const bpmSelect = document.getElementById('extract-bpm-mode') as HTMLSelectElement | null;

      const threshold = sensitivitySelect ? parseFloat(sensitivitySelect.value) : 1.8;
      let bpmParam: number | undefined = undefined;
      let autoBpm = true;

      if (bpmSelect && bpmSelect.value !== 'auto') {
        autoBpm = false;
        if (bpmSelect.value === 'custom') {
          bpmParam = this.currentSong.bpm;
        } else {
          bpmParam = parseInt(bpmSelect.value);
        }
      }

      if (statusText) statusText.textContent = 'Analizando en segundo plano…';
      const outcome = await extractionClient.extract(
        {
          channels: copyPcmChannels(audioBuffer),
          sampleRate: audioBuffer.sampleRate,
          duration: audioBuffer.duration
        },
        sanitizePlainText(file.name, SONG_LIMITS.titleMax, 'Canción detectada'),
        { threshold, bpm: bpmParam, autoBpm },
        (progress) => {
          if (generation !== this.extractionGeneration) return;
          if (progressFill) progressFill.style.width = `${Math.round(12 + progress.ratio * 86)}%`;
          if (statusText) statusText.textContent = progress.stage;
        }
      );
      if (generation !== this.extractionGeneration) return;

      const extractedProject = outcome.project;
      if (progressFill) progressFill.style.width = '100%';
      if (statusText) {
        const cut = outcome.truncated
          ? ` (se recortó a ${SONG_LIMITS.measuresMax} de ${outcome.rawMeasures} compases)`
          : '';
        statusText.textContent = `¡Completado! ${extractedProject.notes.length} notas volcadas en ${extractedProject.measures} compases.${cut}`;
      }

      const audioUrl = URL.createObjectURL(file);

      setTimeout(() => {
        if (generation !== this.extractionGeneration) return;
        this.applySong(extractedProject);
        this.setupReferenceAudioPlayer(audioUrl, file.name);
        const modal = document.getElementById('audio-extract-modal');
        if (modal) modal.style.display = 'none';
        if (progressWrap) progressWrap.style.display = 'none';
      }, 500);

    } catch (err) {
      console.error('Extraction error:', err);
      if (progressWrap) progressWrap.classList.add('is-error');
      if (statusText) {
        statusText.classList.add('is-error');
        statusText.textContent = 'No se pudo leer ese archivo. Probá otro MP3, WAV u OGG, o un MP4 con audio.';
      }
    }
  }

  private setupAudioPlayerEvents(): void {
    const playBtn = document.getElementById('audio-ref-play-btn');
    const seeker = document.getElementById('audio-ref-seeker') as HTMLInputElement | null;
    const volume = document.getElementById('audio-ref-volume') as HTMLInputElement | null;
    const removeBtn = document.getElementById('audio-ref-remove-btn');

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        this.toggleReferenceAudio();
      });
    }

    if (seeker) {
      seeker.addEventListener('input', () => {
        if (this.referenceAudio && this.referenceAudio.duration) {
          this.referenceAudio.currentTime = (parseFloat(seeker.value) / 100) * this.referenceAudio.duration;
        }
      });
    }

    if (volume) {
      volume.addEventListener('input', () => {
        if (this.referenceAudio) {
          this.referenceAudio.volume = parseFloat(volume.value);
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.removeReferenceAudio();
      });
    }

    const inspectorAddBtn = document.getElementById('inspector-add-btn');
    if (inspectorAddBtn) {
      inspectorAddBtn.addEventListener('click', () => {
        this.insertCurrentInspectedNote();
      });
    }
  }

  public setupReferenceAudioPlayer(audioSrc: string, title: string): void {
    if (this.referenceAudio) {
      this.referenceAudio.pause();
      this.referenceAudio = null;
    }
    this.revokeReferenceObjectUrl();
    if (audioSrc.startsWith('blob:')) {
      this.referenceObjectUrl = audioSrc;
    }

    const playerBar = document.getElementById('editor-audio-player-bar');
    const titleEl = document.getElementById('audio-ref-track-name');
    const timeEl = document.getElementById('audio-ref-track-time');
    const seeker = document.getElementById('audio-ref-seeker') as HTMLInputElement | null;
    const playIcon = document.getElementById('audio-ref-play-icon');

    if (playerBar) playerBar.style.display = 'flex';
    if (titleEl) titleEl.textContent = `Pista de referencia: ${sanitizePlainText(title, SONG_LIMITS.titleMax, 'Pista')}`;

    this.referenceAudio = new Audio(audioSrc);
    this.isReferenceAudioPlaying = false;

    if (playIcon) {
      this.setSvgIcon(playIcon, 'play');
    }

    this.referenceAudio.addEventListener('loadedmetadata', () => {
      const dur = this.formatAudioTime(this.referenceAudio?.duration || 0);
      if (timeEl) timeEl.textContent = `0:00 / ${dur}`;
    });

    this.referenceAudio.addEventListener('timeupdate', () => {
      if (!this.referenceAudio) return;
      const cur = this.referenceAudio.currentTime;
      const dur = this.referenceAudio.duration || 1;
      const progress = (cur / dur) * 100;
      if (seeker) seeker.value = progress.toString();
      if (timeEl) timeEl.textContent = `${this.formatAudioTime(cur)} / ${this.formatAudioTime(dur)}`;

      // Update Real-Time Tuner Note Inspector
      this.inspectAudioAtTime(cur);
    });

    this.referenceAudio.addEventListener('ended', () => {
      this.isReferenceAudioPlaying = false;
      if (playIcon) {
        this.setSvgIcon(playIcon, 'play');
      }
    });
  }

  /**
   * Real-time audio pitch inspector (Afinador de la pista en tiempo real)
   */
  public inspectAudioAtTime(currentTimeSeconds: number): void {
    if (!this.decodedAudioBuffer) return;

    const sampleRate = this.decodedAudioBuffer.sampleRate;
    const centerSample = Math.floor(currentTimeSeconds * sampleRate);
    const windowSize = 2048;

    if (centerSample + windowSize > this.decodedAudioBuffer.length) return;

    const channelData = this.decodedAudioBuffer.getChannelData(0);
    const slice = channelData.subarray(centerSample, centerSample + windowSize);

    const pitch = audioExtractor.detectPitchInSlice(slice, sampleRate);
    const noteReadout = document.getElementById('inspector-note-readout');
    const freqReadout = document.getElementById('inspector-freq-readout');
    const addBtn = document.getElementById('inspector-add-btn') as HTMLButtonElement | null;

    if (pitch && pitch.freq >= 75 && pitch.freq <= 750) {
      const tab = audioExtractor.mapFrequencyToGuitarFret(pitch.freq);
      if (tab) {
        const noteNames: Record<number, Record<number, string>> = {
          1: { 0: 'Mi4 (E4)', 1: 'Fa4 (F4)', 2: 'Fa#4', 3: 'Sol4 (G4)', 4: 'Sol#4', 5: 'La4 (A4)' },
          2: { 0: 'Si3 (B3)', 1: 'Do4 (C4)', 2: 'Do#4', 3: 'Re4 (D4)', 4: 'Re#4', 5: 'Mi4 (E4)' },
          3: { 0: 'Sol3 (G3)', 1: 'Sol#3', 2: 'La3 (A3)', 3: 'La#3', 4: 'Si3 (B3)', 5: 'Do4 (C4)' },
          4: { 0: 'Re3 (D3)', 1: 'Re#3', 2: 'Mi3 (E3)', 3: 'Fa3 (F3)', 4: 'Fa#3', 5: 'Sol3 (G3)' },
          5: { 0: 'La2 (A2)', 1: 'La#2', 2: 'Si2 (B2)', 3: 'Do3 (C3)', 4: 'Do#3', 5: 'Re3 (D3)' },
          6: { 0: 'Mi2 (E2)', 1: 'Fa2 (F2)', 2: 'Fa#2', 3: 'Sol2 (G2)', 4: 'Sol#2', 5: 'La2 (A2)' }
        };

        const noteName = noteNames[tab.string]?.[tab.fret] || `C${tab.string}:T${tab.fret}`;
        this.currentInspectedNote = {
          freq: Math.round(pitch.freq * 10) / 10,
          string: tab.string,
          fret: tab.fret,
          finger: tab.finger,
          name: noteName
        };

        if (noteReadout) {
          noteReadout.textContent = `${noteName} [C${tab.string} T${tab.fret}]`;
          noteReadout.style.color = '#2fe7b6';
        }
        if (freqReadout) {
          freqReadout.textContent = `${this.currentInspectedNote.freq} Hz`;
        }
        if (addBtn) {
          addBtn.disabled = false;
        }
        return;
      }
    }

    // Silence or non-tonal background
    if (noteReadout) {
      noteReadout.textContent = '-- (Silencio / Ruido)';
      noteReadout.style.color = '#64748b';
    }
    if (freqReadout) {
      freqReadout.textContent = '-- Hz';
    }
    if (addBtn) {
      addBtn.disabled = true;
    }
  }

  /**
   * Insert currently inspected note directly into the closest measure and beat
   */
  public insertCurrentInspectedNote(): void {
    if (!this.currentInspectedNote || !this.referenceAudio) return;

    const currentTime = this.referenceAudio.currentTime;
    const beatDuration = 60 / this.currentSong.bpm;
    const stepDuration = beatDuration / STEPS_PER_BEAT;
    const totalStepIndex = Math.round(currentTime / stepDuration);
    const measure = Math.floor(totalStepIndex / STEPS_PER_MEASURE) + 1;
    const step = (totalStepIndex % STEPS_PER_MEASURE) + 1;
    const beat = beatFromStep(step);

    this.currentSong.notes = this.currentSong.notes.filter(
      n => !(n.measure === measure && noteStep(n) === step && n.string === this.currentInspectedNote!.string)
    );

    const newNote: EditorNote = {
      id: Date.now(),
      measure,
      beat,
      step,
      duration: this.selectedNoteDuration,
      string: this.currentInspectedNote.string,
      fret: this.currentInspectedNote.fret,
      finger: this.currentInspectedNote.finger
    };

    this.currentSong.notes.push(newNote);
    this.currentSong.notes.sort((a, b) => {
      if (a.measure !== b.measure) return a.measure - b.measure;
      return noteStep(a) - noteStep(b);
    });

    // Sound preview
    guitarAudio.playString(newNote.string, newNote.fret);

    this.renderGrid();
    this.updateStats();
    this.saveToStorage();

    // Visual feedback on add button
    const addBtn = document.getElementById('inspector-add-btn');
    if (addBtn) {
      const origText = addBtn.textContent;
      addBtn.textContent = '✓ ¡Insertada!';
      setTimeout(() => {
        if (addBtn) addBtn.textContent = origText;
      }, 1000);
    }
  }

  public toggleReferenceAudio(): void {
    if (!this.referenceAudio) return;
    const playIcon = document.getElementById('audio-ref-play-icon');

    if (this.isReferenceAudioPlaying) {
      this.referenceAudio.pause();
      this.isReferenceAudioPlaying = false;
      if (playIcon) {
        this.setSvgIcon(playIcon, 'play');
      }
    } else {
      this.referenceAudio.play().then(() => {
        this.isReferenceAudioPlaying = true;
        if (playIcon) {
          this.setSvgIcon(playIcon, 'pause');
        }
      }).catch(err => console.warn('Audio playback prevented:', err));
    }
  }

  public removeReferenceAudio(): void {
    if (this.referenceAudio) {
      this.referenceAudio.pause();
      this.referenceAudio.src = '';
      this.referenceAudio = null;
    }
    this.revokeReferenceObjectUrl();
    this.isReferenceAudioPlaying = false;
    const playerBar = document.getElementById('editor-audio-player-bar');
    if (playerBar) playerBar.style.display = 'none';
  }

  private formatAudioTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // =========================================================================
  // IN-EDITOR SEQUENCER PLAYBACK ENGINE
  // =========================================================================
  public toggleSequencerPlayback(): void {
    if (this.isSequencerPlaying) {
      this.stopSequencerPlayback();
    } else {
      this.startSequencerPlayback();
    }
  }

  public startSequencerPlayback(): void {
    guitarAudio.init();
    this.stopSequencerPlayback();

    const playhead = this.ensurePlayhead();

    this.isSequencerPlaying = true;
    this.currentSequencerBeat = 0;
    this.setPlaybackButtonState(true);
    if (playhead) {
      playhead.style.display = 'block';
    }

    const stepIntervalMs = ((60 / this.currentSong.bpm) * 1000) / STEPS_PER_BEAT;
    const totalSteps = this.playbackStepCount();
    if (totalSteps <= 0) {
      this.stopSequencerPlayback();
      return;
    }

    this.playSequencerStep();

    this.sequencerPlayInterval = window.setInterval(() => {
      this.currentSequencerBeat++;
      if (this.currentSequencerBeat >= totalSteps) {
        this.stopSequencerPlayback();
        return;
      }
      this.playSequencerStep();
    }, stepIntervalMs);
  }

  public playSequencerStep(): void {
    const totalSteps = this.currentSong.measures * STEPS_PER_MEASURE;
    if (this.currentSequencerBeat >= totalSteps) return;

    const measure = Math.floor(this.currentSequencerBeat / STEPS_PER_MEASURE) + 1;
    const step = (this.currentSequencerBeat % STEPS_PER_MEASURE) + 1;
    const beatInMeasure = beatFromStep(step);
    const playheadLeft = this.currentSequencerBeat * STEP_CELL_PX + (STEP_CELL_PX / 2);

    const playhead = this.ensurePlayhead();
    if (playhead) {
      playhead.style.display = 'block';
      playhead.style.left = `${playheadLeft}px`;
    }

    // 2. Highlight active column
    document.querySelectorAll('.matrix-beat-cell').forEach(cell => {
      cell.classList.remove('playhead-active');
    });

    const activeCells = document.querySelectorAll(
      `.matrix-beat-cell[data-measure="${measure}"][data-step="${step}"]`
    );
    activeCells.forEach(c => c.classList.add('playhead-active'));

    // 3. Auto-scroll grid if playhead goes beyond visible scroll viewport
    const scrollContainer = document.querySelector('.editor-grid-scroll-area');
    if (scrollContainer) {
      const scrollLeft = scrollContainer.scrollLeft;
      const viewportWidth = scrollContainer.clientWidth - 100; // excluding strings legend
      if (playheadLeft > scrollLeft + viewportWidth - 80 || playheadLeft < scrollLeft) {
        scrollContainer.scrollTo({
          left: Math.max(0, playheadLeft - 150),
          behavior: 'smooth'
        });
      }
    }

    // 4. Play notes scheduled on this measure and beat
    if (this.currentSong.mode === 'notes') {
      const currentNotes = this.currentSong.notes.filter(
        n => n.measure === measure && noteStep(n) === step
      );

      currentNotes.forEach(n => {
        // Sound synthesis
        guitarAudio.playString(n.string, n.fret, 2.0, 0.85);

        // Visual flash animation on corresponding chip
        const cell = document.querySelector(
          `.matrix-beat-cell[data-string="${n.string}"][data-measure="${measure}"][data-step="${step}"]`
        );
        const chip = cell?.querySelector('.grid-note-chip');
        if (chip) {
          chip.classList.add('chip-playing');
          setTimeout(() => chip.classList.remove('chip-playing'), 220);
        }
      });
    } else {
      // Chord mode
      const currentChords = this.currentSong.chords.filter(
        c => c.measure === measure && c.beat === beatInMeasure
      );

      currentChords.forEach(c => {
        guitarAudio.playChord(c.chord);
      });
    }
  }

  public stopSequencerPlayback(): void {
    if (this.sequencerPlayInterval !== null) {
      clearInterval(this.sequencerPlayInterval);
      this.sequencerPlayInterval = null;
    }
    this.isSequencerPlaying = false;
    this.setPlaybackButtonState(false);
    const playhead = document.getElementById('editor-playhead-line');
    if (playhead) {
      playhead.style.display = 'none';
    }

    document.querySelectorAll('.matrix-beat-cell').forEach(cell => {
      cell.classList.remove('playhead-active');
    });
  }

  // =========================================================================
  // DUAL SIMULTANEOUS PLAYBACK (AUDIO DE REFERENCIA + NOTAS DE GUITARRA)
  // =========================================================================
  public toggleDualPlayback(): void {
    if (this.isDualPlaybackPlaying) {
      this.stopDualPlayback();
    } else {
      this.startDualPlayback();
    }
  }

  public async startDualPlayback(): Promise<void> {
    if (!this.referenceAudio) {
      alert('Por favor carga primero una pista de video/audio con el botón "Cargar Video / Audio" para poder contrastar.');
      return;
    }

    guitarAudio.init();

    // Stop any standalone playbacks
    this.stopSequencerPlayback();
    if (this.isReferenceAudioPlaying) {
      this.toggleReferenceAudio();
    }

    this.isDualPlaybackPlaying = true;
    this.currentSequencerBeat = 0;

    const bothBtn = document.getElementById('editor-play-both-btn');
    const bothBtnText = document.getElementById('editor-play-both-text');
    const bothBtnIcon = document.getElementById('editor-play-both-icon');
    const playhead = this.ensurePlayhead();
    const syncBadge = document.getElementById('audio-sync-badge');

    if (bothBtn) bothBtn.classList.add('active');
    if (bothBtnText) bothBtnText.textContent = 'Pausar';
    this.setSvgIcon(bothBtnIcon, 'pause-filled');
    if (playhead) {
      playhead.style.display = 'block';
    }
    if (syncBadge) {
      syncBadge.style.display = 'inline-block';
    }

    // Reset reference audio to start (or synchronized offset)
    this.referenceAudio.currentTime = 0;

    try {
      await this.referenceAudio.play();
      this.isReferenceAudioPlaying = true;
      const refPlayIcon = document.getElementById('audio-ref-play-icon');
      if (refPlayIcon) {
        this.setSvgIcon(refPlayIcon, 'pause');
      }
    } catch (e) {
      console.warn('Reference audio playback error:', e);
    }

    const stepIntervalMs = ((60 / this.currentSong.bpm) * 1000) / STEPS_PER_BEAT;
    const totalSteps = this.playbackStepCount();
    if (totalSteps <= 0) {
      this.stopDualPlayback();
      return;
    }

    this.playSequencerStep();

    this.sequencerPlayInterval = window.setInterval(() => {
      this.currentSequencerBeat++;
      if (this.currentSequencerBeat >= totalSteps) {
        this.stopDualPlayback();
        return;
      }
      this.playSequencerStep();
    }, stepIntervalMs);
  }

  public stopDualPlayback(): void {
    if (this.sequencerPlayInterval !== null) {
      clearInterval(this.sequencerPlayInterval);
      this.sequencerPlayInterval = null;
    }
    this.isDualPlaybackPlaying = false;

    if (this.referenceAudio) {
      this.referenceAudio.pause();
      this.isReferenceAudioPlaying = false;
      const refPlayIcon = document.getElementById('audio-ref-play-icon');
      if (refPlayIcon) {
        this.setSvgIcon(refPlayIcon, 'play');
      }
    }

    const bothBtn = document.getElementById('editor-play-both-btn');
    const bothBtnText = document.getElementById('editor-play-both-text');
    const bothBtnIcon = document.getElementById('editor-play-both-icon');
    const playhead = document.getElementById('editor-playhead-line');
    const syncBadge = document.getElementById('audio-sync-badge');

    if (bothBtn) bothBtn.classList.remove('active');
    if (bothBtnText) bothBtnText.textContent = 'Ambas';
    this.setSvgIcon(bothBtnIcon, 'play');
    if (playhead) {
      playhead.style.display = 'none';
    }
    if (syncBadge) {
      syncBadge.style.display = 'none';
    }

    document.querySelectorAll('.matrix-beat-cell').forEach(cell => {
      cell.classList.remove('playhead-active');
    });
  }

  private setupPopoverEvents(): void {
    const closeBtn = document.getElementById('selector-close-btn');
    const modal = document.getElementById('note-selector-modal');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('visible');
      });
    }

    document.querySelectorAll<HTMLElement>('.fret-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fret-select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedFret = parseInt(btn.dataset.fret || '0');
        if (this.selectedCell) {
          guitarAudio.playString(this.selectedCell.string, this.selectedFret);
        }
      });
    });

    document.querySelectorAll<HTMLElement>('.finger-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.finger-select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedFinger = parseInt(btn.dataset.finger || '0');
      });
    });

    document.querySelectorAll<HTMLElement>('.duration-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedNoteDuration = parseInt(btn.dataset.duration || '1');
      });
    });

    const applyBtn = document.getElementById('selector-apply-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        this.applySelectedNote();
      });
    }

    const deleteBtn = document.getElementById('selector-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        this.deleteSelectedNote();
      });
    }
  }

  public renderHeaderMeasures(): void {
    const row = document.getElementById('timeline-measures-row');
    if (!row) return;

    row.replaceChildren();
    for (let m = 1; m <= this.currentSong.measures; m++) {
      const badge = document.createElement('div');
      badge.className = 'timeline-measure-badge';
      badge.textContent = `Compás ${m}`;
      row.appendChild(badge);
    }
  }

  public renderGrid(): void {
    const matrix = document.getElementById('editor-matrix-grid');
    if (!matrix) return;

    matrix.replaceChildren();

    for (let stringNum = 1; stringNum <= 6; stringNum++) {
      const row = document.createElement('div');
      row.className = 'matrix-string-row';
      row.dataset.string = stringNum.toString();

      const totalSteps = this.currentSong.measures * STEPS_PER_MEASURE;
      for (let s = 1; s <= totalSteps; s++) {
        const measure = Math.floor((s - 1) / STEPS_PER_MEASURE) + 1;
        const step = ((s - 1) % STEPS_PER_MEASURE) + 1;
        const beatInMeasure = beatFromStep(step);

        const cell = document.createElement('div');
        cell.className = 'matrix-beat-cell';
        if (step === 1) cell.classList.add('measure-start');
        if (step % STEPS_PER_BEAT === 1) cell.classList.add('beat-start');
        cell.dataset.string = stringNum.toString();
        cell.dataset.measure = measure.toString();
        cell.dataset.beat = beatInMeasure.toString();
        cell.dataset.step = step.toString();
        cell.title = `Cuerda ${stringNum} · Compás ${measure} · pulso ${beatInMeasure}.${((step - 1) % 4) + 1}`;

        const existingNote = this.currentSong.notes.find(
          n => n.string === stringNum && n.measure === measure && noteStep(n) === step
        );

        if (existingNote) {
          const chip = document.createElement('div');
          chip.className = fingerChipClass(existingNote.finger);
          chip.textContent = existingNote.fret.toString();
          chip.title = `Traste ${existingNote.fret} · ${noteDurationSteps(existingNote)}/16`;
          chip.style.width = `${Math.max(STEP_CELL_PX - 4, noteDurationSteps(existingNote) * STEP_CELL_PX - 4)}px`;
          chip.style.zIndex = '2';
          cell.appendChild(chip);
        }

        cell.addEventListener('click', (e) => {
          this.handleCellClick(cell, stringNum, measure, beatInMeasure, step, e);
        });

        row.appendChild(cell);
      }

      matrix.appendChild(row);
    }

    this.ensurePlayhead();
    this.renderChordBlocks();
  }

  public renderChordBlocks(): void {
    const track = document.getElementById('chord-lane-track');
    if (!track) return;

    track.replaceChildren();
    const beatWidth = STEP_CELL_PX * STEPS_PER_BEAT;

    this.currentSong.chords.forEach(chord => {
      const startBeatTotal = (chord.measure - 1) * 4 + (chord.beat - 1);
      const leftPx = startBeatTotal * beatWidth;
      const durationBeats = (chord as unknown as { durationBeats?: number }).durationBeats || chord.duration || 4;
      const widthPx = durationBeats * beatWidth;

      const block = document.createElement('div');
      block.className = 'grid-chord-block';
      block.style.left = `${leftPx}px`;
      block.style.width = `${widthPx - 6}px`;
      block.style.background = sanitizeCssColor(chord.color);
      block.textContent = chord.chord;
      block.title = `Acorde ${chord.chord} (Compás ${chord.measure})`;

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        guitarAudio.playChord(chord.chord);
      });

      track.appendChild(block);
    });
  }

  public handleCellClick(cell: HTMLElement, stringNum: number, measure: number, beat: number, step: number, _event: MouseEvent): void {
    this.selectedCell = { string: stringNum, measure, beat, step, cellElement: cell };

    const existingNote = this.currentSong.notes.find(
      n => n.string === stringNum && n.measure === measure && noteStep(n) === step
    );

    if (this.currentSong.mode === 'chords') {
      this.promptAddChord(measure, beat);
      return;
    }

    const modal = document.getElementById('note-selector-modal');
    if (!modal) return;

    const rect = cell.getBoundingClientRect();
    modal.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 10)}px`;
    modal.style.left = `${Math.min(window.innerWidth - 340, Math.max(20, rect.left - 100))}px`;

    if (existingNote) {
      this.selectedFret = existingNote.fret;
      this.selectedFinger = existingNote.finger;
      this.selectedNoteDuration = noteDurationSteps(existingNote);
    } else {
      this.selectedFret = 3;
      this.selectedFinger = 1;
    }

    document.querySelectorAll<HTMLElement>('.fret-select-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.fret || '0') === this.selectedFret);
    });

    document.querySelectorAll<HTMLElement>('.finger-select-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.finger || '0') === this.selectedFinger);
    });

    document.querySelectorAll<HTMLElement>('.duration-select-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.duration || '0') === this.selectedNoteDuration);
    });

    modal.classList.add('visible');
  }

  public applySelectedNote(): void {
    if (!this.selectedCell) return;
    const { string, measure, beat, step } = this.selectedCell;

    this.currentSong.notes = this.currentSong.notes.filter(
      n => !(n.string === string && n.measure === measure && noteStep(n) === step)
    );

    const newNote: EditorNote = {
      id: Date.now(),
      measure,
      beat,
      step,
      duration: this.selectedNoteDuration,
      string,
      fret: this.selectedFret,
      finger: this.selectedFinger
    };
    this.currentSong.notes.push(newNote);

    guitarAudio.playString(string, this.selectedFret);

    const modal = document.getElementById('note-selector-modal');
    if (modal) modal.classList.remove('visible');

    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  public deleteSelectedNote(): void {
    if (!this.selectedCell) return;
    const { string, measure, step } = this.selectedCell;

    this.currentSong.notes = this.currentSong.notes.filter(
      n => !(n.string === string && n.measure === measure && noteStep(n) === step)
    );

    const modal = document.getElementById('note-selector-modal');
    if (modal) modal.classList.remove('visible');

    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  public promptAddChord(measure: number, beat: number): void {
    const chordOptions = ['Am', 'C', 'G', 'D', 'Em', 'E', 'F', 'Dm'];
    const chosen = prompt(`Elige el acorde a colocar en Compás ${measure}, Beat ${beat}:\n(${chordOptions.join(', ')})`, 'Am');
    if (!chosen) return;

    const chordClean = chosen.trim();
    const colors: Record<string, string> = {
      'Am': '#ea5b57',
      'C': '#27ae60',
      'G': '#f39c12',
      'D': '#3498db',
      'Em': '#aa22e6',
      'E': '#e67e22',
      'F': '#e74c3c',
      'Dm': '#9b59b6'
    };

    this.currentSong.chords.push({
      id: Date.now(),
      measure,
      beat,
      chord: chordClean,
      duration: 4,
      color: colors[chordClean] || '#ea5b57'
    });

    guitarAudio.playChord(chordClean);

    this.renderChordBlocks();
    this.updateStats();
    this.saveToStorage();
  }

  public clearAllPlacedItems(): void {
    this.currentSong.notes = [];
    this.currentSong.chords = [];
    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  public updateStats(): void {
    const notesCount = document.getElementById('editor-notes-count');
    const chordsCount = document.getElementById('editor-chords-count');
    const durationCount = document.getElementById('editor-duration-count');

    if (notesCount) notesCount.textContent = this.currentSong.notes.length.toString();
    if (chordsCount) chordsCount.textContent = this.currentSong.chords.length.toString();

    const lastStep = lastContentStepIndex(this.currentSong);
    const steps = lastStep < 0 ? 0 : lastStep + 1;
    const totalSeconds = (steps * (60 / this.currentSong.bpm)) / STEPS_PER_BEAT;
    if (durationCount) durationCount.textContent = `${totalSeconds.toFixed(1)}s`;
  }

  public playInGame(): void {
    this.stopSequencerPlayback();
    if (this.isDualPlaybackPlaying) {
      this.stopDualPlayback();
    }
    if (this.referenceAudio && this.isReferenceAudioPlaying) {
      this.toggleReferenceAudio();
    }

    this.saveToStorage();
    queueGameplaySong(this.currentSong);

    const targetScreen = this.currentSong.mode === 'chords' ? 'chords' : 'notes';
    goToScreen(targetScreen);
    gameplayEngine.loadCustomSong(this.currentSong);
    requestAnimationFrame(() => {
      if (gameplayEngine.mode === 'notes') gameplayEngine.buildDOMNotes();
      else gameplayEngine.buildDOMChords();
      gameplayEngine.renderFrame();
    });
  }

  public exportSongJSON(): void {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.currentSong, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${sanitizeDownloadName(this.currentSong.title)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  public importSongJSON(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    if (!isAllowedJsonFile(file)) {
      this.showEditorMessage('JSON inválido o demasiado grande (máx. 512 KB).');
      target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = sanitizeSongProject(JSON.parse(content));
        if (!imported) {
          this.showEditorMessage('El JSON no tiene una canción válida.');
          return;
        }
        this.applySong(imported);
        this.showEditorMessage(`Canción «${imported.title}» importada.`);
      } catch {
        this.showEditorMessage('No se pudo leer el archivo JSON.');
      } finally {
        target.value = '';
      }
    };
    reader.readAsText(file);
  }
}

export const songEditor = new SongEditor();
