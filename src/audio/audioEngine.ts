import type { StringNumber, OnPitchDetectedCallback, PitchMatchResult } from '../types/audio.types';
import { chromaFromMagnitudes } from './chords';
import { detectPitchAutocorrelation as matchPitch } from './pitchMatch';
import { DEFAULT_SESSION_PROFILE, type SessionAudioProfile } from './sessionProfile';
import pitchWorkletUrl from './pitch.worklet.js?url';
import PitchWorker from './pitch.worker.ts?worker';

/**
 * Web Audio Guitar Sound Engine
 * Uses Karplus-Strong physical modeling synthesis for authentic acoustic guitar sounds
 */
export class GuitarAudioEngine {
  public ctx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  public isMuted: boolean = false;

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private pitchBuffer: Float32Array<ArrayBuffer> | null = null;
  private pitchAnimId: number | null = null;
  public isTrackingPitch: boolean = false;
  public hasMicPermission: boolean = false;
  private pitchListeners = new Set<OnPitchDetectedCallback>();
  private waveformListener: ((samples: Float32Array) => void) | null = null;
  private captureBuffer: Float32Array | null = null;
  private captureWrite = 0;
  public capturing = false;

  // Onset detection (spectral flux) and chroma state
  private specDb: Float32Array<ArrayBuffer> | null = null;
  private prevMag: Float32Array<ArrayBuffer> | null = null;
  private linearMag: Float32Array<ArrayBuffer> | null = null;
  private chromaBins: Float32Array<ArrayBuffer> = new Float32Array(12);
  private fluxAverage: number = 0;
  private onsetArmed: boolean = false;
  private lastOnsetAt: number = 0;

  /** Minimum gap between two reported onsets, in milliseconds. */
  private static readonly ONSET_REFRACTORY_MS = 60;
  /**
   * How often YIN runs, in milliseconds. Onset detection stays at full frame rate because it is
   * cheap and timing-critical, but pitch is a slow-moving quantity and YIN is the expensive part.
   */
  private static readonly PITCH_INTERVAL_MS = 30;

  private lastPitchAt: number = 0;
  private lastPitch: PitchMatchResult | null = null;

  private workletNode: AudioWorkletNode | null = null;
  private pitchWorker: Worker | null = null;
  private usingWorkletPath: boolean = false;
  public sessionProfile: SessionAudioProfile = { ...DEFAULT_SESSION_PROFILE, playerChromas: {} };
  private rmsGate = DEFAULT_SESSION_PROFILE.rmsGate;
  private fluxMultiplier = DEFAULT_SESSION_PROFILE.fluxMultiplier;

  // Standard guitar tuning frequencies (String 6 to 1)
  // 6: E2 (82.41 Hz), 5: A2 (110.00 Hz), 4: D3 (146.83 Hz), 3: G3 (196.00 Hz), 2: B3 (246.94 Hz), 1: E4 (329.63 Hz)
  public readonly stringFrequencies: Record<StringNumber, number> = {
    6: 82.41,
    5: 110.0,
    4: 146.83,
    3: 196.0,
    2: 246.94,
    1: 329.63
  };

  public readonly stringNames: Record<StringNumber, string> = {
    6: 'E',
    5: 'A',
    4: 'D',
    3: 'G',
    2: 'B',
    1: 'E'
  };

