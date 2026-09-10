import type { StringNumber, OnPitchDetectedCallback, PitchMatchResult } from '../types/audio.types';

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

  // Onset detection (spectral flux) and chroma state
  private specDb: Float32Array<ArrayBuffer> | null = null;
  private prevMag: Float32Array<ArrayBuffer> | null = null;
  private chromaBins: Float32Array<ArrayBuffer> = new Float32Array(12);
  private fluxAverage: number = 0;
  private onsetArmed: boolean = false;
  private lastOnsetAt: number = 0;

  /** YIN runs on this many of the most recent samples; the FFT still uses the full buffer. */
  private static readonly PITCH_WINDOW = 4096;
  /** Minimum gap between two reported onsets, in milliseconds. */
  private static readonly ONSET_REFRACTORY_MS = 60;
  /**
   * How often YIN runs, in milliseconds. Onset detection stays at full frame rate because it is
   * cheap and timing-critical, but pitch is a slow-moving quantity and YIN is the expensive part.
   */
  private static readonly PITCH_INTERVAL_MS = 30;

  private lastPitchAt: number = 0;
  private lastPitch: PitchMatchResult | null = null;

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
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0;
      this.micSource.connect(this.analyser);

      this.pitchBuffer = new Float32Array(this.analyser.fftSize);
      this.specDb = new Float32Array(this.analyser.frequencyBinCount);
      this.prevMag = new Float32Array(this.analyser.frequencyBinCount);
      this.fluxAverage = 0;
      this.onsetArmed = false;
      this.hasMicPermission = true;
      this.isTrackingPitch = true;
      this.runPitchLoop();
      return true;
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      return false;
    }
  }

  private runPitchLoop(): void {
    const trackLoop = () => {
      if (!this.isTrackingPitch || !this.analyser || !this.pitchBuffer || !this.ctx) return;
      this.analyser.getFloatTimeDomainData(this.pitchBuffer);

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
    // Chroma ignores the muddy bottom end (bins there are narrower than a semitone) and the
    // upper partials that no longer identify the chord.
    const chromaMinBin = Math.max(1, Math.floor(100 / binHz));
    const chromaMaxBin = Math.min(bins - 1, Math.floor(2000 / binHz));

    this.chromaBins.fill(0);
    let flux = 0;
    let chromaTotal = 0;

    for (let k = 1; k <= fluxMaxBin; k++) {
      const db = this.specDb[k];
      const mag = db > -140 && Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
      const rise = mag - this.prevMag[k];
      if (rise > 0) flux += rise;
      this.prevMag[k] = mag;

      if (k >= chromaMinBin && k <= chromaMaxBin && mag > 0) {
        const freq = k * binHz;
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        const pitchClass = ((midi % 12) + 12) % 12;
        this.chromaBins[pitchClass] += mag;
        chromaTotal += mag;
      }
    }

    const threshold = this.fluxAverage * 2.4 + 1e-4;
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

    if (chromaTotal <= 0) {
      return { isOnset, chroma: null };
    }
    for (let i = 0; i < 12; i++) {
      this.chromaBins[i] /= chromaTotal;
    }
    return { isOnset, chroma: this.chromaBins };
  }

  /**
   * Pitch detection: YIN (de Cheveigné & Kawahara) on the most recent PITCH_WINDOW samples,
   * then nearest open string by MIDI. Same family of ideas as browser tuners
   * (large buffer, fundamental tracking, cents vs target), without their WASM.
   */
  public detectPitchAutocorrelation(buffer: Float32Array, sampleRate: number): PitchMatchResult {
    let sumSquares = 0;
    const size = buffer.length;
    for (let i = 0; i < size; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / size);

    if (rms < 0.005) {
      return { freq: null, rms, isOnset: false, chroma: null, stringMatch: null, fretMatch: null };
    }

    // YIN cost is O(lags x window), so keep the correlation window short even when the caller
    // hands us a long FFT buffer. 4096 samples still spans ~3.8 periods of the low E string.
    const window = size > GuitarAudioEngine.PITCH_WINDOW
      ? buffer.subarray(size - GuitarAudioEngine.PITCH_WINDOW)
      : buffer;

    const freq = this.detectFreqYin(window, sampleRate);
    if (freq === null) {
      return { freq: null, rms, isOnset: false, chroma: null, stringMatch: null, fretMatch: null };
    }

    const guitarStrings = [
      { string: 1, name: 'E4', freq: 329.63, midi: 64 },
      { string: 2, name: 'B3', freq: 246.94, midi: 59 },
      { string: 3, name: 'G3', freq: 196.00, midi: 55 },
      { string: 4, name: 'D3', freq: 146.83, midi: 50 },
      { string: 5, name: 'A2', freq: 110.00, midi: 45 },
      { string: 6, name: 'E2', freq: 82.41, midi: 40 }
    ];

    const measuredMidi = 69 + 12 * Math.log2(freq / 440);

    let matchedString: (typeof guitarStrings)[0] | null = null;
    let minMidiDiff = Infinity;
    for (const gs of guitarStrings) {
      const diff = Math.abs(measuredMidi - gs.midi);
      if (diff < minMidiDiff) {
        minMidiDiff = diff;
        matchedString = gs;
      }
    }

    if (!matchedString || minMidiDiff > 1.35) {
      matchedString = null;
    }

    const computedCents = matchedString
      ? Math.round(1200 * Math.log2(freq / matchedString.freq))
      : 0;

    let matchedFret: { string: number; fret: number; expectedFreq: number; cents: number } | null = null;
    let bestFretScore = Infinity;
    const baseFreqs: Record<number, number> = { 1: 329.63, 2: 246.94, 3: 196.00, 4: 146.83, 5: 110.00, 6: 82.41 };

    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= 15; f++) {
        const expectedF = baseFreqs[s] * Math.pow(2, f / 12);
        const cents = 1200 * Math.log2(freq / expectedF);
        // Half a semitone, so adjacent frets partition the range instead of overlapping.
        if (Math.abs(cents) >= 45) continue;
        // A pitch is playable at several positions; the tiny fret term breaks those ties
        // toward first position rather than toward whichever string the loop visited first.
        const score = Math.abs(cents) + f * 0.01;
        if (score < bestFretScore) {
          bestFretScore = score;
          matchedFret = { string: s, fret: f, expectedFreq: Math.round(expectedF * 10) / 10, cents: Math.round(cents) };
        }
      }
    }

    return {
      freq: Math.round(freq * 10) / 10,
      rms,
      isOnset: false,
      chroma: null,
      stringMatch: matchedString ? {
        string: matchedString.string,
        name: matchedString.name,
        targetFreq: matchedString.freq,
        cents: computedCents,
        inTune: Math.abs(computedCents) <= 5
      } : null,
      fretMatch: matchedFret
    };
  }

  /** YIN cumulative-mean difference. Returns Hz or null. */
  private detectFreqYin(buffer: Float32Array, sampleRate: number): number | null {
    const size = buffer.length;
    const half = Math.floor(size / 2);
    const minTau = Math.max(2, Math.floor(sampleRate / 900));
    const maxTau = Math.min(half, Math.floor(sampleRate / 65));
    if (maxTau <= minTau) return null;

    const diff = new Float32Array(maxTau + 1);
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < half; i++) {
        const delta = buffer[i] - buffer[i + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }

    const cmnd = new Float32Array(maxTau + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += diff[tau];
      cmnd[tau] = diff[tau] * tau / running;
    }

    const threshold = 0.15;
    let tauEstimate = -1;
    for (let tau = minTau; tau < maxTau; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) {
          tau++;
        }
        tauEstimate = tau;
        break;
      }
    }

    if (tauEstimate < 0) {
      let best = minTau;
      for (let tau = minTau + 1; tau < maxTau; tau++) {
        if (cmnd[tau] < cmnd[best]) best = tau;
      }
      if (cmnd[best] > 0.35) return null;
      tauEstimate = best;
    }

    const t = tauEstimate;
    const x0 = t > 1 ? cmnd[t - 1] : cmnd[t];
    const x1 = cmnd[t];
    const x2 = t + 1 <= maxTau ? cmnd[t + 1] : cmnd[t];
    const denom = 2 * (x0 - 2 * x1 + x2);
    let betterTau = t;
    if (Math.abs(denom) > 1e-12) {
      betterTau = t + (x0 - x2) / denom;
    }

    if (betterTau < 1) return null;

    // No octave correction here on purpose. A guitar note with a weak or missing fundamental is
    // still periodic at the fundamental, because its partials are consecutive harmonics, and
    // YIN's rule of taking the first dip below the threshold already resolves it. Second-guessing
    // that by comparing the CMND at twice the lag drops clean notes an octave, since a periodic
    // tone scores near zero at both lags and the comparison becomes floating point noise.
    return sampleRate / betterTau;
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
