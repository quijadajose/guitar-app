import { guitarAudio } from '../audio/audioEngine';
import type { GuitarApp } from '../app';

export function startTunerDebug(eng: GuitarApp): void {
  guitarAudio.setWaveformListener((samples) => {
    eng.tunerDebugFrame = samples;
  });
  eng.bindTunerDebugPanel();
  if (eng.tunerDebugRaf) cancelAnimationFrame(eng.tunerDebugRaf);
  const draw = () => {
    eng.drawTunerDebug();
    eng.tunerDebugRaf = requestAnimationFrame(draw);
  };
  eng.tunerDebugRaf = requestAnimationFrame(draw);
}

export function stopTunerDebug(eng: GuitarApp): void {
  if (eng.tunerDebugRaf) cancelAnimationFrame(eng.tunerDebugRaf);
  eng.tunerDebugRaf = 0;
  eng.tunerDebugFrame = null;
}

export function bindTunerDebugPanel(eng: GuitarApp): void {
  const orb = document.getElementById('tuner-debug-orb');
  const panel = document.getElementById('tuner-debug-panel');
  const recordBtn = document.getElementById('tuner-debug-record') as HTMLButtonElement | null;
  const downloadBtn = document.getElementById('tuner-debug-download') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('tuner-debug-close');
  if (!orb || !panel || orb.dataset.bound === '1') return;
  orb.dataset.bound = '1';
  orb.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  closeBtn?.addEventListener('click', () => {
    panel.hidden = true;
  });
  recordBtn?.addEventListener('click', () => {
    eng.tunerDebugReadings = [];
    eng.tunerDebugCapture = null;
    if (downloadBtn) downloadBtn.disabled = true;
    guitarAudio.beginCapture(6);
    if (recordBtn) recordBtn.disabled = true;
  });
  downloadBtn?.addEventListener('click', () => {
    if (!eng.tunerDebugCapture) return;
    eng.downloadCapture(eng.tunerDebugCapture, eng.tunerDebugReadings);
  });
  document.getElementById('tuner-debug-tags')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    const tag = button?.getAttribute('data-tag');
    if (!tag) return;
    eng.tunerDebugTag = tag;
    document.querySelectorAll('#tuner-debug-tags button').forEach(el => {
      el.classList.toggle('is-active', el === button);
    });
  });
}

export function drawTunerDebug(eng: GuitarApp): void {
  const hz = eng.tunerDebugFreq;
  const live = document.getElementById('tuner-debug-live');
  const log = document.getElementById('tuner-debug-log');
  const recordBtn = document.getElementById('tuner-debug-record') as HTMLButtonElement | null;
  const downloadBtn = document.getElementById('tuner-debug-download') as HTMLButtonElement | null;
  if (guitarAudio.capturing && recordBtn) {
    recordBtn.textContent = `Grabando ${Math.round(guitarAudio.captureProgress() * 100)}%`;
  }
  if (!guitarAudio.capturing && recordBtn?.disabled && eng.tunerDebugCapture === null) {
    const done = guitarAudio.finishCapture();
    if (done) {
      eng.tunerDebugCapture = done;
      if (downloadBtn) downloadBtn.disabled = false;
      if (recordBtn) {
        recordBtn.disabled = false;
        recordBtn.textContent = 'Grabar 6 s';
      }
    }
  }
  if (live) {
    live.textContent = hz
      ? `${hz.toFixed(1)} Hz · rms ${eng.tunerDebugRms.toFixed(4)}`
      : `sin nota · rms ${eng.tunerDebugRms.toFixed(4)}`;
  }
  if (log) log.textContent = eng.tunerDebugReadings.slice(-12).join('\n');
}
