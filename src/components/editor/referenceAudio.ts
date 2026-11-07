import { guitarAudio } from '../../audio/audioEngine';
import { audioExtractor } from '../../audio/audioExtractor';
import type { EditorNote } from '../../types/editor.types';
import { STEPS_PER_BEAT, STEPS_PER_MEASURE, beatFromStep, noteStep } from '../../rhythm';
import { SONG_LIMITS, sanitizePlainText } from '../../songSafety';
import type { SongEditor } from '../editor';

export function setupAudioPlayerEvents(eng: SongEditor): void {
  const playBtn = document.getElementById('audio-ref-play-btn');
  const seeker = document.getElementById('audio-ref-seeker') as HTMLInputElement | null;
  const volume = document.getElementById('audio-ref-volume') as HTMLInputElement | null;
  const removeBtn = document.getElementById('audio-ref-remove-btn');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      eng.toggleReferenceAudio();
    });
  }

  if (seeker) {
    seeker.addEventListener('input', () => {
      if (eng.referenceAudio && eng.referenceAudio.duration) {
        eng.referenceAudio.currentTime = (parseFloat(seeker.value) / 100) * eng.referenceAudio.duration;
      }
    });
  }

  if (volume) {
    volume.addEventListener('input', () => {
      if (eng.referenceAudio) {
        eng.referenceAudio.volume = parseFloat(volume.value);
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      eng.removeReferenceAudio();
    });
  }

  const inspectorAddBtn = document.getElementById('inspector-add-btn');
  if (inspectorAddBtn) {
    inspectorAddBtn.addEventListener('click', () => {
      eng.insertCurrentInspectedNote();
    });
  }
}

export function setupReferenceAudioPlayer(eng: SongEditor, audioSrc: string, title: string): void {
  if (eng.referenceAudio) {
    eng.referenceAudio.pause();
    eng.referenceAudio = null;
  }
  eng.revokeReferenceObjectUrl();
  if (audioSrc.startsWith('blob:')) {
    eng.referenceObjectUrl = audioSrc;
  }

  const playerBar = document.getElementById('editor-audio-player-bar');
  const titleEl = document.getElementById('audio-ref-track-name');
  const timeEl = document.getElementById('audio-ref-track-time');
  const seeker = document.getElementById('audio-ref-seeker') as HTMLInputElement | null;
  const playIcon = document.getElementById('audio-ref-play-icon');

  if (playerBar) playerBar.style.display = 'flex';
  if (titleEl) titleEl.textContent = sanitizePlainText(title, SONG_LIMITS.titleMax, 'Pista');

  eng.referenceAudio = new Audio(audioSrc);
  eng.isReferenceAudioPlaying = false;
  document.getElementById('editor-play-both-btn')?.removeAttribute('hidden');

  if (playIcon) {
    eng.setSvgIcon(playIcon, 'play');
  }

  eng.referenceAudio.addEventListener('loadedmetadata', () => {
    const dur = eng.formatAudioTime(eng.referenceAudio?.duration || 0);
    if (timeEl) timeEl.textContent = `0:00 / ${dur}`;
  });

  eng.referenceAudio.addEventListener('timeupdate', () => {
    if (!eng.referenceAudio) return;
    const cur = eng.referenceAudio.currentTime;
    const dur = eng.referenceAudio.duration || 1;
    const progress = (cur / dur) * 100;
    if (seeker) seeker.value = progress.toString();
    if (timeEl) timeEl.textContent = `${eng.formatAudioTime(cur)} / ${eng.formatAudioTime(dur)}`;

    // Update Real-Time Tuner Note Inspector
    eng.inspectAudioAtTime(cur);
  });

  eng.referenceAudio.addEventListener('ended', () => {
    eng.isReferenceAudioPlaying = false;
    if (playIcon) {
      eng.setSvgIcon(playIcon, 'play');
    }
  });
}

