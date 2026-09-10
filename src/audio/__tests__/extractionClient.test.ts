import { describe, expect, it } from 'vitest';
import { ExtractionClient } from '../extractionClient';
import type { ExtractionWorkerMessage } from '../extraction.types';

class FakeWorker {
  public onmessage: ((event: MessageEvent<ExtractionWorkerMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public terminated = false;

  postMessage(data: unknown): void {
    const request = data as { id: number };
    queueMicrotask(() => {
      this.onmessage?.({
        data: { id: request.id, type: 'progress', stage: 'Buscando ataques…', ratio: 0.4 }
      } as unknown as MessageEvent<ExtractionWorkerMessage>);
      this.onmessage?.({
        data: {
          id: request.id,
          type: 'done',
          truncated: false,
          rawMeasures: 4,
          project: {
            title: 'test',
            section: 'Transcripción',
            bpm: 90,
            mode: 'notes',
            measures: 4,
            notes: [],
            chords: []
          }
        }
      } as unknown as MessageEvent<ExtractionWorkerMessage>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('ExtractionClient', () => {
  it('resolves with progress and terminates the worker', async () => {
    const fake = new FakeWorker();
    const client = new ExtractionClient();
    const stages: string[] = [];
    const result = await client.extract(
      { channels: [new Float32Array(8)], sampleRate: 44100, duration: 1 },
      'x.wav',
      {},
      p => stages.push(p.stage),
      () => fake as unknown as Worker
    );
    expect(result.project.title).toBe('test');
    expect(stages).toContain('Buscando ataques…');
    expect(fake.terminated).toBe(true);
  });

  it('cancel terminates an in-flight worker', () => {
    const fake = new FakeWorker();
    const client = new ExtractionClient();
    void client.extract(
      { channels: [new Float32Array(8)], sampleRate: 44100, duration: 1 },
      'x.wav',
      {},
      undefined,
      () => fake as unknown as Worker
    );
    client.cancel();
    expect(fake.terminated).toBe(true);
  });
});