  public init(): void {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Calculate frequency for a specific string and fret
  public getFretFrequency(stringNum: number, fret: number): number {
    const baseFreq = this.stringFrequencies[stringNum as StringNumber] || 220;
    return baseFreq * Math.pow(2, fret / 12);
  }

  // Karplus-Strong string synthesis algorithm
  public playString(stringNum: number, fret: number = 0, duration: number = 2.5, velocity: number = 0.8): number | undefined {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return undefined;

    const freq = this.getFretFrequency(stringNum, fret);
    const sampleRate = this.ctx.sampleRate;
    const period = Math.round(sampleRate / freq);

    // Create burst of noise
    const buffer = this.ctx.createBuffer(1, period, sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < period; i++) {
      channelData[i] = (Math.random() * 2 - 1) * 0.9;
    }

    // Loop buffer with feedback filter
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    // Filter simulating string damping & body wood resonance
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseCutoff = stringNum >= 4 ? 2200 : 4500;
    filter.frequency.setValueAtTime(baseCutoff, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(700, this.ctx.currentTime + duration);

    // Body impulse resonator
    const bodyResonator = this.ctx.createBiquadFilter();
    bodyResonator.type = 'peaking';
    bodyResonator.frequency.value = 180; // Guitar body cavity resonance
    bodyResonator.Q.value = 2.5;
    bodyResonator.gain.value = 6.0;

    // Amplitude envelope
    const gainNode = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(velocity * 0.9, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(filter);
    filter.connect(bodyResonator);
    bodyResonator.connect(gainNode);
    gainNode.connect(this.masterGain);

    noiseSource.start(now);
    noiseSource.stop(now + duration);

    return freq;
  }

  // Strum a chord (e.g. Am: X 0 2 2 1 0)
  public playChord(chordName: string = 'Am'): void {
    this.init();
    if (this.isMuted) return;

    let notes: Array<{ string: number; fret: number }> = [];
    if (chordName === 'Am') {
      notes = [
        { string: 5, fret: 0 },
        { string: 4, fret: 2 },
        { string: 3, fret: 2 },
        { string: 2, fret: 1 },
        { string: 1, fret: 0 }
      ];
    } else if (chordName === 'C') {
      notes = [
        { string: 5, fret: 3 },
        { string: 4, fret: 2 },
        { string: 3, fret: 0 },
        { string: 2, fret: 1 },
        { string: 1, fret: 0 }
      ];
    } else if (chordName === 'Em') {
      notes = [
        { string: 6, fret: 0 },
        { string: 5, fret: 2 },
        { string: 4, fret: 2 },
        { string: 3, fret: 0 },
        { string: 2, fret: 0 },
        { string: 1, fret: 0 }
      ];
    } else if (chordName === 'G') {
      notes = [
        { string: 6, fret: 3 },
        { string: 5, fret: 2 },
        { string: 4, fret: 0 },
        { string: 3, fret: 0 },
        { string: 2, fret: 0 },
        { string: 1, fret: 3 }
      ];
    } else if (chordName === 'D') {
      notes = [
        { string: 4, fret: 0 },
        { string: 3, fret: 2 },
        { string: 2, fret: 3 },
        { string: 1, fret: 2 }
      ];
    } else {
      notes = [
        { string: 6, fret: 0 },
        { string: 5, fret: 0 },
        { string: 4, fret: 0 },
        { string: 3, fret: 0 },
        { string: 2, fret: 0 },
        { string: 1, fret: 0 }
      ];
    }

    notes.forEach((n, idx) => {
      setTimeout(() => {
        this.playString(n.string, n.fret, 3.0, 0.75);
      }, idx * 24);
    });
  }

  // Play a rewarding "Perfect!" hit tone
  public playHitSound(): void {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  // Play a "Miss!" error sound
  public playMissSound(): void {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.22);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Click feedback sound
  public playClickSound(): void {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  // =========================================================================
  // REAL MICROPHONE PITCH DETECTION (AUTOCORRELATION & GUITAR STRING MATCHER)
  // =========================================================================
  public async startMicrophonePitchTracking(onPitchDetected?: OnPitchDetectedCallback): Promise<boolean> {
    if (onPitchDetected) {
      this.pitchListeners.add(onPitchDetected);
    }

    this.init();
    if (this.micStream && this.isTrackingPitch) {
      return true;
    }

    if (this.micStream && this.usingWorkletPath && this.workletNode && this.pitchWorker) {
      this.isTrackingPitch = true;
      return true;
    }

    if (this.micStream && this.analyser && this.pitchBuffer) {
      this.isTrackingPitch = true;
      this.runPitchLoop();
      return true;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('getUserMedia is not supported by this browser');
      return false;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false
        }
      });

      if (!this.ctx) return false;
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.hasMicPermission = true;
      this.isTrackingPitch = true;

      const workletOk = await this.startWorkletPitchPath();
      if (workletOk) return true;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0;
      this.micSource.connect(this.analyser);

      this.pitchBuffer = new Float32Array(this.analyser.fftSize);
      this.specDb = new Float32Array(this.analyser.frequencyBinCount);
      this.prevMag = new Float32Array(this.analyser.frequencyBinCount);
      this.fluxAverage = 0;
      this.onsetArmed = false;
      this.runPitchLoop();
      return true;
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      return false;
    }
  }

  private async startWorkletPitchPath(): Promise<boolean> {
    if (!this.ctx || !this.micSource) return false;
    if (!this.ctx.audioWorklet) return false;

    try {
      await this.ctx.audioWorklet.addModule(pitchWorkletUrl);
      this.workletNode = new AudioWorkletNode(this.ctx, 'pitch-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      const silent = this.ctx.createGain();
      silent.gain.value = 0;
      this.micSource.connect(this.workletNode);
      this.workletNode.connect(silent);
      silent.connect(this.ctx.destination);

      this.pitchWorker = new PitchWorker();
      this.pitchWorker.postMessage({ type: 'init', sampleRate: this.ctx.sampleRate });
      this.pushProfileToWorker();
      this.pitchWorker.onmessage = (event: MessageEvent<PitchMatchResult>) => {
        if (!this.isTrackingPitch) return;
        this.pitchListeners.forEach(listener => listener(event.data));
      };

      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.pitchWorker || !this.isTrackingPitch) return;
        const hop = event.data;
        this.storeCapture(hop);
        this.emitWaveform(hop);
        this.pitchWorker.postMessage({ type: 'hop', samples: hop, nowMs: performance.now() }, [hop.buffer]);
      };

      this.usingWorkletPath = true;
      return true;
    } catch (err) {
      console.warn('AudioWorklet pitch path unavailable, falling back to AnalyserNode:', err);
      this.teardownWorkletPath();
      return false;
    }
  }

  private teardownWorkletPath(): void {
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch { /* already disconnected */ }
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }
    if (this.pitchWorker) {
      this.pitchWorker.terminate();
      this.pitchWorker = null;
    }
    this.usingWorkletPath = false;
  }

