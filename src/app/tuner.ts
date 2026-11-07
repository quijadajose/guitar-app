import { guitarAudio } from '../audio/audioEngine';
import { tunerMotion } from '../components/tunerMotion';
import { cloneTemplate, slot } from '../dom';
import type { GuitarApp } from '../app';

export function setupTuner(eng: GuitarApp): void {
  const pegButtons = document.querySelectorAll<HTMLElement>('.tuner-peg-badge');
  const tunerContinueBtn = document.getElementById('tuner-continue-btn');
  const btnEnableMic = document.getElementById('tuner-btn-enable-mic');

  pegButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pegNum = parseInt(btn.getAttribute('data-peg') || '0', 10);
      eng.activatePeg(pegNum, undefined, true, true, false);
    });
  });

  if (tunerContinueBtn) {
    tunerContinueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.switchScreen('songs');
    });
  }

  if (btnEnableMic) {
    btnEnableMic.addEventListener('click', async (e) => {
      e.stopPropagation();
      await eng.grantMicAndAttach();
    });
  }
}

export function fillTunerPitchLabel(eng: GuitarApp, name: string, spanish: string, freq: string): void {
  const tunerPitchLabel = document.getElementById('tuner-pitch-label');
  if (!tunerPitchLabel) return;
  if (!eng.tunerPitchSlots) {
    tunerPitchLabel.replaceChildren(cloneTemplate('tpl-tuner-pitch-label'));
    eng.tunerPitchSlots = {
      name: slot(tunerPitchLabel, 'name'),
      spanish: slot(tunerPitchLabel, 'spanish'),
      freq: slot(tunerPitchLabel, 'freq')
    };
  }
  if (eng.tunerPitchSlots.name) eng.tunerPitchSlots.name.textContent = name;
  if (eng.tunerPitchSlots.spanish) eng.tunerPitchSlots.spanish.textContent = spanish;
  if (eng.tunerPitchSlots.freq) eng.tunerPitchSlots.freq.textContent = freq;
}

export function animateStringVibration(stringNum: number, durationMs: number = 650, sustain = false): void {
  tunerMotion.pluck(stringNum, sustain);
  if (!sustain) {
    window.setTimeout(() => tunerMotion.release(), durationMs);
  }
}

export function markStringTuned(eng: GuitarApp, pegNum: number): void {
  const checkEl = document.getElementById(`tuner-check-${pegNum}`);
  const isNew = !eng.tunedStrings.has(pegNum);
  eng.tunedStrings.add(pegNum);

  if (checkEl) {
    checkEl.classList.add('tuned');
    if (isNew) {
      checkEl.classList.add('pop-in');
      setTimeout(() => checkEl.classList.remove('pop-in'), 600);
    }
  }

  if (isNew) {
    guitarAudio.playTunedChime();
  }

  if (eng.tunedStrings.size === 6) {
    if (isNew) eng.showTunerComplete();
  } else if (isNew) {
    if (eng.autoProgressTimer) clearTimeout(eng.autoProgressTimer);
    eng.autoProgressTimer = window.setTimeout(() => {
      const nextUntuned = eng.tuningOrder.find(s => !eng.tunedStrings.has(s));
      if (nextUntuned) {
        eng.activatePeg(nextUntuned, undefined, false, false, false);
      }
    }, 1200);
  }
}

export function showTunerComplete(): void {
  const tunerCompleteTitle = document.getElementById('tuner-complete-title');
  const tunerPromptText = document.getElementById('tuner-prompt-text');
  const tunerCentsLabel = document.getElementById('tuner-cents-label');
  const tunerContinueBtn = document.getElementById('tuner-continue-btn');

  if (tunerCompleteTitle) {
    tunerCompleteTitle.textContent = '¡Listo, está afinado!';
    tunerCompleteTitle.classList.add('visible');
  }
  if (tunerPromptText) tunerPromptText.style.display = 'none';
  if (tunerCentsLabel) {
    tunerCentsLabel.textContent = 'Todas las cuerdas afinadas correctamente';
    tunerCentsLabel.style.color = 'var(--accent)';
  }
  if (tunerContinueBtn) tunerContinueBtn.classList.add('visible');

  guitarAudio.playCompletionFanfare();
}

export function resetTunerActiveState(eng: GuitarApp): void {
  document.querySelectorAll<HTMLElement & { _vibrateTimeout?: number }>('.headstock-string').forEach(str => {
    str.classList.remove('vibrating');
    if (str._vibrateTimeout) {
      clearTimeout(str._vibrateTimeout);
      str._vibrateTimeout = undefined;
    }
  });

  document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));
  document.querySelectorAll('.tuner-peg-badge').forEach(b => b.classList.remove('active'));

  const pitchIndicator = document.getElementById('tuner-pitch-indicator');
  if (pitchIndicator) {
    pitchIndicator.style.setProperty('--tuner-offset', '0');
    pitchIndicator.classList.remove('in-tune');
  }

  const tunerPromptText = document.getElementById('tuner-prompt-text');
  if (tunerPromptText && eng.tunedStrings.size < 6) {
    tunerPromptText.textContent = 'Toca una cuerda para afinar';
  }

  const tunerCentsLabel = document.getElementById('tuner-cents-label');
  if (tunerCentsLabel && eng.tunedStrings.size < 6) {
    tunerCentsLabel.textContent = 'En espera de pulsación...';
    tunerCentsLabel.style.color = 'var(--text-muted)';
  }
}

