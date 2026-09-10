import { LivePitchAnalyzer } from './livePitch';

let analyzer: LivePitchAnalyzer | null = null;

self.onmessage = (event: MessageEvent<{
  type: string;
  sampleRate?: number;
  samples?: Float32Array;
  nowMs?: number;
  rmsGate?: number;
  fluxMultiplier?: number;
}>) => {
  const msg = event.data;
  if (msg.type === 'init' && msg.sampleRate) {
    analyzer = new LivePitchAnalyzer(msg.sampleRate);
    return;
  }
  if (msg.type === 'profile' && analyzer) {
    analyzer.setProfile(msg.rmsGate ?? 0.005, msg.fluxMultiplier ?? 2.4);
    return;
  }
  if (msg.type === 'hop' && msg.samples && analyzer) {
    const result = analyzer.pushHop(msg.samples, msg.nowMs ?? 0);
    const chroma = result.chroma ? new Float32Array(result.chroma) : null;
    self.postMessage({ ...result, chroma });
  }
};
