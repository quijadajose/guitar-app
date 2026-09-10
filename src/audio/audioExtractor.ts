import type { EditorChord, EditorNote, SongProject } from '../types/editor.types';
import { beatFromStep, STEPS_PER_BEAT, STEPS_PER_MEASURE } from '../rhythm';
import { SONG_LIMITS } from '../songSafety';
import { fft, hannWindow, magnitudeSpectrum } from './fft';
import { chordNameFromPitchClasses } from './chords';

export interface ExtractionOptions {
  bpm?: number;
  threshold?: number; // flux multiplier (>= 0.8) or legacy amplitude delta
  minNoteDuration?: number; // seconds
  autoBpm?: boolean;
}

export interface PcmSource {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
}

export interface ExtractionProgress {
  stage: string;
  ratio: number;
}

export interface ExtractionResult {
  project: SongProject;
  truncated: boolean;
  rawMeasures: number;
}

export interface ExtractedNoteCandidate {
  time: number; // seconds from start
  freq: number; // fundamental frequency in Hz
  string: number; // 1 to 6
  fret: number; // 0 to 12
  finger: number; // 0 to 4
  confidence: number;
}

export class AudioNoteExtractor {
  // Guitar open string fundamental frequencies
  // 1: E4 (329.63), 2: B3 (246.94), 3: G3 (196.00), 4: D3 (146.83), 5: A2 (110.00), 6: E2 (82.41)
  private readonly baseFrequencies: Record<number, number> = {
    1: 329.63,
    2: 246.94,
    3: 196.00,
    4: 146.83,
    5: 110.00,
    6: 82.41
  };

  /** Detectable pitch range. The top covers the 12th fret of the high E string (E5, 659 Hz). */
  private static readonly MIN_FREQ = 75;
  private static readonly MAX_FREQ = 800;
  /** Minimum NSDF peak value for a slice to count as a pitched note rather than noise. */
  private static readonly MIN_CLARITY = 0.5;
  /** MPM picks the earliest peak within this fraction of the best one, which avoids octave errors. */
  private static readonly PEAK_CUTOFF_RATIO = 0.9;

  private static readonly FFT_SIZE = 2048;
  private static readonly FFT_HOP = 512;
  /** Longer window for pitch: 4096 samples resolve partials that 2048 smears together. */
  private static readonly PITCH_FFT_SIZE = 4096;
  /** Minimum share of the new energy a note's harmonics must explain. */
  private static readonly MIN_ONSET_CONFIDENCE = 0.15;

  /**
   * Decode an audio or video file (ArrayBuffer) into an AudioBuffer.
   *
   * Uses OfflineAudioContext so decoding never opens a real output device or trips the
   * browser's autoplay gate.
   */
  public async decodeAudioFile(fileBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const OfflineCtx = window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const ctx = new OfflineCtx(1, 1, 44100);
    return await ctx.decodeAudioData(fileBuffer);
  }

