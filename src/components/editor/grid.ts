import { guitarAudio } from '../../audio/audioEngine';
import type { EditorNote } from '../../types/editor.types';
import { STEPS_PER_BEAT, STEPS_PER_MEASURE, STEP_CELL_PX, beatFromStep, lastContentStepIndex, noteDurationSteps, noteStep } from '../../rhythm';
import { fingerChipClass, sanitizeCssColor } from '../../songSafety';
import { scheduleEditorSheet } from './sheetSync';
import type { SongEditor } from '../editor';

export function renderHeaderMeasures(eng: SongEditor): void {
  const row = document.getElementById('timeline-measures-row');
  if (!row) return;

  row.replaceChildren();
  for (let m = 1; m <= eng.currentSong.measures; m++) {
    const badge = document.createElement('div');
    badge.className = 'timeline-measure-badge';
    badge.textContent = `Compás ${m}`;
    row.appendChild(badge);
  }
}

export function renderGrid(eng: SongEditor): void {
  const matrix = document.getElementById('editor-matrix-grid');
  scheduleEditorSheet(eng.currentSong);
  if (!matrix) return;

  matrix.replaceChildren();

  // Índice de notas por celda: evita recorrer todas las notas en cada una de las
  // (compases × 16 × 6) celdas, que con canciones largas se vuelve cuadrático.
  const notesByCell = new Map<string, EditorNote>();
  for (const n of eng.currentSong.notes) {
    const key = `${n.string}|${n.measure}|${noteStep(n)}`;
    if (!notesByCell.has(key)) notesByCell.set(key, n);
  }

  for (let stringNum = 1; stringNum <= 6; stringNum++) {
    const row = document.createElement('div');
    row.className = 'matrix-string-row';
    row.dataset.string = stringNum.toString();

    const totalSteps = eng.currentSong.measures * STEPS_PER_MEASURE;
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

      const existingNote = notesByCell.get(`${stringNum}|${measure}|${step}`);

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
        eng.handleCellClick(cell, stringNum, measure, beatInMeasure, step, e);
      });

      row.appendChild(cell);
    }

    matrix.appendChild(row);
  }

  eng.ensurePlayhead();
  eng.renderChordBlocks();
}

export function renderChordBlocks(eng: SongEditor): void {
  const track = document.getElementById('chord-lane-track');
  if (!track) return;

  track.replaceChildren();
  const beatWidth = STEP_CELL_PX * STEPS_PER_BEAT;

  eng.currentSong.chords.forEach(chord => {
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

export function handleCellClick(eng: SongEditor, cell: HTMLElement, stringNum: number, measure: number, beat: number, step: number, _event: MouseEvent): void {
  eng.selectedCell = { string: stringNum, measure, beat, step, cellElement: cell };

  const existingNote = eng.currentSong.notes.find(
    n => n.string === stringNum && n.measure === measure && noteStep(n) === step
  );

  if (eng.currentSong.mode === 'chords') {
    eng.promptAddChord(measure, beat);
    return;
  }

  const modal = document.getElementById('note-selector-modal');
  if (!modal) return;

  const rect = cell.getBoundingClientRect();
  modal.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 10)}px`;
  modal.style.left = `${Math.min(window.innerWidth - 340, Math.max(20, rect.left - 100))}px`;

  if (existingNote) {
    eng.selectedFret = existingNote.fret;
    eng.selectedFinger = existingNote.finger;
    eng.selectedNoteDuration = noteDurationSteps(existingNote);
  } else {
    eng.selectedFret = 3;
    eng.selectedFinger = 1;
  }

  document.querySelectorAll<HTMLElement>('.fret-select-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.fret || '0') === eng.selectedFret);
  });

  document.querySelectorAll<HTMLElement>('.finger-select-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.finger || '0') === eng.selectedFinger);
  });

  document.querySelectorAll<HTMLElement>('.duration-select-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.duration || '0') === eng.selectedNoteDuration);
  });

  modal.classList.add('visible');
}

export function applySelectedNote(eng: SongEditor): void {
  if (!eng.selectedCell) return;
  const { string, measure, beat, step } = eng.selectedCell;

  eng.currentSong.notes = eng.currentSong.notes.filter(
    n => !(n.string === string && n.measure === measure && noteStep(n) === step)
  );

  const newNote: EditorNote = {
    id: Date.now(),
    measure,
    beat,
    step,
    duration: eng.selectedNoteDuration,
    string,
    fret: eng.selectedFret,
    finger: eng.selectedFinger
  };
  eng.currentSong.notes.push(newNote);

  guitarAudio.playString(string, eng.selectedFret);

  const modal = document.getElementById('note-selector-modal');
  if (modal) modal.classList.remove('visible');

  eng.renderGrid();
  eng.updateStats();
  eng.saveToStorage();
}

export function deleteSelectedNote(eng: SongEditor): void {
  if (!eng.selectedCell) return;
  const { string, measure, step } = eng.selectedCell;

  eng.currentSong.notes = eng.currentSong.notes.filter(
    n => !(n.string === string && n.measure === measure && noteStep(n) === step)
  );

  const modal = document.getElementById('note-selector-modal');
  if (modal) modal.classList.remove('visible');

  eng.renderGrid();
  eng.updateStats();
  eng.saveToStorage();
}

export function promptAddChord(eng: SongEditor, measure: number, beat: number): void {
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

  eng.currentSong.chords.push({
    id: Date.now(),
    measure,
    beat,
    chord: chordClean,
    duration: 4,
    color: colors[chordClean] || '#ea5b57'
  });

  guitarAudio.playChord(chordClean);

  eng.renderChordBlocks();
  eng.updateStats();
  eng.saveToStorage();
}

export function clearAllPlacedItems(eng: SongEditor): void {
  eng.currentSong.notes = [];
  eng.currentSong.chords = [];
  eng.renderGrid();
  eng.updateStats();
  eng.saveToStorage();
}

export function updateStats(eng: SongEditor): void {
  const notesCount = document.getElementById('editor-notes-count');
  const chordsCount = document.getElementById('editor-chords-count');
  const durationCount = document.getElementById('editor-duration-count');

  if (notesCount) notesCount.textContent = eng.currentSong.notes.length.toString();
  if (chordsCount) chordsCount.textContent = eng.currentSong.chords.length.toString();

  const lastStep = lastContentStepIndex(eng.currentSong);
  const steps = lastStep < 0 ? 0 : lastStep + 1;
  const totalSeconds = (steps * (60 / eng.currentSong.bpm)) / STEPS_PER_BEAT;
  if (durationCount) durationCount.textContent = `${totalSeconds.toFixed(1)}s`;
}