export async function queryMicPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export function rememberMicGranted(eng: GuitarApp): void {
  eng.hasGrantedMicPermission = true;
  guitarAudio.hasMicPermission = true;
  try {
    sessionStorage.setItem('guitar_mic_granted', '1');
  } catch {
    // modo privado / almacenamiento bloqueado
  }
}

export async function syncMicForScreen(eng: GuitarApp, targetId: string): Promise<void> {
  const gen = ++eng.micGateGen;
  const micOverlay = document.getElementById('tuner-mic-overlay');

  if (!eng.micScreens.has(targetId)) {
    if (micOverlay) micOverlay.classList.add('hidden');
    guitarAudio.releaseMicrophone();
    eng.isMicActive = false;
    eng.isGameplayMicActive = false;
    return;
  }

  const perm = await eng.queryMicPermissionState();
  if (gen !== eng.micGateGen) return;

  // Si el navegador dice «denied», no fiarse del recuerdo de la sesión: mostrar el aviso.
  const alreadyAllowed =
    perm === 'granted' ||
    (perm !== 'denied' && (
      eng.hasGrantedMicPermission ||
      guitarAudio.hasMicPermission ||
      sessionStorage.getItem('guitar_mic_granted') === '1'
    ));

  if (alreadyAllowed) {
    eng.rememberMicGranted();
    if (micOverlay) micOverlay.classList.add('hidden');
    await eng.attachMicForScreen(targetId);
    return;
  }

  if (micOverlay) micOverlay.classList.remove('hidden');
}

export function detachAllMicListeners(eng: GuitarApp): void {
  guitarAudio.detachPitchListener(eng.onTunerPitch);
  guitarAudio.detachPitchListener(eng.onGameplayPitch);
  guitarAudio.setWaveformListener(null);
  eng.stopTunerDebug();
  eng.isMicActive = false;
  eng.isGameplayMicActive = false;
}

export async function attachMicForScreen(eng: GuitarApp, screenId: string): Promise<void> {
  eng.detachAllMicListeners();
  if (screenId === 'tuner') {
    await eng.startTunerMicrophone();
  } else if (screenId === 'notes' || screenId === 'chords') {
    await eng.startGameplayMicrophone();
  }
}

export async function grantMicAndAttach(eng: GuitarApp): Promise<void> {
  const errEl = document.getElementById('tuner-mic-error');
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = '';
  }
  const started = await guitarAudio.startMicrophonePitchTracking();
  if (!started) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
    }
    return;
  }
  eng.rememberMicGranted();
  const micOverlay = document.getElementById('tuner-mic-overlay');
  if (micOverlay) micOverlay.classList.add('hidden');
  await eng.attachMicForScreen(eng.currentScreenId);
}

export async function startTunerMicrophone(eng: GuitarApp): Promise<boolean> {
  eng.tunerMicCandidate = null;
  eng.tunerMicStableFrames = 0;
  eng.tunerMicInTuneMs = 0;
  eng.tunerMicLastFrameAt = 0;
  eng.tunerSmoothedCents = null;
  eng.tunerLastPitchTime = 0;

  const started = await guitarAudio.startMicrophonePitchTracking(eng.onTunerPitch);

  if (started) {
    eng.isMicActive = true;
    eng.startTunerDebug();
    eng.rememberMicGranted();
    const micOverlay = document.getElementById('tuner-mic-overlay');
    if (micOverlay) micOverlay.classList.add('hidden');
    const tunerPromptText = document.getElementById('tuner-prompt-text');
    if (tunerPromptText && eng.tunedStrings.size < 6) {
      tunerPromptText.textContent = 'Toca una cuerda para afinar';
    }
    return true;
  }

  // El permiso recordado ya no vale (lo revocaron): volver a pedirlo.
  eng.hasGrantedMicPermission = false;
  guitarAudio.hasMicPermission = false;
  try {
    sessionStorage.removeItem('guitar_mic_granted');
  } catch {
    // ignore
  }
  document.getElementById('tuner-mic-overlay')?.classList.remove('hidden');
  const errEl = document.getElementById('tuner-mic-error');
  if (errEl) {
    errEl.hidden = false;
    errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
  }
  return false;
}

export function stopTunerMicrophone(eng: GuitarApp): void {
  guitarAudio.detachPitchListener(eng.onTunerPitch);
  eng.isMicActive = false;
}
