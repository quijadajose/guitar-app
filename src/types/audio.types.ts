export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface StringTuningInfo {
  stringNum: StringNumber;
  openNote: string;
  openOctave: number;
  nameSpanish: string;
  freq: number;
}

export interface PitchMatchResult {
  freq: number | null;
  rms: number;
  /** True on the frame where a new pluck/strum attack was detected (spectral flux peak). */
  isOnset: boolean;
  /** 12-bin pitch class energy profile (index 0 = C), normalized to sum 1. Null when too quiet. */
  chroma: Float32Array | null;
  stringMatch: {
    string: number;
    name: string;
    targetFreq: number;
    cents: number;
    inTune: boolean;
  } | null;
  fretMatch: {
    string: number;
    fret: number;
    expectedFreq: number;
    cents: number;
  } | null;
}

export type OnPitchDetectedCallback = (result: PitchMatchResult) => void;
