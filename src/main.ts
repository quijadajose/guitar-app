import { guitarApp } from './app';

function toggleFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  root.requestFullscreen?.().catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  guitarApp.init();
  const button = document.getElementById('btn-fullscreen');
  button?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    button?.classList.toggle('is-active', document.fullscreenElement !== null);
    if (button) {
      button.textContent = document.fullscreenElement ? 'Salir' : 'Pantalla completa';
    }
  });
});

export {};
