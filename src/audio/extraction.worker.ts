import { AudioNoteExtractor } from './audioExtractor';
import type { ExtractionRequest, ExtractionWorkerMessage } from './extraction.types';

const extractor = new AudioNoteExtractor();

self.onmessage = async (event: MessageEvent<ExtractionRequest>) => {
  const { id, channels, sampleRate, duration, title, options } = event.data;

  try {
    const { project, truncated, rawMeasures } = await extractor.extractSongProject(
      { channels, sampleRate, duration },
      title,
      options,
      (progress) => {
        const msg: ExtractionWorkerMessage = { id, type: 'progress', ...progress };
        self.postMessage(msg);
      }
    );
    const done: ExtractionWorkerMessage = { id, type: 'done', project, truncated, rawMeasures };
    self.postMessage(done);
  } catch (err) {
    const fail: ExtractionWorkerMessage = {
      id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(fail);
  }
};
