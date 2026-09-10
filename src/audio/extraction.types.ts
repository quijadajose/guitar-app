import type { SongProject } from '../types/editor.types';
import type { ExtractionOptions } from './audioExtractor';

export interface ExtractionRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  title: string;
  options: ExtractionOptions;
}

export interface ExtractionProgressMessage {
  id: number;
  type: 'progress';
  stage: string;
  ratio: number;
}

export interface ExtractionDoneMessage {
  id: number;
  type: 'done';
  project: SongProject;
  truncated: boolean;
  rawMeasures: number;
}

export interface ExtractionErrorMessage {
  id: number;
  type: 'error';
  message: string;
}

export type ExtractionWorkerMessage =
  | ExtractionProgressMessage
  | ExtractionDoneMessage
  | ExtractionErrorMessage;