  /**
   * Extract notes and cadence from decoded PCM (AudioBuffer or a plain channel list).
   */
  public async extractSongProject(
    source: AudioBuffer | PcmSource,
    songTitle: string = 'Canción Detectada',
    options: ExtractionOptions = {},
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    const report = (stage: string, ratio: number): void => {
      onProgress?.({ stage, ratio: Math.max(0, Math.min(1, ratio)) });
    };

    const channelData = this.toMono(source);
    const sampleRate = source.sampleRate;
    const totalDuration = source.duration;

    const threshold = options.threshold ?? 1.8;
    const minNoteDuration = options.minNoteDuration ?? 0.12;

    report('Buscando ataques…', 0.05);
    const candidates = this.detectOnsetsAndPitches(
      channelData,
      sampleRate,
      threshold,
      minNoteDuration,
      (ratio) => report('Buscando ataques…', 0.05 + ratio * 0.7)
    );

    report('Estimando tempo…', 0.78);
    let bpm = options.bpm;
    if (!bpm || options.autoBpm) {
      bpm = this.estimateBpmFromOnsets(candidates.map(c => c.time), totalDuration) || 85;
    }
    bpm = Math.max(SONG_LIMITS.bpmMin, Math.min(SONG_LIMITS.bpmMax, Math.round(bpm)));

    const beatDuration = 60 / bpm;
    const stepDuration = beatDuration / STEPS_PER_BEAT;
    const measureDuration = beatDuration * 4;
    const rawMeasures = Math.max(4, Math.ceil(totalDuration / measureDuration));
    const truncated = rawMeasures > SONG_LIMITS.measuresMax;
    const totalMeasures = Math.max(4, Math.min(SONG_LIMITS.measuresMax, rawMeasures));

    report('Cuantizando a la grilla…', 0.88);
    const gridOffset = this.estimateGridOffset(candidates.map(c => c.time), stepDuration);

    const notes: EditorNote[] = [];
    const chords: EditorChord[] = [];
    const occupiedSlots = new Set<string>();
    const occupiedChordSlots = new Set<string>();
    const idBase = Date.now();
    const chordColors: Record<string, string> = {
      Am: '#ea5b57', C: '#27ae60', Em: '#e67e22', G: '#aa22e6',
      D: '#3498db', Dm: '#9b59b6', F: '#1abc9c', E: '#f39c12'
    };

    let prevTab: { string: number; fret: number } | null = null;

    const groups = this.groupSimultaneous(candidates, 0.045);

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const time = group[0].time;
      const stepIndex = Math.max(0, Math.round((time - gridOffset) / stepDuration));
      const measure = Math.floor(stepIndex / STEPS_PER_MEASURE) + 1;
      const step = (stepIndex % STEPS_PER_MEASURE) + 1;
      if (measure > totalMeasures) continue;

      const nextTime = groups[g + 1]?.[0].time ?? time + beatDuration;
      const gapSteps = Math.round((nextTime - time) / stepDuration);
      const duration = Math.max(1, Math.min(STEPS_PER_BEAT * 2, gapSteps || 1));

      if (group.length >= 3) {
        const pcs = group.map(c => Math.round(69 + 12 * Math.log2(c.freq / 440)));
        const chordName = chordNameFromPitchClasses(pcs);
        const slot = `${measure}-${step}`;
        if (chordName && !occupiedChordSlots.has(slot)) {
          occupiedChordSlots.add(slot);
          chords.push({
            id: idBase + 80000 + chords.length,
            measure,
            beat: beatFromStep(step),
            chord: chordName,
            duration: Math.max(1, Math.round(duration / STEPS_PER_BEAT) || 1),
            color: chordColors[chordName] ?? '#ea5b57'
          });
        }
      }

      for (const cand of group) {
        const mapped = this.mapFrequencyToGuitarFret(cand.freq, prevTab);
        const tab: { string: number; fret: number; finger: number } = mapped ?? {
          string: cand.string,
          fret: cand.fret,
          finger: cand.finger
        };
        prevTab = { string: tab.string, fret: tab.fret };
        const slotKey = `${measure}-${step}-${tab.string}`;
        if (occupiedSlots.has(slotKey)) continue;
        occupiedSlots.add(slotKey);
        notes.push({
          id: idBase + notes.length,
          measure,
          beat: beatFromStep(step),
          step,
          duration,
          string: tab.string,
          fret: tab.fret,
          finger: tab.finger
        });
        if (notes.length >= SONG_LIMITS.notesMax) break;
      }
      if (notes.length >= SONG_LIMITS.notesMax) break;
    }

    notes.sort((a, b) => {
      if (a.measure !== b.measure) return a.measure - b.measure;
      return a.step - b.step;
    });

