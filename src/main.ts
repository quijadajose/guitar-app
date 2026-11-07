import './styles/main.css';
import './styles/player-gate.css';
import './styles/tuner.css';
import './styles/gameplay.css';
import './styles/editor.css';
import './templates';
import { guitarApp } from './app';

function isApiFullscreen(): boolean {
  const webkit = (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
  return Boolean(document.fullscreenElement || webkit);
}

function toggleFullscreen(): void {
  const doc = document as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => Promise<void>;
  };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (doc.webkitFullscreenElement) {
    doc.webkitExitFullscreen?.()?.catch(() => {});
    return;
  }
  const enter = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  enter?.()?.catch(() => {});
}

/** Alto visible real: en Android, 100dvh puede no coincidir con lo que se ve al entrar/salir de pantalla completa. */
function syncAppHeight(): void {
  const height = Math.round(window.innerHeight);
  if (height > 0) document.documentElement.style.setProperty('--app-h', `${height}px`);
}

syncAppHeight();
window.addEventListener('resize', syncAppHeight);
window.addEventListener('orientationchange', () => window.setTimeout(syncAppHeight, 150));
document.addEventListener('fullscreenchange', () => window.setTimeout(syncAppHeight, 150));
window.visualViewport?.addEventListener('resize', syncAppHeight);

document.addEventListener('DOMContentLoaded', () => {
  guitarApp.init();
  const button = document.getElementById('btn-fullscreen');
  button?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFullscreen();
  });
  const updateFullscreenButton = (): void => {
    const isFs = isApiFullscreen();
    button?.classList.toggle('is-active', isFs);
    button?.setAttribute('aria-label', isFs ? 'Salir de pantalla completa' : 'Pantalla completa');
    button?.querySelector('.fs-enter')?.toggleAttribute('hidden', isFs);
    button?.querySelector('.fs-exit')?.toggleAttribute('hidden', !isFs);
  };

  updateFullscreenButton();
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  window.addEventListener('resize', updateFullscreenButton);
});

export {};

/** Service worker: solo en producción (en desarrollo cachearía código viejo). */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error: unknown) => console.warn('[sw] no se pudo registrar', error));
  });
}

registerServiceWorker();

