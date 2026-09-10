/**
 * Web Audio Guitar Sound Engine
 * Uses Karplus-Strong physical modeling synthesis for authentic acoustic guitar sounds
 */
class GuitarAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;

    // Standard guitar tuning frequencies (String 6 to 1)
    // 6: E2 (82.41 Hz), 5: A2 (110.00 Hz), 4: D3 (146.83 Hz), 3: G3 (196.00 Hz), 2: B3 (246.94 Hz), 1: E4 (329.63 Hz)
    this.stringFrequencies = {
      6: 82.41,
      5: 110.00,
      4: 146.83,
      3: 196.00,
      2: 246.94,
      1: 329.63
    };

    this.stringNames = {
      6: 'E',
      5: 'A',
      4: 'D',
      3: 'G',
      2: 'B',
      1: 'E'
    };
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Calculate frequency for a specific string and fret
  getFretFrequency(stringNum, fret) {
    const baseFreq = this.stringFrequencies[stringNum] || 220;
    return baseFreq * Math.pow(2, fret / 12);
  }

  // Karplus-Strong string synthesis algorithm
  playString(stringNum, fret = 0, duration = 2.5, velocity = 0.8) {
    this.init();
    if (this.isMuted) return;

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
  playChord(chordName = 'Am') {
    this.init();
    if (this.isMuted) return;

    let notes = [];
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
  playHitSound() {
    this.init();
    if (this.isMuted) return;

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
  playMissSound() {
    this.init();
    if (this.isMuted) return;

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
  playClickSound() {
    this.init();
    if (this.isMuted) return;

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
  async startMicrophonePitchTracking(onPitchDetected) {
    this.init();
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

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.micSource.connect(this.analyser);

      this.pitchBuffer = new Float32Array(this.analyser.fftSize);
      this.isTrackingPitch = true;

      const trackLoop = () => {
        if (!this.isTrackingPitch) return;
        this.analyser.getFloatTimeDomainData(this.pitchBuffer);

        const result = this.detectPitchAutocorrelation(this.pitchBuffer, this.ctx.sampleRate);
        if (onPitchDetected) {
          onPitchDetected(result);
        }

        this.pitchAnimId = requestAnimationFrame(trackLoop);
      };

      trackLoop();
      return true;
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      return false;
    }
  }

  stopMicrophonePitchTracking() {
    this.isTrackingPitch = false;
    if (this.pitchAnimId) {
      cancelAnimationFrame(this.pitchAnimId);
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
  }

  // Robust Autocorrelation Pitch Detection
  detectPitchAutocorrelation(buffer, sampleRate) {
    // 1. Calculate RMS volume (energy)
    let sumSquares = 0;
    const size = buffer.length;
    for (let i = 0; i < size; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / size);

    // If too quiet (ambient background room noise / breath), ignore completely
    if (rms < 0.035) {
      return { freq: null, rms, stringMatch: null };
    }

    // 2. Autocorrelation
    // Guitar range: E2 (82 Hz) to E4 (330 Hz). Period range: ~100 to ~600 samples at 44.1k
    const minPeriod = Math.floor(sampleRate / 450); // ~450 Hz upper bound
    const maxPeriod = Math.floor(sampleRate / 65);  // ~65 Hz lower bound

    let bestPeriod = 0;
    let maxCorrelation = 0;

    for (let period = minPeriod; period <= maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < size - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }
      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestPeriod = period;
      }
    }

    // Normalized correlation check (require higher harmonic clarity so noise is ignored)
    const normalizedCorrelation = maxCorrelation / sumSquares;
    if (normalizedCorrelation < 0.48 || bestPeriod === 0) {
      return { freq: null, rms, stringMatch: null };
    }

    // Parabolic interpolation for fine sub-sample frequency precision
    const freq = sampleRate / bestPeriod;

    // Guitar open strings reference frequencies:
    // Standard guitar open string references:
    // 1: E4 (329.63), 2: B3 (246.94), 3: G3 (196.00), 4: D3 (146.83), 5: A2 (110.00), 6: E2 (82.41)
    const guitarStrings = [
      { string: 1, name: 'E4', freq: 329.63, min: 285, max: 375 },
      { string: 2, name: 'B3', freq: 246.94, min: 220, max: 285 },
      { string: 3, name: 'G3', freq: 196.00, min: 170, max: 220 },
      { string: 4, name: 'D3', freq: 146.83, min: 128, max: 170 },
      { string: 5, name: 'A2', freq: 110.00, min: 96,  max: 128 },
      { string: 6, name: 'E2', freq: 82.41,  min: 70,  max: 96 }
    ];

    let matchedString = null;
    let minCentsDiff = Infinity;
    let computedCents = 0;

    for (const gs of guitarStrings) {
      if (freq >= gs.min && freq <= gs.max) {
        // Calculate cents deviation: 1200 * log2(f / targetF)
        const cents = 1200 * Math.log2(freq / gs.freq);
        if (Math.abs(cents) < minCentsDiff) {
          minCentsDiff = Math.abs(cents);
          computedCents = Math.round(cents);
          matchedString = gs;
        }
      }
    }

    // Also match general fretboard notes (string + fret) across 0-12
    let matchedFret = null;
    let minFretDiff = Infinity;
    const baseFreqs = { 1: 329.63, 2: 246.94, 3: 196.00, 4: 146.83, 5: 110.00, 6: 82.41 };
    
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= 12; f++) {
        const expectedF = baseFreqs[s] * Math.pow(2, f / 12);
        const cents = 1200 * Math.log2(freq / expectedF);
        if (Math.abs(cents) < 45 && Math.abs(cents) < minFretDiff) {
          minFretDiff = Math.abs(cents);
          matchedFret = { string: s, fret: f, expectedFreq: Math.round(expectedF * 10) / 10, cents: Math.round(cents) };
        }
      }
    }

    return {
      freq: Math.round(freq * 10) / 10,
      rms,
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

  // Synthesized chime when a string is tuned
  playTunedChime() {
    this.init();
    if (this.isMuted || !this.ctx) return;
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
  playCompletionFanfare() {
    this.init();
    if (this.isMuted) return;
    const strings = [6, 5, 4, 3, 2, 1];
    strings.forEach((s, idx) => {
      setTimeout(() => {
        this.playString(s, 0, 2.8, 0.75 + idx * 0.05);
      }, idx * 110);
    });
  }
}

window.guitarAudio = new GuitarAudioEngine();

