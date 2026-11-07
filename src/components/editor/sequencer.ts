import { guitarAudio } from '../../audio/audioEngine';
import { STEPS_PER_BEAT, STEPS_PER_MEASURE, STEP_CELL_PX, beatFromStep, noteStep } from '../../rhythm';
import { followEditorSheet } from './sheetSync';
import type { SongEditor } from '../editor';

export function toggleSequencerPlayback(eng: SongEditor): void {
  if (eng.isSequencerPlaying) {
    eng.stopSequencerPlayback();
  } else {
    eng.startSequencerPlayback();
  }
}

export function startSequencerPlayback(eng: SongEditor): void {
  guitarAudio.init();
  eng.stopSequencerPlayback();

  const playhead = eng.ensurePlayhead();

  eng.isSequencerPlaying = true;
  eng.currentSequencerBeat = 0;
  eng.setPlaybackButtonState(true);
  if (playhead) {
    playhead.style.display = 'block';
  }

  const stepIntervalMs = ((60 / eng.currentSong.bpm) * 1000) / STEPS_PER_BEAT;
  const totalSteps = eng.playbackStepCount();
  if (totalSteps <= 0) {
    eng.stopSequencerPlayback();
    return;
  }

  eng.playSequencerStep();

  eng.sequencerPlayInterval = window.setInterval(() => {
    eng.currentSequencerBeat++;
    if (eng.currentSequencerBeat >= totalSteps) {
      eng.stopSequencerPlayback();
      return;
    }
    eng.playSequencerStep();
  }, stepIntervalMs);
}

export function playSequencerStep(eng: SongEditor): void {
  const totalSteps = eng.currentSong.measures * STEPS_PER_MEASURE;
  if (eng.currentSequencerBeat >= totalSteps) return;

  const measure = Math.floor(eng.currentSequencerBeat / STEPS_PER_MEASURE) + 1;
  const step = (eng.currentSequencerBeat % STEPS_PER_MEASURE) + 1;
  const beatInMeasure = beatFromStep(step);
  const playheadLeft = eng.currentSequencerBeat * STEP_CELL_PX + (STEP_CELL_PX / 2);

  const playhead = eng.ensurePlayhead();
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

  // 4. Play notes scheduled on eng measure and beat
  if (eng.currentSong.mode === 'notes') {
    const currentNotes = eng.currentSong.notes.filter(
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
    const currentChords = eng.currentSong.chords.filter(
      c => c.measure === measure && c.beat === beatInMeasure
    );

    currentChords.forEach(c => {
      guitarAudio.playChord(c.chord);
    });
  }

  followEditorSheet(eng.currentSequencerBeat);
}

export function stopSequencerPlayback(eng: SongEditor): void {
  if (eng.sequencerPlayInterval !== null) {
    clearInterval(eng.sequencerPlayInterval);
    eng.sequencerPlayInterval = null;
  }
  eng.isSequencerPlaying = false;
  eng.setPlaybackButtonState(false);
  const playhead = document.getElementById('editor-playhead-line');
  if (playhead) {
    playhead.style.display = 'none';
  }

  document.querySelectorAll('.matrix-beat-cell').forEach(cell => {
    cell.classList.remove('playhead-active');
  });
  followEditorSheet(0);
}

export function toggleDualPlayback(eng: SongEditor): void {
  if (eng.isDualPlaybackPlaying) {
    eng.stopDualPlayback();
  } else {
    eng.startDualPlayback();
  }
}

export async function startDualPlayback(eng: SongEditor): Promise<void> {
  if (!eng.referenceAudio) {
    alert('Por favor carga primero una pista de video/audio con el botón "Cargar Video / Audio" para poder contrastar.');
    return;
  }

  guitarAudio.init();

  // Stop any standalone playbacks
  eng.stopSequencerPlayback();
  if (eng.isReferenceAudioPlaying) {
    eng.toggleReferenceAudio();
  }

  eng.isDualPlaybackPlaying = true;
  eng.currentSequencerBeat = 0;

  const bothBtn = document.getElementById('editor-play-both-btn');
  const bothBtnText = document.getElementById('editor-play-both-text');
  const bothBtnIcon = document.getElementById('editor-play-both-icon');
  const playhead = eng.ensurePlayhead();

  if (bothBtn) bothBtn.classList.add('active');
  if (bothBtnText) bothBtnText.textContent = 'Pausar';
  eng.setSvgIcon(bothBtnIcon, 'pause-filled');
  if (playhead) {
    playhead.style.display = 'block';
  }

  // Reset reference audio to start (or synchronized offset)
  eng.referenceAudio.currentTime = 0;

  try {
    await eng.referenceAudio.play();
    eng.isReferenceAudioPlaying = true;
    const refPlayIcon = document.getElementById('audio-ref-play-icon');
    if (refPlayIcon) {
      eng.setSvgIcon(refPlayIcon, 'pause');
    }
  } catch (e) {
    console.warn('Reference audio playback error:', e);
  }

  const stepIntervalMs = ((60 / eng.currentSong.bpm) * 1000) / STEPS_PER_BEAT;
  const totalSteps = eng.playbackStepCount();
  if (totalSteps <= 0) {
    eng.stopDualPlayback();
    return;
  }

  eng.playSequencerStep();

  eng.sequencerPlayInterval = window.setInterval(() => {
    eng.currentSequencerBeat++;
    if (eng.currentSequencerBeat >= totalSteps) {
      eng.stopDualPlayback();
      return;
    }
    eng.playSequencerStep();
  }, stepIntervalMs);
}

export function stopDualPlayback(eng: SongEditor): void {
  if (eng.sequencerPlayInterval !== null) {
    clearInterval(eng.sequencerPlayInterval);
    eng.sequencerPlayInterval = null;
  }
  eng.isDualPlaybackPlaying = false;

  if (eng.referenceAudio) {
    eng.referenceAudio.pause();
    eng.isReferenceAudioPlaying = false;
    const refPlayIcon = document.getElementById('audio-ref-play-icon');
    if (refPlayIcon) {
      eng.setSvgIcon(refPlayIcon, 'play');
    }
  }

  const bothBtn = document.getElementById('editor-play-both-btn');
  const bothBtnText = document.getElementById('editor-play-both-text');
  const bothBtnIcon = document.getElementById('editor-play-both-icon');
  const playhead = document.getElementById('editor-playhead-line');

  if (bothBtn) bothBtn.classList.remove('active');
  if (bothBtnText) bothBtnText.textContent = 'Ambas';
  eng.setSvgIcon(bothBtnIcon, 'play');
  if (playhead) {
    playhead.style.display = 'none';
  }
  followEditorSheet(0);

  document.querySelectorAll('.matrix-beat-cell').forEach(cell => {
    cell.classList.remove('playhead-active');
  });
}