  private runPitchLoop(): void {
    const trackLoop = () => {
      if (!this.isTrackingPitch || !this.analyser || !this.pitchBuffer || !this.ctx) return;
      this.analyser.getFloatTimeDomainData(this.pitchBuffer);
      this.storeCapture(this.pitchBuffer);
      this.emitWaveform(this.pitchBuffer);

      const spectral = this.analyseSpectrum(this.ctx.sampleRate);

      const now = performance.now();
      if (!this.lastPitch || now - this.lastPitchAt >= GuitarAudioEngine.PITCH_INTERVAL_MS) {
        this.lastPitchAt = now;
        this.lastPitch = this.detectPitchAutocorrelation(this.pitchBuffer, this.ctx.sampleRate);
      }

      this.pitchListeners.forEach(listener => listener({
        ...this.lastPitch!,
        isOnset: spectral.isOnset,
        chroma: spectral.chroma
      }));

      this.pitchAnimId = requestAnimationFrame(trackLoop);
    };

    if (this.pitchAnimId !== null) {
      cancelAnimationFrame(this.pitchAnimId);
    }
    trackLoop();
  }

  public beginCapture(seconds = 6): void {
    const rate = this.ctx?.sampleRate ?? 48000;
    this.captureBuffer = new Float32Array(Math.floor(rate * seconds));
    this.captureWrite = 0;
    this.capturing = true;
  }

  public captureProgress(): number {
    if (!this.captureBuffer || this.captureBuffer.length === 0) return 0;
    return this.captureWrite / this.captureBuffer.length;
  }

  public finishCapture(): { sampleRate: number; samples: Float32Array } | null {
    this.capturing = false;
    if (!this.captureBuffer || this.captureWrite === 0) return null;
    const samples = this.captureBuffer.slice(0, this.captureWrite);
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    this.captureBuffer = null;
    this.captureWrite = 0;
    return { sampleRate, samples };
  }

  private storeCapture(hop: Float32Array): void {
    if (!this.capturing || !this.captureBuffer) return;
    const room = this.captureBuffer.length - this.captureWrite;
    if (room <= 0) {
      this.capturing = false;
      return;
    }
    const n = Math.min(room, hop.length);
    this.captureBuffer.set(hop.subarray(0, n), this.captureWrite);
    this.captureWrite += n;
    if (this.captureWrite >= this.captureBuffer.length) this.capturing = false;
  }

  public setWaveformListener(listener: ((samples: Float32Array) => void) | null): void {
    this.waveformListener = listener;
  }

  private emitWaveform(samples: Float32Array): void {
    if (!this.waveformListener) return;
    const step = 8;
    const preview = new Float32Array(Math.ceil(samples.length / step));
    for (let i = 0, j = 0; i < samples.length; i += step, j++) {
      preview[j] = samples[i];
    }
    this.waveformListener(preview);
  }

  public detachPitchListener(onPitchDetected: OnPitchDetectedCallback): void {
    this.pitchListeners.delete(onPitchDetected);
  }

  public stopMicrophonePitchTracking(): void {
    this.pitchListeners.clear();
    this.isTrackingPitch = false;
    if (this.pitchAnimId) {
      cancelAnimationFrame(this.pitchAnimId);
      this.pitchAnimId = null;
    }
  }

  public releaseMicrophone(): void {
    this.stopMicrophonePitchTracking();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    this.analyser = null;
    this.pitchBuffer = null;
    this.specDb = null;
    this.prevMag = null;
    this.linearMag = null;
    this.teardownWorkletPath();
  }

