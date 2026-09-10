import type { EditorNote, SongProject } from '../types/editor.types';
import { beatFromStep, STEPS_PER_BEAT, STEPS_PER_MEASURE } from '../rhythm';
import { SONG_LIMITS } from '../songSafety';
import { fft, hannWindow, magnitudeSpectrum } from './fft';

export interface ExtractionOptions {
  bpm?: number;
  threshold?: number; // 0.01 to 0.1 sensitivity
  minNoteDuration?: number; // seconds
  autoBpm?: boolean;
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
   * Extract notes and cadence from an AudioBuffer
   */
  public async extractSongProject(
    audioBuffer: AudioBuffer,
    songTitle: string = 'Canción Detectada',
    options: ExtractionOptions = {}
  ): Promise<SongProject> {
    const channelData = this.toMono(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const totalDuration = audioBuffer.duration;

    const threshold = options.threshold ?? 0.04;
    const minNoteDuration = options.minNoteDuration ?? 0.12; // at least 120ms between notes

    // 1. Detect Onsets & Pitches across the timeline
    const candidates = this.detectOnsetsAndPitches(channelData, sampleRate, threshold, minNoteDuration);

    // 2. Estimate BPM and Cadence
    let bpm = options.bpm;
    if (!bpm || options.autoBpm) {
      bpm = this.estimateBpmFromOnsets(candidates.map(c => c.time), totalDuration) || 85;
    }
    bpm = Math.max(SONG_LIMITS.bpmMin, Math.min(SONG_LIMITS.bpmMax, Math.round(bpm)));

    const beatDuration = 60 / bpm;
    const stepDuration = beatDuration / STEPS_PER_BEAT;
    const measureDuration = beatDuration * 4;
    const totalMeasures = Math.max(
      4,
      Math.min(SONG_LIMITS.measuresMax, Math.ceil(totalDuration / measureDuration))
    );

    // 3. Quantize onto the sixteenth-note grid the editor uses, aligning the grid to the
    //    performance instead of assuming the recording starts exactly on beat one.
    const gridOffset = this.estimateGridOffset(candidates.map(c => c.time), stepDuration);

    const notes: EditorNote[] = [];
    const occupiedSlots = new Set<string>();
    const idBase = Date.now();

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const stepIndex = Math.max(0, Math.round((cand.time - gridOffset) / stepDuration));
      const measure = Math.floor(stepIndex / STEPS_PER_MEASURE) + 1;
      const step = (stepIndex % STEPS_PER_MEASURE) + 1;

      if (measure > totalMeasures) continue;

      const slotKey = `${measure}-${step}-${cand.string}`;
      if (occupiedSlots.has(slotKey)) continue;
      occupiedSlots.add(slotKey);

      // Hold the note until the next attack, so eighths read as eighths and a held note
      // is not drawn as a sixteenth.
      const nextTime = candidates[i + 1]?.time ?? cand.time + beatDuration;
      const gapSteps = Math.round((nextTime - cand.time) / stepDuration);
      const duration = Math.max(1, Math.min(STEPS_PER_BEAT * 2, gapSteps || 1));

      notes.push({
        id: idBase + i,
        measure,
        beat: beatFromStep(step),
        step,
        duration,
        string: cand.string,
        fret: cand.fret,
        finger: cand.finger
      });

      if (notes.length >= SONG_LIMITS.notesMax) break;
    }

    notes.sort((a, b) => {
      if (a.measure !== b.measure) return a.measure - b.measure;
      return a.step - b.step;
    });

    return {
      title: songTitle.replace(/\.[^/.]+$/, ''),
      section: 'Transcripción',
      bpm,
      mode: 'notes',
      measures: totalMeasures,
      notes,
      chords: []
    };
  }

