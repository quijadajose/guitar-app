import { guitarAudio } from '../audio/audioEngine';
import { chordMatchesChroma } from '../audio/chords';
import {
  averageChromas,
  cloneProfile,
  DEFAULT_SESSION_PROFILE,
  deriveSessionProfile
} from '../audio/sessionProfile';
import type { PitchMatchResult } from '../types/audio.types';
import { gameplayEngine } from './gameplay';

interface CalibPrompt {
  kind: 'chord' | 'note';
  name: string;
  string?: number;
  fret?: number;
}

const NOISE_MS = 1100;
const CAPTURE_MS = 420;
const MAX_CHROMA_FRAMES = 8;
const MAX_CHORD_PROMPTS = 4;

const CHORD_NUT: Record<string, Array<'O' | 'X' | ''>> = {
  Am: ['O', '', '', '', 'O', 'X'],
  C: ['O', '', '', '', '', 'X'],
  Em: ['O', 'O', 'O', '', '', ''],
  G: ['', 'O', 'O', '', '', ''],
  D: ['O', '', '', '', 'X', 'X'],
  Dm: ['O', '', '', '', 'X', 'X'],
  F: ['', '', '', '', '', 'X'],
  E: ['O', 'O', 'O', '', '', '']
};

export class SessionCalibrator {
  public isActive = false;

  private overlay: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private svgEl: SVGElement | null = null;
  private nutEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private dots: HTMLElement[] = [];

  private phase: 'idle' | 'noise' | 'prompt' = 'idle';
  private prompts: CalibPrompt[] = [];
  private promptIndex = 0;
  private noiseStartedAt = 0;
  private noiseSamples: number[] = [];
  private strumSamples: number[] = [];
  private playerChromas: Record<string, Float32Array> = {};
  private capturing = false;
  private captureUntil = 0;
  private captureChromas: Float32Array[] = [];
  private onFinished: (() => void) | null = null;

  public bind(): void {
    this.overlay = document.getElementById('gameplay-calib-overlay');
    this.titleEl = document.getElementById('calib-title');
    this.hintEl = document.getElementById('calib-hint');
    this.counterEl = document.getElementById('calib-counter');
    this.nameEl = document.getElementById('calib-chord-name');
    this.svgEl = document.querySelector('#calib-chord-svg');
    this.nutEl = document.getElementById('calib-nut');
    this.cardEl = document.getElementById('calib-chord-card');
    this.dots = Array.from(document.querySelectorAll('#calib-mic-dots .calib-mic-dot'));

    document.getElementById('calib-skip-btn')?.addEventListener('click', () => this.skip());
  }

  public start(onFinished: () => void): void {
    this.abort(false);
    this.onFinished = onFinished;
    this.isActive = true;
    gameplayEngine.isCalibrating = true;
    gameplayEngine.pausePlaying();
    gameplayEngine.cancelCountdown();
    guitarAudio.applySessionProfile(cloneProfile(DEFAULT_SESSION_PROFILE));

    this.prompts = this.buildPrompts();
    this.promptIndex = 0;
    this.noiseSamples = [];
    this.strumSamples = [];
    this.playerChromas = {};
    this.capturing = false;
    this.phase = 'noise';
    this.noiseStartedAt = performance.now();

    if (this.overlay) this.overlay.hidden = false;
    this.renderNoise();
  }

  public abort(keepOverlayHidden = true): void {
    this.isActive = false;
    this.phase = 'idle';
    this.capturing = false;
    this.onFinished = null;
    gameplayEngine.isCalibrating = false;
    if (keepOverlayHidden && this.overlay) this.overlay.hidden = true;
  }

  public skip(): void {
    if (!this.isActive) return;
    guitarAudio.applySessionProfile(cloneProfile(DEFAULT_SESSION_PROFILE));
    this.finish();
  }

  public feed(data: PitchMatchResult): void {
    if (!this.isActive) return;
    this.updateMeter(data.rms);

    if (this.phase === 'noise') {
      this.noiseSamples.push(data.rms);
      if (performance.now() - this.noiseStartedAt >= NOISE_MS) {
        this.enterPrompt(0);
      }
      return;
    }

    if (this.phase !== 'prompt') return;
    const prompt = this.prompts[this.promptIndex];
    if (!prompt) {
      this.commitAndFinish();
      return;
    }

    if (this.capturing) {
      if (data.chroma) this.captureChromas.push(new Float32Array(data.chroma));
      if (data.rms > 0) this.strumSamples.push(data.rms);
      if (this.captureChromas.length >= MAX_CHROMA_FRAMES || performance.now() >= this.captureUntil) {
        this.storeCapture(prompt);
        this.enterPrompt(this.promptIndex + 1);
      }
      return;
    }

    if (!data.isOnset) return;
    if (prompt.kind === 'chord') {
      if (!chordMatchesChroma(prompt.name, data.freq ?? 0, data.chroma)) return;
    } else if (!(data.freq && data.freq > 0)) {
      return;
    }

    this.capturing = true;
    this.captureUntil = performance.now() + CAPTURE_MS;
    this.captureChromas = data.chroma ? [new Float32Array(data.chroma)] : [];
    if (data.rms > 0) this.strumSamples.push(data.rms);
    this.cardEl?.classList.add('calib-heard');
  }

