import { guitarAudio } from '../audio/audioEngine';
import { gameplayEngine } from '../components/gameplay';
import type { GuitarApp } from '../app';

export function setupGameplay(eng: GuitarApp): void {
  const playPauseBtns = document.querySelectorAll<HTMLElement>('.play-pause-btn');
  playPauseBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      gameplayEngine.togglePlay();
    });
  });

  document.querySelectorAll<HTMLElement>('.finger-legend-icon').forEach(hand => {
    hand.addEventListener('click', () => {
      const tooltip = document.getElementById('hand-legend-modal');
      if (tooltip) tooltip.classList.toggle('visible');
    });
  });

  document.addEventListener('click', (e) => {
    const modal = document.getElementById('hand-legend-modal');
    const target = e.target as HTMLElement;
    if (modal && modal.classList.contains('visible') && !target.closest('.finger-legend-icon') && !target.closest('#hand-legend-modal')) {
      modal.classList.remove('visible');
    }
  });

  window.addEventListener('resize', () => eng.resizeCanvases());
  setTimeout(() => eng.resizeCanvases(), 100);
}

export function resizeCanvases(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('.trajectory-canvas');
  canvases.forEach(canvas => {
    const parent = canvas.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      if (rect.width > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }
  });
  gameplayEngine.renderFrame();
}

export async function startGameplayMicrophone(eng: GuitarApp): Promise<void> {
  eng.isGameplayMicActive = true;
  await guitarAudio.startMicrophonePitchTracking(eng.onGameplayPitch);
}

export function stopGameplayMicrophone(eng: GuitarApp): void {
  eng.isGameplayMicActive = false;
  guitarAudio.detachPitchListener(eng.onGameplayPitch);
}
