export interface EditorNote {
  id: number;
  measure: number;
  beat: number;
  step: number;
  duration: number;
  string: number;
  fret: number;
  finger: number;
}

export interface EditorChord {
  id: number;
  measure: number;
  beat: number;
  chord: string;
  duration: number;
  color: string;
}

export interface SongProject {
  title: string;
  section: string;
  bpm: number;
  mode: 'notes' | 'chords';
  measures: number;
  notes: EditorNote[];
  chords: EditorChord[];
}

/**
 * A note as written in the built-in song presets, which predate the sixteenth-note grid and
 * only record a beat. sanitizeSongProject derives step and duration from it on load.
 */
export interface LegacyEditorNote extends Omit<EditorNote, 'step' | 'duration'> {
  step?: number;
  duration?: number;
}

export interface LegacySongProject extends Omit<SongProject, 'notes'> {
  notes: LegacyEditorNote[];
}

export interface SelectedEditorCell {
  string: number;
  measure: number;
  beat: number;
  step: number;
}
