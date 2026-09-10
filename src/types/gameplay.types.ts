export interface NoteTrackItem {
  id: number;
  string: number;
  fret: number;
  time: number;
  finger: number;
  label: string;
  hit: boolean;
  missed?: boolean;
  duration?: number;
}

export interface ChordTrackItem {
  id: number;
  chord: string;
  time: number;
  width: number;
  color: string;
  label: string;
  hit: boolean;
  missed?: boolean;
}

export type GameplayMode = 'notes' | 'chords';

export type GameplaySessionMode = 'practice' | 'performance';

export interface PerformanceEvaluation {
  totalItems: number;
  hits: number;
  misses: number;
  accuracy: number;
  stars: number;
  score: number;
  targetScore: number;
  maxCombo: number;
  mode: GameplayMode;
  songTitle: string;
}

