/**
 * Yousician Song Editor Engine
 * Interactive sequencer for composing custom guitar melodies and chord tracks
 */
class SongEditor {
  constructor() {
    this.currentSong = {
      title: 'Mi Canción',
      section: 'Canción',
      bpm: 85,
      mode: 'notes', // 'notes' or 'chords'
      measures: 8,
      notes: [],
      chords: []
    };

    this.selectedCell = null; // { string, measure, beat }
    this.selectedFret = 3;
    this.selectedFinger = 1;
    this.selectedChord = 'Am';
    this.selectedChordColor = '#ea5b57';
    this.selectedDuration = 4;

    this.presets = {
      coco_recuerdame: {
        title: 'Recuérdame (Coco)',
        section: 'Tema Principal',
        bpm: 88,
        mode: 'notes',
        measures: 8,
        notes: [
          // Compás 1: (Silencio) | Cuerda 2 traste 3 | Cuerda 1 traste 0 | Cuerda 2 traste 1
          { id: 1, measure: 1, beat: 2, string: 2, fret: 3, finger: 2 },
          { id: 2, measure: 1, beat: 3, string: 1, fret: 0, finger: 0 },
          { id: 3, measure: 1, beat: 4, string: 2, fret: 1, finger: 1 },

          // Compás 2: Cuerda 3 traste 0 | Cuerda 3 traste 0 | Cuerda 4 traste 3
          { id: 4, measure: 2, beat: 1, string: 3, fret: 0, finger: 0 },
          { id: 5, measure: 2, beat: 3, string: 3, fret: 0, finger: 0 },
          { id: 6, measure: 2, beat: 4, string: 4, fret: 3, finger: 2 },

          // Compás 3: Cuerda 5 traste 3 | Cuerda 2 traste 1 (x2) | Cuerda 2 traste 3 (x2)
          { id: 7, measure: 3, beat: 1, string: 5, fret: 3, finger: 3 },
          { id: 8, measure: 3, beat: 2, string: 2, fret: 1, finger: 1 },
          { id: 9, measure: 3, beat: 3, string: 2, fret: 1, finger: 1 },
          { id: 10, measure: 3, beat: 4, string: 2, fret: 3, finger: 2 },

          // Compás 4: Cuerda 1 traste 0 (x2) | Cuerda 2 traste 3 | Cuerda 3 traste 0
          { id: 11, measure: 4, beat: 1, string: 2, fret: 3, finger: 2 },
          { id: 12, measure: 4, beat: 2, string: 1, fret: 0, finger: 0 },
          { id: 13, measure: 4, beat: 3, string: 1, fret: 0, finger: 0 },
          { id: 14, measure: 4, beat: 4, string: 2, fret: 3, finger: 2 },

          // Compás 5: Cuerda 3 traste 0 | Cuerda 1 traste 0 | Cuerda 2 traste 3 | Cuerda 2 traste 1
          { id: 15, measure: 5, beat: 1, string: 3, fret: 0, finger: 0 },
          { id: 16, measure: 5, beat: 2, string: 1, fret: 0, finger: 0 },
          { id: 17, measure: 5, beat: 3, string: 2, fret: 3, finger: 2 },
          { id: 18, measure: 5, beat: 4, string: 2, fret: 1, finger: 1 },

          // Compás 6: Cuerda 3 traste 0 | Cuerda 3 traste 2 | Cuerda 4 traste 3
          { id: 19, measure: 6, beat: 1, string: 3, fret: 0, finger: 0 },
          { id: 20, measure: 6, beat: 2, string: 3, fret: 2, finger: 2 },
          { id: 21, measure: 6, beat: 3, string: 4, fret: 3, finger: 3 },
          { id: 22, measure: 6, beat: 4, string: 4, fret: 0, finger: 0 },

          // Compás 7: Cuerda 2 traste 1 | Cuerda 2 traste 3 | Cuerda 1 traste 0 | Cuerda 1 traste 1
          { id: 23, measure: 7, beat: 1, string: 2, fret: 1, finger: 1 },
          { id: 24, measure: 7, beat: 2, string: 2, fret: 3, finger: 2 },
          { id: 25, measure: 7, beat: 3, string: 1, fret: 0, finger: 0 },
          { id: 26, measure: 7, beat: 4, string: 1, fret: 1, finger: 1 },

          // Compás 8: Cuerda 1 traste 3 | Cuerda 1 traste 0 | Cuerda 2 traste 1 (Cierre C)
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
          // Compás 1: Arpegio inicial al aire
          { id: 1, measure: 1, beat: 1, string: 6, fret: 0, finger: 0 },
          { id: 2, measure: 1, beat: 2, string: 3, fret: 0, finger: 0 },
          { id: 3, measure: 1, beat: 3, string: 2, fret: 0, finger: 0 },
          { id: 4, measure: 1, beat: 4, string: 1, fret: 0, finger: 0 },
          // Compás 2: Repetición y fraseo
          { id: 5, measure: 2, beat: 1, string: 2, fret: 0, finger: 0 },
          { id: 6, measure: 2, beat: 2, string: 3, fret: 0, finger: 0 },
          { id: 7, measure: 2, beat: 3, string: 1, fret: 7, finger: 3 },
          { id: 8, measure: 2, beat: 4, string: 2, fret: 0, finger: 0 },
          // Compás 3: Descenso melódico
          { id: 9, measure: 3, beat: 1, string: 1, fret: 7, finger: 3 },
          { id: 10, measure: 3, beat: 2, string: 1, fret: 0, finger: 0 },
          { id: 11, measure: 3, beat: 3, string: 2, fret: 0, finger: 0 },
          { id: 12, measure: 3, beat: 4, string: 3, fret: 0, finger: 0 },
          // Compás 4: Ligado al traste 7 y 0
          { id: 13, measure: 4, beat: 1, string: 1, fret: 7, finger: 3 },
          { id: 14, measure: 4, beat: 2, string: 1, fret: 8, finger: 4 },
          { id: 15, measure: 4, beat: 3, string: 1, fret: 7, finger: 3 },
          { id: 16, measure: 4, beat: 4, string: 1, fret: 0, finger: 0 },
          // Compás 5: Traste 5 y 3
          { id: 17, measure: 5, beat: 1, string: 1, fret: 5, finger: 2 },
          { id: 18, measure: 5, beat: 2, string: 1, fret: 3, finger: 1 },
          { id: 19, measure: 5, beat: 3, string: 1, fret: 2, finger: 1 },
          { id: 20, measure: 5, beat: 4, string: 1, fret: 0, finger: 0 },
          // Compás 6: Cuerda 2 Traste 3
          { id: 21, measure: 6, beat: 1, string: 2, fret: 3, finger: 2 },
          { id: 22, measure: 6, beat: 2, string: 2, fret: 0, finger: 0 },
          { id: 23, measure: 6, beat: 3, string: 3, fret: 0, finger: 0 },
          { id: 24, measure: 6, beat: 4, string: 4, fret: 2, finger: 1 },
          // Compás 7: Armónicos y cierre
          { id: 25, measure: 7, beat: 1, string: 6, fret: 0, finger: 0 },
          { id: 26, measure: 7, beat: 2, string: 3, fret: 0, finger: 0 },
          { id: 27, measure: 7, beat: 3, string: 2, fret: 0, finger: 0 },
          { id: 28, measure: 7, beat: 4, string: 1, fret: 0, finger: 0 },
          // Compás 8: Acorde final punteado
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
          { id: 1, measure: 1, beat: 1, chord: 'Am', durationBeats: 4, color: '#ea5b57' },
          { id: 2, measure: 2, beat: 1, chord: 'Em', durationBeats: 4, color: '#e67e22' },
          { id: 3, measure: 3, beat: 1, chord: 'G',  durationBeats: 4, color: '#27ae60' },
          { id: 4, measure: 4, beat: 1, chord: 'D',  durationBeats: 4, color: '#00d2ff' },
          { id: 5, measure: 5, beat: 1, chord: 'F',  durationBeats: 4, color: '#aa22e6' },
          { id: 6, measure: 6, beat: 1, chord: 'C',  durationBeats: 4, color: '#2ecc71' },
          { id: 7, measure: 7, beat: 1, chord: 'Dm', durationBeats: 4, color: '#e024c3' },
          { id: 8, measure: 8, beat: 1, chord: 'E',  durationBeats: 4, color: '#f39c12' }
        ]
      },
      yousician_notes: {
        title: 'Canción Yousician',
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
          { id: 1, measure: 1, beat: 1, chord: 'Am', durationBeats: 4, color: '#ea5b57' },
          { id: 2, measure: 3, beat: 1, chord: 'Am', durationBeats: 4, color: '#aa22e6' },
          { id: 3, measure: 5, beat: 1, chord: 'C',  durationBeats: 4, color: '#27ae60' },
          { id: 4, measure: 7, beat: 1, chord: 'Em', durationBeats: 4, color: '#e67e22' }
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
  }

  init() {
    this.loadFromStorage();
    this.setupEventListeners();
    this.renderHeaderMeasures();
    this.renderGrid();
    this.updateStats();
  }

  loadFromStorage() {
    try {
      const saved = localStorage.getItem('yousician_custom_song');
      if (saved) {
        this.currentSong = JSON.parse(saved);
        this.updateToolbarUI();
      } else {
        this.loadPreset('coco_recuerdame');
      }
    } catch (e) {
      this.loadPreset('coco_recuerdame');
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem('yousician_custom_song', JSON.stringify(this.currentSong));
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  loadPreset(presetKey) {
    const p = this.presets[presetKey];
    if (!p) return;
    this.currentSong = JSON.parse(JSON.stringify(p));
    this.updateToolbarUI();
    this.renderGrid();
    this.updateStats();
  }

  updateToolbarUI() {
    const titleInput = document.getElementById('editor-song-title');
    const sectionInput = document.getElementById('editor-section-name');
    const bpmSlider = document.getElementById('editor-bpm-slider');
    const bpmVal = document.getElementById('editor-bpm-val');
    const modeBtns = document.querySelectorAll('.editor-mode-btn');

    if (titleInput) titleInput.value = this.currentSong.title;
    if (sectionInput) sectionInput.value = this.currentSong.section;
    if (bpmSlider) bpmSlider.value = this.currentSong.bpm;
    if (bpmVal) bpmVal.textContent = this.currentSong.bpm;

    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.currentSong.mode);
    });

    const chordLane = document.getElementById('editor-chord-lane');
    if (chordLane) {
      chordLane.classList.toggle('active', this.currentSong.mode === 'chords');
    }
  }

  setupEventListeners() {
    // Song title & section
    const titleInput = document.getElementById('editor-song-title');
    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        this.currentSong.title = e.target.value;
        this.saveToStorage();
      });
    }

    const sectionInput = document.getElementById('editor-section-name');
    if (sectionInput) {
      sectionInput.addEventListener('input', (e) => {
        this.currentSong.section = e.target.value;
        this.saveToStorage();
      });
    }

    // BPM Slider
    const bpmSlider = document.getElementById('editor-bpm-slider');
    const bpmVal = document.getElementById('editor-bpm-val');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        this.currentSong.bpm = val;
        if (bpmVal) bpmVal.textContent = val;
        this.saveToStorage();
      });
    }

    // Mode Toggle (Notas / Acordes)
    document.querySelectorAll('.editor-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.currentSong.mode = mode;
        this.updateToolbarUI();
        this.renderGrid();
        this.saveToStorage();
      });
    });

    // Presets Dropdown
    const presetSelect = document.getElementById('editor-preset-select');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.loadPreset(e.target.value);
      });
    }

    // Play in Game Button
    const playGameBtn = document.getElementById('editor-play-game-btn');
    if (playGameBtn) {
      playGameBtn.addEventListener('click', () => {
        this.playInGame();
      });
    }

    // Export / Import
    const exportBtn = document.getElementById('editor-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportSongJSON();
      });
    }

    const importBtn = document.getElementById('editor-import-btn');
    const fileInput = document.getElementById('editor-import-file');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => {
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        this.importSongJSON(e);
      });
    }

    // Note Popover handlers
    this.setupPopoverEvents();
  }

  setupPopoverEvents() {
    // Close popover
    const closeBtn = document.getElementById('selector-close-btn');
    const modal = document.getElementById('note-selector-modal');
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('visible');
      });
    }

    // Fret select buttons (0 to 12)
    document.querySelectorAll('.fret-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fret-select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedFret = parseInt(btn.dataset.fret);
        // Play note preview
        if (this.selectedCell && window.guitarAudio) {
          window.guitarAudio.playString(this.selectedCell.string, this.selectedFret);
        }
      });
    });

    // Finger buttons (0 to 4)
    document.querySelectorAll('.finger-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.finger-select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedFinger = parseInt(btn.dataset.finger);
      });
    });

    // Apply Note
    const applyBtn = document.getElementById('selector-apply-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        this.applySelectedNote();
      });
    }

    // Delete Note
    const deleteBtn = document.getElementById('selector-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        this.deleteSelectedNote();
      });
    }
  }

  renderHeaderMeasures() {
    const row = document.getElementById('timeline-measures-row');
    if (!row) return;

    GuitarDOM.clearChildren(row);
    for (let m = 1; m <= this.currentSong.measures; m++) {
      const badge = document.createElement('div');
      badge.className = 'timeline-measure-badge';
      badge.textContent = `Compás ${m}`;
      row.appendChild(badge);
    }
  }

  renderGrid() {
    const matrix = document.getElementById('editor-matrix-grid');
    if (!matrix) return;

    GuitarDOM.clearChildren(matrix);

    // Strings 1 to 6 (Display: 1 at top down to 6 at bottom)
    for (let stringNum = 1; stringNum <= 6; stringNum++) {
      const row = document.createElement('div');
      row.className = 'matrix-string-row';
      row.dataset.string = stringNum;

      // 4 beats per measure * total measures
      const totalBeats = this.currentSong.measures * 4;
      for (let b = 1; b <= totalBeats; b++) {
        const measure = Math.floor((b - 1) / 4) + 1;
        const beatInMeasure = ((b - 1) % 4) + 1;

        const cell = document.createElement('div');
        cell.className = 'matrix-beat-cell';
        if (beatInMeasure === 1) cell.classList.add('measure-start');
        cell.dataset.string = stringNum;
        cell.dataset.measure = measure;
        cell.dataset.beat = beatInMeasure;
        cell.title = `Cuerda ${stringNum} - C${measure}:B${beatInMeasure}`;

        // Check if there is a note in this cell
        const existingNote = this.currentSong.notes.find(
          n => n.string === stringNum && n.measure === measure && n.beat === beatInMeasure
        );

        if (existingNote) {
          const chip = document.createElement('div');
          chip.className = `grid-note-chip chip-finger-${existingNote.finger}`;
          chip.textContent = existingNote.fret;
          chip.title = `Traste ${existingNote.fret} (Dedo ${existingNote.finger})`;
          cell.appendChild(chip);
        }

        cell.addEventListener('click', (e) => {
          this.handleCellClick(cell, stringNum, measure, beatInMeasure, e);
        });

        row.appendChild(cell);
      }

      matrix.appendChild(row);
    }

    // Render chord blocks if in chord mode
    this.renderChordBlocks();
  }

  renderChordBlocks() {
    const track = document.getElementById('chord-lane-track');
    if (!track) return;

    GuitarDOM.clearChildren(track);
    const beatWidth = 48; // 48px per beat

    this.currentSong.chords.forEach(chord => {
      const startBeatTotal = (chord.measure - 1) * 4 + (chord.beat - 1);
      const leftPx = startBeatTotal * beatWidth;
      const widthPx = chord.durationBeats * beatWidth;

      const block = document.createElement('div');
      block.className = 'grid-chord-block';
      block.style.left = `${leftPx}px`;
      block.style.width = `${widthPx - 6}px`;
      block.style.background = chord.color || '#ea5b57';
      block.textContent = chord.chord;
      block.title = `Acorde ${chord.chord} (Compás ${chord.measure})`;

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.guitarAudio) window.guitarAudio.playChord(chord.chord);
      });

      track.appendChild(block);
    });
  }

  handleCellClick(cell, stringNum, measure, beat, event) {
    this.selectedCell = { string: stringNum, measure, beat, cellElement: cell };

    const existingNote = this.currentSong.notes.find(
      n => n.string === stringNum && n.measure === measure && n.beat === beat
    );

    if (this.currentSong.mode === 'chords') {
      // In chord mode, prompt for chord
      this.promptAddChord(measure, beat);
      return;
    }

    // Open Note Popover
    const modal = document.getElementById('note-selector-modal');
    if (!modal) return;

    // Position modal near clicked cell
    const rect = cell.getBoundingClientRect();
    modal.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 10)}px`;
    modal.style.left = `${Math.min(window.innerWidth - 340, Math.max(20, rect.left - 100))}px`;

    // Set initial values
    if (existingNote) {
      this.selectedFret = existingNote.fret;
      this.selectedFinger = existingNote.finger;
    } else {
      this.selectedFret = 3;
      this.selectedFinger = 1;
    }

    // Highlight active fret & finger
    document.querySelectorAll('.fret-select-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.fret) === this.selectedFret);
    });

    document.querySelectorAll('.finger-select-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.finger) === this.selectedFinger);
    });

    modal.classList.add('visible');
  }

  applySelectedNote() {
    if (!this.selectedCell) return;
    const { string, measure, beat } = this.selectedCell;

    // Remove existing if any
    this.currentSong.notes = this.currentSong.notes.filter(
      n => !(n.string === string && n.measure === measure && n.beat === beat)
    );

    // Add new note
    const newNote = {
      id: Date.now(),
      measure,
      beat,
      string,
      fret: this.selectedFret,
      finger: this.selectedFinger
    };
    this.currentSong.notes.push(newNote);

    // Sound
    if (window.guitarAudio) {
      window.guitarAudio.playString(string, this.selectedFret);
    }

    // Close modal & re-render
    const modal = document.getElementById('note-selector-modal');
    if (modal) modal.classList.remove('visible');

    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  deleteSelectedNote() {
    if (!this.selectedCell) return;
    const { string, measure, beat } = this.selectedCell;

    this.currentSong.notes = this.currentSong.notes.filter(
      n => !(n.string === string && n.measure === measure && n.beat === beat)
    );

    const modal = document.getElementById('note-selector-modal');
    if (modal) modal.classList.remove('visible');

    this.renderGrid();
    this.updateStats();
    this.saveToStorage();
  }

  promptAddChord(measure, beat) {
    const chordOptions = ['Am', 'C', 'G', 'D', 'Em', 'E', 'F', 'Dm'];
    const chosen = prompt(`Elige el acorde a colocar en Compás ${measure}, Beat ${beat}:\n(${chordOptions.join(', ')})`, 'Am');
    if (!chosen) return;

    const chordClean = chosen.trim();
    const colors = {
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
      durationBeats: 4,
      color: colors[chordClean] || '#ea5b57'
    });

    if (window.guitarAudio) {
      window.guitarAudio.playChord(chordClean);
    }

    this.renderChordBlocks();
    this.updateStats();
    this.saveToStorage();
  }

  updateStats() {
    const notesCount = document.getElementById('editor-notes-count');
    const chordsCount = document.getElementById('editor-chords-count');
    const durationCount = document.getElementById('editor-duration-count');

    if (notesCount) notesCount.textContent = this.currentSong.notes.length;
    if (chordsCount) chordsCount.textContent = this.currentSong.chords.length;

    // Calculate duration in seconds = (measures * 4 beats) * (60 / bpm)
    const totalSeconds = ((this.currentSong.measures * 4) * 60) / this.currentSong.bpm;
    if (durationCount) durationCount.textContent = `${totalSeconds.toFixed(1)}s`;
  }

  playInGame() {
    this.saveToStorage();
    if (window.gameplayEngine) {
      window.gameplayEngine.loadCustomSong(this.currentSong);
    }

    // Switch to notes (Screen 3) or chords (Screen 4)
    const targetScreen = this.currentSong.mode === 'chords' ? 'chords' : 'notes';
    if (window.switchGuitarScreen) {
      window.switchGuitarScreen(targetScreen);
    }

    // Start playback immediately
    setTimeout(() => {
      if (window.gameplayEngine && !window.gameplayEngine.isPlaying) {
        window.gameplayEngine.togglePlay();
      }
    }, 400);
  }

  exportSongJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.currentSong, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${this.currentSong.title.replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  importSongJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (imported && (imported.notes || imported.chords)) {
          this.currentSong = imported;
          this.updateToolbarUI();
          this.renderGrid();
          this.updateStats();
          this.saveToStorage();
          alert(`¡Canción "${this.currentSong.title}" importada correctamente!`);
        }
      } catch (err) {
        alert('Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  }
}

window.songEditor = new SongEditor();
