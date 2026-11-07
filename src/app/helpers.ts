import type { SongProject } from '../types/editor.types';
import type { DifficultyLevel } from '../services/supabase';

export function demoSheetProject(notes: Array<{ string: number; fret: number }>, title: string): SongProject {
  return {
    title: title || 'Demostración',
    section: '',
    bpm: 90,
    mode: 'notes',
    measures: Math.max(1, Math.ceil(notes.length / 4)),
    notes: notes.map((note, index) => ({
      id: index + 1,
      measure: Math.floor(index / 4) + 1,
      beat: (index % 4) + 1,
      step: (index % 4) * 4 + 1,
      duration: 4,
      string: note.string,
      fret: note.fret,
      finger: 0
    })),
    chords: []
  };
}

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ['all', 'easy', 'medium', 'hard', 'expert'];

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revocar en el acto cancela la descarga en algunos navegadores (Firefox/Safari).
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
