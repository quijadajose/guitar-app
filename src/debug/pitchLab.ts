import { guitarAudio } from '../audio/audioEngine';
import type { PitchMatchResult } from '../types/audio.types';

/**
 * Modo debug: recorre cuerda × traste, escucha cada nota y anota qué detectó el algoritmo.
 * El log de texto está pensado para copiarlo y pegarlo en un chat; el JSON trae las trazas completas.
 */

const OPEN_MIDI: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LISTEN_MS = 2000;
const TIMEOUT_MS = 8000;
const SILENCE_MS = 3000;

interface Frame {
  t: number;
  rms: number;
  freq: number | null;
  onset: boolean;
  str: number | null;
  fret: number | null;
}

interface Target {
  string: number;
  fret: number;
  midi: number;
  freq: number;
  name: string;
}

interface Result {
  target: Target;
  status: 'ok' | 'octava' | 'mal' | 'inestable' | 'sin-sonido' | 'saltado';
  medianHz: number | null;
  detected: string | null;
  centsOff: number | null;
  voicedPct: number;
  correctPct: number;
  firstCorrectMs: number | null;
  spreadCents: number | null;
  peakRms: number;
  topFretMatch: string | null;
  frames: Frame[];
}

const midiFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const midiName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function buildTargets(strings: number[], maxFret: number): Target[] {
  const out: Target[] = [];
  for (const s of strings) {
    for (let f = 0; f <= maxFret; f++) {
      const midi = OPEN_MIDI[s] + f;
      out.push({ string: s, fret: f, midi, freq: midiFreq(midi), name: midiName(midi) });
    }
  }
  return out;
}

class PitchLab {
  private root: HTMLElement | null = null;
  private targets: Target[] = [];
  private index = 0;
  private results = new Map<number, Result>();
  private noise: { medianRms: number; peakRms: number; falseNotes: string[]; frames: Frame[] } | null = null;
  private mode: 'idle' | 'silence' | 'waiting' | 'listening' = 'idle';
  private frames: Frame[] = [];
  private phaseStart = 0;
  private soundStart = 0;
  private timer = 0;
  private live = { rms: 0, freq: null as number | null };
  private raf = 0;
  private userAgent = navigator.userAgent;
  private framesSeen = 0;
  private micOk = false;
  private zeroSince = 0;
  private restarts = 0;
  private diag: Record<string, unknown>[] = [];

  public bind(): void {
    document.getElementById('btn-pitch-lab')?.addEventListener('click', () => void this.open());
  }