  private buildPrompts(): CalibPrompt[] {
    if (gameplayEngine.mode === 'chords') {
      const names: string[] = [];
      for (const chord of gameplayEngine.chordsTrack) {
        if (!names.includes(chord.chord)) names.push(chord.chord);
        if (names.length >= MAX_CHORD_PROMPTS) break;
      }
      if (names.length === 0) names.push('Am');
      return names.map(name => ({ kind: 'chord', name }));
    }

    const first = gameplayEngine.notesTrack[0];
    if (first) {
      return [{ kind: 'note', name: `${first.string}ª cuerda traste ${first.fret}`, string: first.string, fret: first.fret }];
    }
    return [{ kind: 'note', name: 'una cuerda' }];
  }

  private enterPrompt(index: number): void {
    this.capturing = false;
    this.cardEl?.classList.remove('calib-heard');
    this.promptIndex = index;
    if (index >= this.prompts.length) {
      this.commitAndFinish();
      return;
    }
    this.phase = 'prompt';
    this.renderPrompt();
  }

  private storeCapture(prompt: CalibPrompt): void {
    if (prompt.kind === 'chord' && this.captureChromas.length > 0) {
      this.playerChromas[prompt.name] = averageChromas(this.captureChromas);
    }
  }

  private commitAndFinish(): void {
    const profile = deriveSessionProfile(this.noiseSamples, this.strumSamples, this.playerChromas);
    guitarAudio.applySessionProfile(profile);
    this.finish();
  }

  private finish(): void {
    const done = this.onFinished;
    this.abort(true);
    done?.();
  }

  private renderNoise(): void {
    if (this.titleEl) this.titleEl.textContent = 'Silencio un segundo';
    if (this.hintEl) this.hintEl.textContent = 'Así medimos el ruido de la habitación antes de tu guitarra.';
    if (this.counterEl) this.counterEl.textContent = '';
    if (this.nameEl) this.nameEl.textContent = '…';
    this.paintNut([]);
    this.clearDots();
  }

  private renderPrompt(): void {
    const prompt = this.prompts[this.promptIndex];
    const total = this.prompts.length;
    const step = this.promptIndex + 1;
    if (this.counterEl) this.counterEl.textContent = `${step}/${total}`;

    if (prompt.kind === 'chord') {
      if (this.titleEl) this.titleEl.textContent = 'Toca los acordes antes de comenzar la canción';
      if (this.hintEl) this.hintEl.textContent = 'Un rasgueo claro. Así escuchamos cómo suena tu guitarra hoy.';
      if (this.nameEl) this.nameEl.textContent = prompt.name;
      this.paintNut(CHORD_NUT[prompt.name] ?? []);
      this.paintDots(prompt.name);
    } else {
      if (this.titleEl) this.titleEl.textContent = 'Tocá una nota para ajustar el micrófono';
      if (this.hintEl) this.hintEl.textContent = 'Cualquier cuerda sirve. Medimos qué tan fuerte llega tu guitarra.';
      if (this.nameEl) this.nameEl.textContent = prompt.name;
      this.paintNut([]);
      this.clearDots();
    }
  }

  private paintNut(marks: Array<'O' | 'X' | ''>): void {
    if (!this.nutEl) return;
    this.nutEl.replaceChildren();
    for (let i = 0; i < 6; i++) {
      const span = document.createElement('span');
      span.className = 'calib-nut-mark';
      span.textContent = marks[i] ?? '';
      this.nutEl.appendChild(span);
    }
  }

  private paintDots(chordName: string): void {
    if (!this.svgEl) return;
    this.svgEl.querySelectorAll('.calib-finger-dot').forEach(dot => dot.remove());
    const diagram = gameplayEngine.chordDiagrams[chordName];
    if (!diagram) return;
    for (const d of diagram.dots) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'calib-finger-dot');
      circle.setAttribute('cx', String(d.cx));
      circle.setAttribute('cy', String(d.cy));
      circle.setAttribute('r', '7');
      circle.setAttribute('fill', d.color);
      this.svgEl.appendChild(circle);
    }
  }

  private clearDots(): void {
    this.svgEl?.querySelectorAll('.calib-finger-dot').forEach(dot => dot.remove());
  }

  private updateMeter(rms: number): void {
    const scale = Math.max(this.strumSamples.length ? 0.08 : 0.03, 0.02);
    const lit = Math.max(0, Math.min(this.dots.length, Math.round((rms / scale) * this.dots.length)));
    this.dots.forEach((dot, i) => {
      dot.classList.toggle('active', i < lit);
    });
  }
}

export const sessionCalibrator = new SessionCalibrator();