export function inspectAudioAtTime(eng: SongEditor, currentTimeSeconds: number): void {
  if (!eng.decodedAudioBuffer) return;

  const sampleRate = eng.decodedAudioBuffer.sampleRate;
  const centerSample = Math.floor(currentTimeSeconds * sampleRate);
  const windowSize = 2048;

  if (centerSample + windowSize > eng.decodedAudioBuffer.length) return;

  const channelData = eng.decodedAudioBuffer.getChannelData(0);
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
      eng.currentInspectedNote = {
        freq: Math.round(pitch.freq * 10) / 10,
        string: tab.string,
        fret: tab.fret,
        finger: tab.finger,
        name: noteName
      };

      if (noteReadout) {
        noteReadout.textContent = `${noteName} [C${tab.string} T${tab.fret}]`;
        noteReadout.style.color = 'var(--accent)';
      }
      if (freqReadout) {
        freqReadout.textContent = `${eng.currentInspectedNote.freq} Hz`;
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
    noteReadout.style.color = 'var(--text-muted)';
  }
  if (freqReadout) {
    freqReadout.textContent = '-- Hz';
  }
  if (addBtn) {
    addBtn.disabled = true;
  }
}

export function insertCurrentInspectedNote(eng: SongEditor): void {
  if (!eng.currentInspectedNote || !eng.referenceAudio) return;

  const currentTime = eng.referenceAudio.currentTime;
  const beatDuration = 60 / eng.currentSong.bpm;
  const stepDuration = beatDuration / STEPS_PER_BEAT;
  const totalStepIndex = Math.round(currentTime / stepDuration);
  const measure = Math.floor(totalStepIndex / STEPS_PER_MEASURE) + 1;
  const step = (totalStepIndex % STEPS_PER_MEASURE) + 1;
  const beat = beatFromStep(step);

  eng.currentSong.notes = eng.currentSong.notes.filter(
    n => !(n.measure === measure && noteStep(n) === step && n.string === eng.currentInspectedNote!.string)
  );

  const newNote: EditorNote = {
    id: Date.now(),
    measure,
    beat,
    step,
    duration: eng.selectedNoteDuration,
    string: eng.currentInspectedNote.string,
    fret: eng.currentInspectedNote.fret,
    finger: eng.currentInspectedNote.finger
  };

  eng.currentSong.notes.push(newNote);
  eng.currentSong.notes.sort((a, b) => {
    if (a.measure !== b.measure) return a.measure - b.measure;
    return noteStep(a) - noteStep(b);
  });

  // Sound preview
  guitarAudio.playString(newNote.string, newNote.fret);

  eng.renderGrid();
  eng.updateStats();
  eng.saveToStorage();

  // Visual feedback on add button
  const addBtn = document.getElementById('inspector-add-btn');
  if (addBtn) {
    const origText = addBtn.textContent;
    addBtn.textContent = '¡Insertada!';
    setTimeout(() => {
      if (addBtn) addBtn.textContent = origText;
    }, 1000);
  }
}

export function toggleReferenceAudio(eng: SongEditor): void {
  if (!eng.referenceAudio) return;
  const playIcon = document.getElementById('audio-ref-play-icon');

  if (eng.isReferenceAudioPlaying) {
    eng.referenceAudio.pause();
    eng.isReferenceAudioPlaying = false;
    if (playIcon) {
      eng.setSvgIcon(playIcon, 'play');
    }
  } else {
    eng.referenceAudio.play().then(() => {
      eng.isReferenceAudioPlaying = true;
      if (playIcon) {
        eng.setSvgIcon(playIcon, 'pause');
      }
    }).catch(err => console.warn('Audio playback prevented:', err));
  }
}

export function removeReferenceAudio(eng: SongEditor): void {
  if (eng.referenceAudio) {
    eng.referenceAudio.pause();
    eng.referenceAudio.src = '';
    eng.referenceAudio = null;
  }
  eng.revokeReferenceObjectUrl();
  eng.isReferenceAudioPlaying = false;
  const playerBar = document.getElementById('editor-audio-player-bar');
  if (playerBar) playerBar.style.display = 'none';
  document.getElementById('editor-play-both-btn')?.setAttribute('hidden', '');
}

export function formatAudioTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