    report('Listo', 1);
    return {
      project: {
        title: songTitle.replace(/\.[^/.]+$/, ''),
        section: 'Transcripción',
        bpm,
        mode: chords.length > notes.length ? 'chords' : 'notes',
        measures: totalMeasures,
        notes,
        chords
      },
      truncated,
      rawMeasures
    };
  }

  private groupSimultaneous(candidates: ExtractedNoteCandidate[], windowSeconds: number): ExtractedNoteCandidate[][] {
    const groups: ExtractedNoteCandidate[][] = [];
    for (const cand of candidates) {
      const last = groups[groups.length - 1];
      if (last && cand.time - last[0].time <= windowSeconds) last.push(cand);
      else groups.push([cand]);
    }
    return groups;
  }

  /** Average the channels so a guitar panned to one side is not analysed at half strength. */
  private toMono(source: AudioBuffer | PcmSource): Float32Array {
    if ('getChannelData' in source) {
      const channels = source.numberOfChannels;
      const left = source.getChannelData(0);
      if (channels < 2) return left;
      const mono = new Float32Array(left.length);
      mono.set(left);
      for (let c = 1; c < channels; c++) {
        const data = source.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += data[i];
      }
      for (let i = 0; i < mono.length; i++) mono[i] /= channels;
      return mono;
    }

    const channels = source.channels;
    if (channels.length === 0) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    const mono = new Float32Array(channels[0].length);
    mono.set(channels[0]);
    for (let c = 1; c < channels.length; c++) {
      const data = channels[c];
      for (let i = 0; i < mono.length; i++) mono[i] += data[i];
    }
    for (let i = 0; i < mono.length; i++) mono[i] /= channels.length;
    return mono;
  }

  /**
   * Find attacks, then read the pitch just after each one.
   */
  private detectOnsetsAndPitches(
    buffer: Float32Array,
    sampleRate: number,
    threshold: number,
    minIntervalSeconds: number,
    onProgress?: (ratio: number) => void
  ): ExtractedNoteCandidate[] {
    const candidates: ExtractedNoteCandidate[] = [];
    const onsets = this.detectOnsets(buffer, sampleRate, threshold, minIntervalSeconds, (ratio) => {
      onProgress?.(ratio * 0.55);
    });

    for (let o = 0; o < onsets.length; o++) {
      const onsetSample = onsets[o];
      const pitches = this.detectPitchesAtOnset(buffer, sampleRate, onsetSample);
      onProgress?.(0.55 + ((o + 1) / Math.max(1, onsets.length)) * 0.45);

      for (const pitch of pitches) {
        const tab = this.mapFrequencyToGuitarFret(pitch.freq);
        if (!tab) continue;
        candidates.push({
          time: onsetSample / sampleRate,
          freq: pitch.freq,
          string: tab.string,
          fret: tab.fret,
          finger: tab.finger,
          confidence: pitch.confidence
        });
      }
    }

    return candidates;
  }

  /**
   * Iterative harmonic subtraction: peel the strongest F0 off the difference spectrum and
   * repeat, so a strum yields several notes instead of only the loudest partial.
   */
  private detectPitchesAtOnset(
    buffer: Float32Array,
    sampleRate: number,
    onsetSample: number
  ): Array<{ freq: number; confidence: number }> {
    const found = this.peelHarmonics(buffer, sampleRate, onsetSample);
    if (found.length > 0) return found;

    const size = AudioNoteExtractor.FFT_SIZE;
    const start = onsetSample + Math.floor(0.028 * sampleRate);
    if (start + size > buffer.length) return [];
    const fallback = this.detectPitchInSlice(buffer.subarray(start, start + size), sampleRate);
    return fallback ? [fallback] : [];
  }

  private peelHarmonics(
    buffer: Float32Array,
    sampleRate: number,
    onsetSample: number
  ): Array<{ freq: number; confidence: number }> {
    const size = AudioNoteExtractor.PITCH_FFT_SIZE;
    const bins = size / 2;
    const binHz = sampleRate / size;
    const postStart = onsetSample + Math.floor(0.012 * sampleRate);
    const preStart = onsetSample - Math.floor(0.006 * sampleRate) - size;
    if (postStart + size > buffer.length) return [];

    const diff = magnitudeSpectrum(buffer, postStart, size);
    if (preStart >= 0) {
      const pre = magnitudeSpectrum(buffer, preStart, size);
      for (let k = 0; k < bins; k++) {
        diff[k] = Math.max(0, diff[k] - pre[k]);
      }
    }

    let diffTotal = 0;
    for (let k = 1; k < bins; k++) diffTotal += diff[k];
    if (diffTotal <= 1e-6) return [];

    const results: Array<{ freq: number; confidence: number }> = [];

    for (let pass = 0; pass < 6; pass++) {
      const minConf = pass === 0 ? AudioNoteExtractor.MIN_ONSET_CONFIDENCE : 0.08;
      const picked = this.bestFundamental(diff, binHz, bins, diffTotal, minConf);
      if (!picked) break;
      if (results.some(r => {
        const cents = Math.abs(1200 * Math.log2(r.freq / picked.freq));
        return cents < 50 || Math.abs(cents - 1200) < 40 || Math.abs(cents - 2400) < 40;
      })) {
        this.subtractHarmonics(diff, picked.freq, binHz);
        continue;
      }
      if (results.length > 0 && picked.confidence < Math.max(0.12, results[0].confidence * 0.35)) break;
      results.push(picked);
      this.subtractHarmonics(diff, picked.freq, binHz);
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  private bestFundamental(
    diff: Float32Array,
    binHz: number,
    bins: number,
    diffTotal: number,
    minConfidence: number
  ): { freq: number; confidence: number } | null {
    const harmonics = 8;
    const totalCents = Math.round(1200 * Math.log2(AudioNoteExtractor.MAX_FREQ / AudioNoteExtractor.MIN_FREQ));
    let bestFreq = 0;
    let bestScore = 0;

    const scoreOf = (f0: number): number => {
      let score = 0;
      for (let h = 1; h <= harmonics; h++) {
        const bin = (f0 * h) / binHz;
        if (bin >= bins - 1) break;
        score += this.interpolateBin(diff, bin) / Math.sqrt(h);
      }
      return score;
    };

    for (let cents = 0; cents <= totalCents; cents += 10) {
      const f0 = AudioNoteExtractor.MIN_FREQ * Math.pow(2, cents / 1200);
      const score = scoreOf(f0);
      if (score > bestScore) {
        bestScore = score;
        bestFreq = f0;
      }
    }
    if (bestFreq <= 0) return null;

    const subOctave = bestFreq / 2;
    if (subOctave >= AudioNoteExtractor.MIN_FREQ && scoreOf(subOctave) > bestScore * 0.82) {
      bestFreq = subOctave;
    }

    let weightedSum = 0;
    let weightTotal = 0;
    for (let h = 1; h <= 4; h++) {
      const target = (bestFreq * h) / binHz;
      if (target >= bins - 2) break;
      const peak = this.refinePeak(diff, target, 0.04 * target + 1);
      if (!peak) continue;
      weightedSum += (peak.bin * binHz / h) * peak.magnitude;
      weightTotal += peak.magnitude;
    }

    const freq = weightTotal > 0 ? weightedSum / weightTotal : bestFreq;
    if (freq < AudioNoteExtractor.MIN_FREQ || freq > AudioNoteExtractor.MAX_FREQ) return null;

    const confidence = Math.min(1, scoreOf(freq) / diffTotal * 4);
    if (confidence < minConfidence) return null;
    return { freq, confidence };
  }

  private subtractHarmonics(diff: Float32Array, freq: number, binHz: number): void {
    for (let h = 1; h <= 8; h++) {
      const target = (freq * h) / binHz;
      const peak = this.refinePeak(diff, target, 0.04 * target + 1.5);
      if (!peak) continue;
      const center = Math.round(peak.bin);
      for (let k = center - 2; k <= center + 2; k++) {
        if (k > 0 && k < diff.length) {
          const dist = Math.abs(k - peak.bin);
          diff[k] *= dist > 1.2 ? 0.55 : 0.22;
        }
      }
    }
  }

  private interpolateBin(mag: Float32Array, position: number): number {
    if (position < 0 || position >= mag.length - 1) return 0;
    const i = Math.floor(position);
    const frac = position - i;
    return mag[i] * (1 - frac) + mag[i + 1] * frac;
  }

  /** Locate the strongest bin within `span` of `target` and interpolate its true position. */
  private refinePeak(mag: Float32Array, target: number, span: number): { bin: number; magnitude: number } | null {
    const lo = Math.max(1, Math.floor(target - span));
    const hi = Math.min(mag.length - 2, Math.ceil(target + span));
    if (hi <= lo) return null;

    let peak = lo;
    for (let k = lo; k <= hi; k++) {
      if (mag[k] > mag[peak]) peak = k;
    }
    if (mag[peak] <= 0) return null;

    const y0 = mag[peak - 1];
    const y1 = mag[peak];
    const y2 = mag[peak + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = Math.abs(denom) > 1e-12 ? (y0 - y2) / (2 * denom) : 0;
    return { bin: peak + Math.max(-0.5, Math.min(0.5, shift)), magnitude: y1 };
  }

  /**
   * Spectral flux onset detection with adaptive peak picking.
   *
   * A new note adds energy in bins that were previously quiet, so flux still spikes when a soft
   * note is plucked over a louder ringing tail. Overall RMS, which only rises when the new note
   * is louder than what is already sounding, silently drops those notes in arpeggios and legato
   * passages. Returns onset positions in samples.
   */
  public detectOnsets(
    buffer: Float32Array,
    sampleRate: number,
    sensitivity: number,
    minIntervalSeconds: number,
    onFrame?: (ratio: number) => void
  ): number[] {
    const frameSize = AudioNoteExtractor.FFT_SIZE;
    const hop = AudioNoteExtractor.FFT_HOP;
    const numFrames = Math.floor((buffer.length - frameSize) / hop) + 1;
    if (numFrames < 4) return [];

    const bins = frameSize / 2;
    const window = hannWindow(frameSize);
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    const prevMag = new Float32Array(bins);
    const flux = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hop;
      for (let i = 0; i < frameSize; i++) {
        re[i] = buffer[offset + i] * window[i];
        im[i] = 0;
      }
      fft(re, im);

      let sum = 0;
      for (let k = 1; k < bins; k++) {
        // Log compression keeps a quiet note from being swamped by a loud one.
        const mag = Math.log1p(1000 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
        const rise = mag - prevMag[k];
        if (rise > 0) sum += rise;
        prevMag[k] = mag;
      }
      flux[f] = sum;
      if (onFrame && (f % 32 === 0 || f === numFrames - 1)) onFrame(f / numFrames);
    }

    let maxFlux = 0;
    for (let f = 0; f < numFrames; f++) maxFlux = Math.max(maxFlux, flux[f]);
    if (maxFlux <= 0) return [];
    for (let f = 0; f < numFrames; f++) flux[f] /= maxFlux;

    const meanMultiplier = this.fluxMeanMultiplier(sensitivity);

    const peakSpan = 3;
    const meanSpan = 12;
    const minGapFrames = Math.max(1, Math.round((minIntervalSeconds * sampleRate) / hop));

    const onsets: number[] = [];
    let lastFrame = -minGapFrames;

    for (let f = 1; f < numFrames - 1; f++) {
      let isLocalMax = true;
      for (let k = Math.max(0, f - peakSpan); k <= Math.min(numFrames - 1, f + peakSpan); k++) {
        if (flux[k] > flux[f]) { isLocalMax = false; break; }
      }
      if (!isLocalMax) continue;
      if (f - lastFrame < minGapFrames) continue;

      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, f - meanSpan); k <= Math.min(numFrames - 1, f + peakSpan); k++) {
        sum += flux[k];
        count++;
      }
      if (flux[f] < (sum / count) * meanMultiplier + 0.01) continue;

      lastFrame = f;
      onsets.push(f * hop);
    }

    return onsets;
  }

  /**
   * Values >= 0.8 are the spectral-flux mean multiplier used by the UI.
   * Smaller values are the old amplitude-delta scale and get remapped so existing tests still pass.
   */
  private fluxMeanMultiplier(sensitivity: number): number {
    if (sensitivity >= 0.8) return Math.max(1.2, Math.min(4, sensitivity));
    const clamped = Math.max(0.005, Math.min(0.12, sensitivity));
    return 1.25 + clamped * 25;
  }

  /**
   * McLeod pitch method: normalized square difference function plus peak picking.
   *
   * The normalization matters. A plain autocorrelation sum has fewer terms at long lags, so it
   * is biased toward short periods and reports notes an octave too high; the NSDF divides that
   * bias out. Taking the earliest peak within PEAK_CUTOFF_RATIO of the best one then guards the
   * opposite error, latching onto twice the true period.
   */
  public detectPitchInSlice(buffer: Float32Array, sampleRate: number): { freq: number; confidence: number } | null {
    const size = buffer.length;

    // Prefix sums of squares turn each lag's energy terms into O(1) lookups.
    const prefix = new Float64Array(size + 1);
    for (let i = 0; i < size; i++) {
      prefix[i + 1] = prefix[i] + buffer[i] * buffer[i];
    }
    if (prefix[size] < 0.0005) return null;

    const minPeriod = Math.max(2, Math.floor(sampleRate / AudioNoteExtractor.MAX_FREQ));
    const maxPeriod = Math.min(size - 2, Math.floor(sampleRate / AudioNoteExtractor.MIN_FREQ));
    if (maxPeriod <= minPeriod) return null;

    // Start at lag 1, not at minPeriod: peak picking has to discard the lobe around lag 0,
    // and starting mid-lobe would throw away the true fundamental for high notes instead.
    const nsdf = new Float32Array(maxPeriod + 2);
    for (let tau = 1; tau <= maxPeriod; tau++) {
      const n = size - tau;
      let ac = 0;
      for (let i = 0; i < n; i++) {
        ac += buffer[i] * buffer[i + tau];
      }
      const energy = (prefix[n] - prefix[0]) + (prefix[size] - prefix[tau]);
      nsdf[tau] = energy > 0 ? (2 * ac) / energy : 0;
    }

    // Collect the maximum of each positive lobe, skipping the lobe around lag 0.
    const peaks: number[] = [];
    let i = 1;
    while (i <= maxPeriod && nsdf[i] > 0) i++;
    while (i <= maxPeriod) {
      while (i <= maxPeriod && nsdf[i] <= 0) i++;
      if (i > maxPeriod) break;
      let best = i;
      while (i <= maxPeriod && nsdf[i] > 0) {
        if (nsdf[i] > nsdf[best]) best = i;
        i++;
      }
      if (best >= minPeriod) peaks.push(best);
    }
    if (peaks.length === 0) return null;

    let maxValue = 0;
    for (const p of peaks) maxValue = Math.max(maxValue, nsdf[p]);
    if (maxValue < AudioNoteExtractor.MIN_CLARITY) return null;

    const cutoff = maxValue * AudioNoteExtractor.PEAK_CUTOFF_RATIO;
    const chosen = peaks.find(p => nsdf[p] >= cutoff) ?? peaks[0];

    // Parabolic interpolation: an integer period is up to ~26 cents off in the top octave,
    // which is enough to pick the wrong fret.
    const y0 = nsdf[chosen - 1];
    const y1 = nsdf[chosen];
    const y2 = nsdf[chosen + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = Math.abs(denom) > 1e-12 ? (y0 - y2) / (2 * denom) : 0;
    const period = chosen + Math.max(-1, Math.min(1, shift));
    if (period <= 0) return null;

    const freq = sampleRate / period;
    if (freq < AudioNoteExtractor.MIN_FREQ || freq > AudioNoteExtractor.MAX_FREQ) return null;

    return { freq, confidence: Math.min(1, maxValue) };
  }

  /**
   * Map a frequency (Hz) to the most ergonomic guitar string (1-6), fret (0-12) and finger (0-4)
   * Prioritizes lower positions (frets 0 to 5) which are standard for tutorial melodies like Coco
   */
  public mapFrequencyToGuitarFret(
    freq: number,
    previous?: { string: number; fret: number } | null
  ): { string: number; fret: number; finger: number } | null {
    let bestMatch: { string: number; fret: number; finger: number } | null = null;
    let minWeightedScore = Infinity;

    // Evaluate strings starting with highest (1 to 6)
    for (let s = 1; s <= 6; s++) {
      const baseF = this.baseFrequencies[s];
      // Check frets 0 to 12
      for (let f = 0; f <= 12; f++) {
        const expectedF = baseF * Math.pow(2, f / 12);
        const cents = Math.abs(1200 * Math.log2(freq / expectedF));

        if (cents < 45) {
          // Weight penalty for higher frets so the algorithm prefers 1st position (frets 0-4).
          // The same pitch often sits at the same distance in tune on two strings (C4 is string 2
          // fret 1 and string 3 fret 5), so the penalty has to grow from the very first fret to
          // break that tie; the extra term past fret 5 pushes harder out of upper positions.
          const fretPenalty = f * 1.5 + (f > 5 ? (f - 5) * 8 : 0);
          const jumpPenalty = previous
            ? Math.abs(f - previous.fret) * 1.8 + Math.abs(s - previous.string) * 2.5
            : 0;
          const weightedScore = cents + fretPenalty + jumpPenalty;

          if (weightedScore < minWeightedScore) {
            minWeightedScore = weightedScore;
            bestMatch = { string: s, fret: f, finger: this.fingerForFret(f) };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Suggest a finger for a fret (0 = open, 1-4 = index to pinky).
   *
   * Fingering is relative to where the hand sits, not to the absolute fret number: the hand
   * shifts up a position roughly every four frets, so fret 5 is an index finger, not a pinky.
   */
  private fingerForFret(fret: number): number {
    if (fret <= 0) return 0;
    return ((fret - 1) % 4) + 1;
  }

  /**
   * Estimate song BPM from onset time intervals
   */
  private estimateBpmFromOnsets(onsetTimes: number[], totalDuration: number): number {
    if (onsetTimes.length < 4) return 85;

    const intervals: number[] = [];
    for (let i = 1; i < onsetTimes.length; i++) {
      const diff = onsetTimes[i] - onsetTimes[i - 1];
      if (diff >= 0.08 && diff <= 2.0) {
        intervals.push(diff);
      }
    }

    if (intervals.length === 0) {
      // Fallback: note count over duration
      const avgRate = (onsetTimes.length / totalDuration) * 60;
      return Math.max(60, Math.min(140, Math.round(avgRate / 2)));
    }

    // Median interval
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];

    // The median gap is whatever note value dominates the piece, not necessarily the beat.
    // Try the beat at that gap and at simple multiples of it, and keep whichever explains the
    // onsets best once everything is folded into a sensible tempo range.
    let best = 85;
    let bestScore = -Infinity;
    for (const factor of [0.25, 0.5, 1, 2, 4]) {
      let bpm = 60 / (medianInterval * factor);
      while (bpm < 65) bpm *= 2;
      while (bpm > 140) bpm /= 2;

      const score = this.gridFitScore(onsetTimes, 60 / bpm / STEPS_PER_BEAT);
      if (score > bestScore) {
        bestScore = score;
        best = bpm;
      }
    }

    // Onset times are only accurate to one analysis hop, so the median gap lands a few BPM off.
    // Sweep whole BPM values nearby and keep the one the onsets actually fit best.
    const coarse = Math.round(best);
    for (let bpm = coarse - 6; bpm <= coarse + 6; bpm++) {
      if (bpm < SONG_LIMITS.bpmMin || bpm > SONG_LIMITS.bpmMax) continue;
      const score = this.gridFitScore(onsetTimes, 60 / bpm / STEPS_PER_BEAT);
      if (score > bestScore) {
        bestScore = score;
        best = bpm;
      }
    }

    return Math.round(best);
  }

  /**
   * How cleanly the onsets land on a grid of the given step, from 0 (worst) to 1 (perfect).
   * Scored at the best phase offset so a recording with a lead-in is not penalised.
   */
  private gridFitScore(onsetTimes: number[], stepDuration: number): number {
    if (onsetTimes.length === 0 || stepDuration <= 0) return 0;
    const offset = this.estimateGridOffset(onsetTimes, stepDuration);

    let error = 0;
    for (const t of onsetTimes) {
      const position = (t - offset) / stepDuration;
      error += Math.abs(position - Math.round(position));
    }
    // Mean error runs from 0 (on grid) to 0.5 (uniformly off grid).
    return 1 - (error / onsetTimes.length) / 0.5;
  }

  /**
   * Find the phase offset that best aligns the grid with the performance, so a track with
   * silence or a count-in before the first note is not shifted by a sixteenth throughout.
   */
  private estimateGridOffset(onsetTimes: number[], stepDuration: number): number {
    if (onsetTimes.length === 0 || stepDuration <= 0) return 0;

    const trials = 32;
    let bestOffset = 0;
    let bestError = Infinity;

    for (let t = 0; t < trials; t++) {
      const offset = (t / trials) * stepDuration;
      let error = 0;
      for (const time of onsetTimes) {
        const position = (time - offset) / stepDuration;
        error += Math.abs(position - Math.round(position));
      }
      if (error < bestError) {
        bestError = error;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }
}

export const audioExtractor = new AudioNoteExtractor();
