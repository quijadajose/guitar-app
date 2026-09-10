import type { ExtractionOptions } from './audioExtractor';
import type { ExtractionRequest, ExtractionWorkerMessage } from './extraction.types';
import type { SongProject } from '../types/editor.types';
import ExtractionWorker from './extraction.worker.ts?worker';

export type ExtractionProgress = { stage: string; ratio: number };

export interface ExtractionOutcome {
  project: SongProject;
  truncated: boolean;
  rawMeasures: number;
}

export class ExtractionClient {
  private worker: Worker | null = null;
  private nextId = 1;

  public async extract(
    pcm: { channels: Float32Array[]; sampleRate: number; duration: number },
    title: string,
    options: ExtractionOptions,
    onProgress?: (progress: ExtractionProgress) => void,
    workerFactory: () => Worker = () => new ExtractionWorker()
  ): Promise<ExtractionOutcome> {
    this.cancel();
    const id = this.nextId++;
    const worker = workerFactory();
    this.worker = worker;

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        worker.onmessage = null;
        worker.onerror = null;
        if (this.worker === worker) {
          worker.terminate();
          this.worker = null;
        }
      };

      worker.onmessage = (event: MessageEvent<ExtractionWorkerMessage>) => {
        const msg = event.data;
        if (msg.id !== id) return;
        if (msg.type === 'progress') {
          onProgress?.({ stage: msg.stage, ratio: msg.ratio });
          return;
        }
        if (msg.type === 'done') {
          cleanup();
          resolve({ project: msg.project, truncated: msg.truncated, rawMeasures: msg.rawMeasures });
          return;
        }
        cleanup();
        reject(new Error(msg.message));
      };

      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || 'Falló el análisis de audio'));
      };

      const request: ExtractionRequest = {
        id,
        channels: pcm.channels,
        sampleRate: pcm.sampleRate,
        duration: pcm.duration,
        title,
        options
      };
      const transfer = pcm.channels.map(ch => ch.buffer);
      worker.postMessage(request, transfer);
    });
  }

  public cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const extractionClient = new ExtractionClient();

/** Copy PCM out of an AudioBuffer so the original stays usable after a transfer. */
export function copyPcmChannels(audioBuffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }
  return channels;
}