  private async open(): Promise<void> {
    this.render();
    this.framesSeen = 0;
    this.restarts = 0;
    this.diag = [];
    const ok = await this.startMic();
    if (!ok) {
      this.setStatus('No se pudo abrir el micrófono. Revisá los permisos del navegador.');
      return;
    }
    const tick = () => {
      this.drawLive();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private async startMic(): Promise<boolean> {
    const before = await guitarAudio.ensureRunning();
    const ok = await guitarAudio.startMicrophonePitchTracking(this.onPitch);
    const after = await guitarAudio.ensureRunning();
    this.micOk = ok;
    this.zeroSince = 0;
    this.diag.push({ at: Math.round(performance.now()), ctxAntes: before, ctxDespues: after, ok, ...guitarAudio.getDiagnostics() });
    return ok;
  }

  /** Si el micrófono entrega silencio digital absoluto, lo reabre una vez (Android a veces lo deja mudo). */
  private async restartMic(): Promise<void> {
    this.restarts++;
    this.setStatus('El micrófono entrega ceros: reintentando…');
    guitarAudio.detachPitchListener(this.onPitch);
    guitarAudio.releaseMicrophone();
    await this.startMic();
  }

  private close(): void {
    this.mode = 'idle';
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    guitarAudio.detachPitchListener(this.onPitch);
    guitarAudio.releaseMicrophone();
    this.root?.remove();
    this.root = null;
  }

  // ---------------------------------------------------------------- audio

  private onPitch = (d: PitchMatchResult): void => {
    if (!d) return;
    this.live = { rms: d.rms, freq: d.freq };
    this.framesSeen++;
    if (d.rms === 0) {
      const now0 = performance.now();
      if (!this.zeroSince) this.zeroSince = now0;
      else if (now0 - this.zeroSince > 1500) {
        this.zeroSince = 0;
        if (this.restarts < 1) void this.restartMic();
        else this.setStatus('El micrófono sigue entregando ceros. ¿Otra app o pestaña lo está usando? Copiá el log.');
      }
    } else {
      this.zeroSince = 0;
    }
    if (this.mode === 'idle') return;
    const now = performance.now();
    const frame: Frame = {
      t: 0,
      rms: +d.rms.toFixed(4),
      freq: d.freq ? +d.freq.toFixed(1) : null,
      onset: d.isOnset,
      str: d.fretMatch?.string ?? d.stringMatch?.string ?? null,
      fret: d.fretMatch?.fret ?? null
    };

    if (this.mode === 'silence') {
      frame.t = Math.round(now - this.phaseStart);
      this.frames.push(frame);
      if (now - this.phaseStart >= SILENCE_MS) this.finishSilence();
      return;
    }

    if (this.mode === 'waiting') {
      // Arranca a contar cuando hay ataque o una lectura con nota.
      const baseline = this.noise ? this.noise.peakRms * 1.5 : 0;
      if ((d.isOnset && d.rms > baseline) || (d.freq && d.rms > baseline)) {
        this.mode = 'listening';
        this.soundStart = now;
        this.frames = [];
      } else {
        return;
      }
    }

    frame.t = Math.round(now - this.soundStart);
    this.frames.push(frame);
    if (now - this.soundStart >= LISTEN_MS) this.finishTarget();
  };

  // ---------------------------------------------------------------- flow

  private start(): void {
    const strings = Array.from(this.root!.querySelectorAll<HTMLInputElement>('[data-lab-string]:checked'))
      .map(el => Number(el.dataset.labString));
    const maxFret = Math.max(0, Math.min(19, Number((this.q('#lab-max-fret') as HTMLInputElement).value) || 0));
    if (!strings.length) {
      this.setStatus('Elegí al menos una cuerda.');
      return;
    }
    this.targets = buildTargets(strings.sort((a, b) => a - b), maxFret);
    this.index = 0;
    this.results.clear();
    this.q('#lab-setup')!.hidden = true;
    this.q('#lab-run')!.hidden = false;
    this.beginSilence();
  }

  private beginSilence(): void {
    this.mode = 'silence';
    this.frames = [];
    this.phaseStart = performance.now();
    this.setPrompt('Silencio', 'No toques nada 3 s: estoy midiendo el ruido de la pieza (aire, ventilador…).');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.mode !== 'silence') return;
      if (!this.frames.length) {
        this.mode = 'idle';
        this.setPrompt('Sin audio', 'No llegó ningún dato del micrófono en 5 s. Cerrá, revisá el permiso del micrófono y volvé a abrir. Copiá el log igual.');
        this.renderLog();
        return;
      }
      this.finishSilence();
    }, SILENCE_MS + 2000);
  }

  private finishSilence(): void {
    const rmsList = this.frames.map(f => f.rms);
    const falseNotes = this.frames.filter(f => f.freq).map(f => `${f.freq}Hz(${midiName(Math.round(hzToMidi(f.freq!)))})`);
    this.noise = {
      medianRms: +median(rmsList).toFixed(4),
      peakRms: Math.max(0, ...rmsList),
      falseNotes,
      frames: this.frames
    };
    this.frames = [];
    clearTimeout(this.timer);
    this.armTarget();
  }

  private armTarget(): void {
    clearTimeout(this.timer);
    if (this.index >= this.targets.length) {
      this.mode = 'idle';
      this.setPrompt('Listo', 'Terminó la pasada. Copiá el log y pasáselo a Claude.');
      this.renderLog();
      return;
    }
    const t = this.targets[this.index];
    this.mode = 'waiting';
    this.frames = [];
    this.phaseStart = performance.now();
    const label = t.fret === 0 ? 'al aire' : `traste ${t.fret}`;
    this.setPrompt(
      `Cuerda ${t.string} · ${label}`,
      `Esperado ${t.name} (${t.freq.toFixed(1)} Hz). Tocala una vez y dejala sonar. [${this.index + 1}/${this.targets.length}]`
    );
    this.timer = window.setTimeout(() => {
      if (this.mode === 'waiting') this.finishTarget();
    }, TIMEOUT_MS);
    this.renderLog();
  }

  private finishTarget(): void {
    clearTimeout(this.timer);
    const t = this.targets[this.index];
    this.results.set(this.index, this.analyse(t, this.frames));
    this.mode = 'idle';
    this.index++;
    // Pausa breve para que la cuerda anterior no se cuele en la siguiente.
    this.timer = window.setTimeout(() => this.armTarget(), 700);
    this.renderLog();
  }

  private skip(): void {
    const t = this.targets[this.index];
    if (!t) return;
    clearTimeout(this.timer);
    this.results.set(this.index, this.empty(t, 'saltado'));
    this.index++;
    this.armTarget();
  }

  private repeat(): void {
    clearTimeout(this.timer);
    if (this.mode === 'idle' && this.index > 0) this.index--;
    this.results.delete(this.index);
    this.armTarget();
  }

  private empty(target: Target, status: Result['status']): Result {
    return {
      target, status, medianHz: null, detected: null, centsOff: null, voicedPct: 0,
      correctPct: 0, firstCorrectMs: null, spreadCents: null, peakRms: 0, topFretMatch: null, frames: []
    };
  }

  private analyse(target: Target, frames: Frame[]): Result {
    if (!frames.length) return this.empty(target, 'sin-sonido');
    const voiced = frames.filter(f => f.freq);
    const peakRms = Math.max(...frames.map(f => f.rms));
    const res = this.empty(target, 'sin-sonido');
    res.frames = frames;
    res.peakRms = +peakRms.toFixed(4);
    res.voicedPct = Math.round((voiced.length / frames.length) * 100);
    if (!voiced.length) return res;

    const centsOf = (hz: number) => 1200 * Math.log2(hz / target.freq);
    const med = median(voiced.map(f => f.freq!));
    const correct = voiced.filter(f => Math.abs(centsOf(f.freq!)) <= 50);
    res.medianHz = +med.toFixed(1);
    res.detected = midiName(Math.round(hzToMidi(med)));
    res.centsOff = Math.round(centsOf(med));
    res.correctPct = Math.round((correct.length / frames.length) * 100);
    res.firstCorrectMs = correct.length ? correct[0].t : null;
    const centsList = voiced.map(f => centsOf(f.freq!));
    const mc = median(centsList);
    res.spreadCents = Math.round(median(centsList.map(c => Math.abs(c - mc))));

    const counts = new Map<string, number>();
    for (const f of voiced) {
      if (f.str == null) continue;
      const k = f.fret == null ? `c${f.str}` : `c${f.str}t${f.fret}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    res.topFretMatch = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const semis = Math.round(hzToMidi(med) - target.midi);
    const correctOfVoiced = correct.length / voiced.length;
    if (Math.abs(res.centsOff) <= 50 && correctOfVoiced >= 0.6) res.status = 'ok';
    else if (Math.abs(res.centsOff) <= 50) res.status = 'inestable';
    else if (semis % 12 === 0) res.status = 'octava';
    else res.status = 'mal';
    return res;
  }

  // ---------------------------------------------------------------- export

  private textLog(): string {
    const lines: string[] = [];
    lines.push(`# Pitch lab ${new Date().toISOString()}`);
    lines.push(`ua: ${this.userAgent}`);
    for (const d of this.diag) lines.push(`audio: ${JSON.stringify(d)}`);
    lines.push(`audio ahora: ${JSON.stringify(guitarAudio.getDiagnostics())}`);
    lines.push(`mic: ${this.micOk ? 'ok' : 'falló'} · frames recibidos: ${this.framesSeen} · estado: ${this.mode} · paso ${this.index}/${this.targets.length}`);
    if (this.noise) {
      lines.push(`ruido: rms mediana ${this.noise.medianRms} pico ${this.noise.peakRms.toFixed(4)} · notas falsas en silencio: ${this.noise.falseNotes.length}/${this.noise.frames.length}` +
        (this.noise.falseNotes.length ? ` → ${this.noise.falseNotes.slice(0, 15).join(' ')}` : ''));
    }
    lines.push('cuerda/traste esperado | estado | detectado mediana cents | %voz %ok | 1ºok ms | disp c | rms pico | match');
    const sorted = [...this.results.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, r] of sorted) {
      const t = r.target;
      lines.push(
        `c${t.string}t${t.fret} ${t.name} ${t.freq.toFixed(1)} | ${r.status} | ` +
        `${r.detected ?? '—'} ${r.medianHz ?? '—'}Hz ${r.centsOff ?? '—'}c | ` +
        `${r.voicedPct}% ${r.correctPct}% | ${r.firstCorrectMs ?? '—'} | ${r.spreadCents ?? '—'} | ${r.peakRms} | ${r.topFretMatch ?? '—'}`
      );
      if (r.status !== 'ok' && r.status !== 'saltado' && r.frames.length) {
        // Traza compacta: tiempo:Hz cada ~4 frames para ver dónde se va.
        const trace = r.frames.filter((_, i) => i % 4 === 0)
          .map(f => `${f.t}:${f.freq ?? '-'}${f.onset ? '*' : ''}`).join(' ');
        lines.push(`   traza ${trace}`);
      }
    }
    const done = sorted.map(([, r]) => r).filter(r => r.status !== 'saltado');
    const ok = done.filter(r => r.status === 'ok').length;
    lines.push(`resumen: ${ok}/${done.length} ok · octava ${done.filter(r => r.status === 'octava').length} · mal ${done.filter(r => r.status === 'mal').length} · inestable ${done.filter(r => r.status === 'inestable').length} · sin sonido ${done.filter(r => r.status === 'sin-sonido').length}`);
    return lines.join('\n');
  }

  private async copyLog(): Promise<void> {
    const text = this.textLog();
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('Log copiado al portapapeles.');
    } catch {
      const ta = this.q('#lab-log') as HTMLTextAreaElement;
      ta.select();
      this.setStatus('No pude copiar automáticamente: el log está seleccionado, copialo a mano.');
    }
  }

  private downloadJson(): void {
    const data = {
      at: new Date().toISOString(),
      userAgent: this.userAgent,
      micOk: this.micOk,
      framesSeen: this.framesSeen,
      mode: this.mode,
      step: this.index,
      totalSteps: this.targets.length,
      log: this.textLog(),
      audio: this.diag,
      audioNow: guitarAudio.getDiagnostics(),
      noise: this.noise,
      results: [...this.results.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r)
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pitch-lab-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- UI

  private q(sel: string): HTMLElement | null {
    return this.root?.querySelector(sel) ?? null;
  }

  private setPrompt(title: string, body: string): void {
    const t = this.q('#lab-prompt-title');
    const b = this.q('#lab-prompt-body');
    if (t) t.textContent = title;
    if (b) b.textContent = body;
  }

  private setStatus(msg: string): void {
    const el = this.q('#lab-status');
    if (el) el.textContent = msg;
  }

  private drawLive(): void {
    const el = this.q('#lab-live');
    if (!el) return;
    const { rms, freq } = this.live;
    const note = freq ? `${midiName(Math.round(hzToMidi(freq)))} ${freq.toFixed(1)} Hz` : 'sin nota';
    const state = { idle: '', silence: '· midiendo ruido', waiting: '· esperando', listening: '· escuchando' }[this.mode];
    el.textContent = `${note} · rms ${rms.toFixed(4)} · frames ${this.framesSeen} ${state}`;
    const bar = this.q('#lab-meter') as HTMLElement | null;
    if (bar) bar.style.width = `${Math.min(100, rms * 800)}%`;
  }

  private renderLog(): void {
    const ta = this.q('#lab-log') as HTMLTextAreaElement | null;
    if (ta) {
      ta.value = this.textLog();
      ta.scrollTop = ta.scrollHeight;
    }
  }

  private render(): void {
    this.root?.remove();
    const root = document.createElement('div');
    root.className = 'pitch-lab';
    root.innerHTML = `
      <style>
        .pitch-lab{position:fixed;inset:0;z-index:9999;background:#0d0f14;color:#e8eaf0;overflow:auto;
          font:14px/1.45 system-ui,sans-serif;padding:16px;box-sizing:border-box}
        .pitch-lab h2{margin:0 0 8px;font-size:18px}
        .pitch-lab button{background:#232836;color:inherit;border:1px solid #3a4152;border-radius:8px;padding:10px 14px;font:inherit}
        .pitch-lab button.primary{background:#3b6cf6;border-color:#3b6cf6}
        .pitch-lab .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
        .pitch-lab label{display:inline-flex;gap:4px;align-items:center}
        .pitch-lab .prompt{background:#161a23;border-radius:12px;padding:16px;margin:12px 0}
        .pitch-lab .prompt b{display:block;font-size:24px;margin-bottom:4px}
        .pitch-lab .meter{height:6px;background:#232836;border-radius:3px;overflow:hidden}
        .pitch-lab .meter div{height:100%;background:#4ade80;width:0}
        .pitch-lab textarea{width:100%;height:40vh;background:#07080b;color:#cfd3dc;border:1px solid #2a2f3c;border-radius:8px;
          font:11px/1.35 ui-monospace,monospace;padding:8px;box-sizing:border-box;white-space:pre}
        .pitch-lab input[type=number]{width:60px;background:#07080b;color:inherit;border:1px solid #3a4152;border-radius:6px;padding:6px}
        .pitch-lab .muted{color:#8a91a3;font-size:12px}
      </style>
      <div class="row" style="justify-content:space-between">
        <h2>Modo debug · detección</h2>
        <button type="button" id="lab-close">Cerrar</button>
      </div>
      <p id="lab-live" class="muted">Abriendo micrófono…</p>
      <div class="meter"><div id="lab-meter"></div></div>
      <div id="lab-setup">
        <p>Primero mido 3 s de silencio (el ruido de la pieza) y después te pido cada cuerda y traste. Tocá cada nota una vez y dejala sonar unos 2 s.</p>
        <div class="row">Cuerdas:
          ${[1, 2, 3, 4, 5, 6].map(s => `<label><input type="checkbox" data-lab-string="${s}" checked>${s}</label>`).join('')}
        </div>
        <div class="row"><label>Hasta el traste <input type="number" id="lab-max-fret" value="12" min="0" max="19"></label>
          <span class="muted">0 = solo al aire</span></div>
        <div class="row"><button type="button" class="primary" id="lab-start">Empezar</button></div>
      </div>
      <div id="lab-run" hidden>
        <div class="prompt"><b id="lab-prompt-title"></b><span id="lab-prompt-body"></span></div>
        <div class="row">
          <button type="button" id="lab-repeat">Repetir</button>
          <button type="button" id="lab-skip">Saltar</button>
          <button type="button" id="lab-restart">Volver a empezar</button>
        </div>
      </div>
      <div class="row">
        <button type="button" class="primary" id="lab-copy">Copiar log</button>
        <button type="button" id="lab-json">Descargar JSON</button>
      </div>
      <p id="lab-status" class="muted"></p>
      <textarea id="lab-log" readonly></textarea>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.q('#lab-close')!.addEventListener('click', () => this.close());
    this.q('#lab-start')!.addEventListener('click', () => this.start());
    this.q('#lab-repeat')!.addEventListener('click', () => this.repeat());
    this.q('#lab-skip')!.addEventListener('click', () => this.skip());
    this.q('#lab-restart')!.addEventListener('click', () => {
      clearTimeout(this.timer);
      this.mode = 'idle';
      this.q('#lab-setup')!.hidden = false;
      this.q('#lab-run')!.hidden = true;
    });
    this.q('#lab-copy')!.addEventListener('click', () => void this.copyLog());
    this.q('#lab-json')!.addEventListener('click', () => this.downloadJson());
  }
}

export const pitchLab = new PitchLab();