  /** Average the channels so a guitar panned to one side is not analysed at half strength. */
  private toMono(audioBuffer: AudioBuffer): Float32Array {
    const channels = audioBuffer.numberOfChannels;
    const left = audioBuffer.getChannelData(0);
    if (channels < 2) return left;

    const mono = new Float32Array(left.length);
    mono.set(left);
    for (let c = 1; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i];
    }
    for (let i = 0; i < mono.length; i++) mono[i] /= channels;
    return mono;
  }

  /**
   * Find attacks, then read the pitch just after each one.
   */
  private detectOnsetsAndPitches(
    buffer: Float32Array,
    sampleRate: number,
    threshold: number,
    minIntervalSeconds: number
  ): ExtractedNoteCandidate[] {
    const candidates: ExtractedNoteCandidate[] = [];
    const onsets = this.detectOnsets(buffer, sampleRate, threshold, minIntervalSeconds);

    for (const onsetSample of onsets) {
      const pitch = this.detectPitchAtOnset(buffer, sampleRate, onsetSample);
      if (!pitch) continue;

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

    return candidates;
  }

  /**
   * Read the pitch of the note that starts at an onset, ignoring whatever is still ringing.
   *
   * Any monophonic detector fed a mixture of two notes returns a compromise between them, so a
   * melody note struck while the previous one sustains comes out wrong no matter where the
   * analysis window sits. Subtracting the spectrum just before the attack from the spectrum just
   * after leaves only the partials that grew, which belong to the new note; a harmonic sum over
   * that difference then finds its fundamental even when it is quieter than the tail.
   */
  private detectPitchAtOnset(
    buffer: Float32Array,
    sampleRate: number,
    onsetSample: number
  ): { freq: number; confidence: number } | null {
    const spectral = this.detectPitchFromSpectralDifference(buffer, sampleRate, onsetSample);
    if (spectral) return spectral;

    // An inconclusive difference spectrum almost always means the string was struck again on
    // the same note, so the attack added no partials that were not already sounding. That is
    // the one case a monophonic detector reads correctly, because there is only one pitch.
    const size = AudioNoteExtractor.FFT_SIZE;
    const start = onsetSample + Math.floor(0.028 * sampleRate);
    if (start + size > buffer.length) return null;
    return this.detectPitchInSlice(buffer.subarray(start, start + size), sampleRate);
  }

  private detectPitchFromSpectralDifference(
    buffer: Float32Array,
    sampleRate: number,
    onsetSample: number
  ): { freq: number; confidence: number } | null {
    const size = AudioNoteExtractor.PITCH_FFT_SIZE;
    const bins = size / 2;
    const binHz = sampleRate / size;

    // Let the broadband pluck noise pass before measuring, and leave a small guard before the
    // attack so the "before" frame holds none of the new note.
    const postStart = onsetSample + Math.floor(0.012 * sampleRate);
    const preStart = onsetSample - Math.floor(0.006 * sampleRate) - size;
    if (postStart + size > buffer.length) return null;

    // Reduced in place into the difference spectrum: only the partials that grew at the attack.
    const diff = magnitudeSpectrum(buffer, postStart, size);
    if (preStart >= 0) {
      const pre = magnitudeSpectrum(buffer, preStart, size);
      for (let k = 0; k < bins; k++) {
        diff[k] = Math.max(0, diff[k] - pre[k]);
      }
    }

    let diffTotal = 0;
    for (let k = 1; k < bins; k++) diffTotal += diff[k];
    if (diffTotal <= 1e-6) return null;

    // Coarse search on a 10 cent grid over the guitar range.
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

    // A harmonic sum also scores well one octave up, where every partial it looks at is a
    // partial of the true note. Prefer the sub-octave whenever it explains the spectrum too.
    const subOctave = bestFreq / 2;
    if (subOctave >= AudioNoteExtractor.MIN_FREQ && scoreOf(subOctave) > bestScore * 0.82) {
      bestFreq = subOctave;
    }

    // Refine against the actual partial peaks: the h-th harmonic locates the fundamental h times
    // more precisely than the fundamental's own bin does.
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

    // Share of the new energy explained by this note's harmonic series.
    const confidence = Math.min(1, scoreOf(freq) / diffTotal * 4);
    if (confidence < AudioNoteExtractor.MIN_ONSET_CONFIDENCE) return null;

    return { freq, confidence };
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
    minIntervalSeconds: number
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
    }

    let maxFlux = 0;
    for (let f = 0; f < numFrames; f++) maxFlux = Math.max(maxFlux, flux[f]);
    if (maxFlux <= 0) return [];
    for (let f = 0; f < numFrames; f++) flux[f] /= maxFlux;

    // The sensitivity select still hands us the old amplitude-delta values (0.012 to 0.07);
    // map them onto how far above the local average a peak has to stand.
    const clamped = Math.max(0.005, Math.min(0.12, sensitivity));
    const meanMultiplier = 1.25 + clamped * 25;

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
  public mapFrequencyToGuitarFret(freq: number): { string: number; fret: number; finger: number } | null {
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
          const weightedScore = cents + fretPenalty;

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