  /**
   * Spectral flux onset detection plus a 12-bin chroma profile.
   *
   * Flux (sum of positive magnitude changes) rises when a new note adds energy in bins that
   * were previously empty, so it still fires for a soft note plucked over a loud ringing tail,
   * which a plain RMS jump would miss. A Schmitt trigger against a slow running average gives
   * one onset per attack instead of one per frame.
   */
  private analyseSpectrum(sampleRate: number): { isOnset: boolean; chroma: Float32Array | null } {
    if (!this.analyser || !this.specDb || !this.prevMag) {
      return { isOnset: false, chroma: null };
    }

    this.analyser.getFloatFrequencyData(this.specDb);

    const bins = this.specDb.length;
    const binHz = sampleRate / (bins * 2);
    // Transients are broadband, so measure flux well above the fundamentals.
    const fluxMaxBin = Math.min(bins - 1, Math.floor(5000 / binHz));

    if (!this.linearMag || this.linearMag.length !== bins) {
      this.linearMag = new Float32Array(bins);
    }
    const mags = this.linearMag;
    mags.fill(0);

    let flux = 0;
    for (let k = 1; k <= fluxMaxBin; k++) {
      const db = this.specDb[k];
      const mag = db > -140 && Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
      const rise = mag - this.prevMag[k];
      if (rise > 0) flux += rise;
      this.prevMag[k] = mag;
      mags[k] = mag;
    }

    const threshold = this.fluxAverage * this.fluxMultiplier + 1e-4;
    const now = performance.now();
    let isOnset = false;

    if (flux > threshold) {
      if (!this.onsetArmed && now - this.lastOnsetAt >= GuitarAudioEngine.ONSET_REFRACTORY_MS) {
        isOnset = true;
        this.onsetArmed = true;
        this.lastOnsetAt = now;
      }
    } else if (flux < threshold * 0.6) {
      this.onsetArmed = false;
    }

    this.fluxAverage = this.fluxAverage * 0.9 + flux * 0.1;

    const hasChroma = chromaFromMagnitudes(mags, binHz, this.chromaBins);
    return { isOnset, chroma: hasChroma ? this.chromaBins : null };
  }

  public detectPitchAutocorrelation(buffer: Float32Array, sampleRate: number): PitchMatchResult {
    return matchPitch(buffer, sampleRate, this.rmsGate);
  }

  public applySessionProfile(profile: SessionAudioProfile): void {
    this.sessionProfile = profile;
    this.rmsGate = profile.rmsGate;
    this.fluxMultiplier = profile.fluxMultiplier;
    this.pushProfileToWorker();
  }

  private pushProfileToWorker(): void {
    if (!this.pitchWorker) return;
    this.pitchWorker.postMessage({
      type: 'profile',
      rmsGate: this.rmsGate,
      fluxMultiplier: this.fluxMultiplier
    });
  }

  // Synthesized chime when a string is tuned
  public playTunedChime(): void {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now); // C6
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2093.0, now); // C7

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.9);
    osc2.stop(now + 0.9);
  }

  // Celebratory guitar strum when all strings are tuned
  public playCompletionFanfare(): void {
    this.init();
    if (this.isMuted) return;
    const strings = [6, 5, 4, 3, 2, 1];
    strings.forEach((s, idx) => {
      setTimeout(() => {
        this.playString(s, 0, 2.8, 0.75 + idx * 0.05);
      }, idx * 110);
    });
  }

  // Celebratory fanfare for 1, 2, or 3 star performance rating
  public playStarFanfare(stars: number): void {
    this.init();
    if (this.isMuted || !this.ctx || !this.masterGain) return;

    if (stars >= 3) {
      // 3 Stars: Glorious arpeggio + high crystal chimes
      const chords = ['C', 'G', 'C'];
      chords.forEach((chord, i) => {
        setTimeout(() => this.playChord(chord), i * 320);
      });
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
        setTimeout(() => {
          if (!this.ctx || !this.masterGain) return;
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, now);
          g.gain.setValueAtTime(0.2, now);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
          osc.connect(g);
          g.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.9);
        }, 900 + idx * 120);
      });
    } else if (stars === 2) {
      this.playChord('G');
      setTimeout(() => this.playChord('C'), 350);
      this.playTunedChime();
    } else if (stars === 1) {
      this.playChord('C');
      setTimeout(() => this.playTunedChime(), 250);
    } else {
      this.playChord('Am');
    }
  }
}

// Global audio engine singleton
export const guitarAudio = new GuitarAudioEngine();
