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
  const updateFullscreenButton = (): void => {
    const isFs = Boolean(
      document.fullscreenElement ||
      (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
    );
    button?.classList.toggle('is-active', isFs);
    if (button) {
      button.textContent = isFs ? 'Salir' : 'Pantalla completa';
    }
  };

  updateFullscreenButton();
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
});

export {};
