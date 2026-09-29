import { guitarApp } from './app';

function isFillingScreen(): boolean {
  if (document.fullscreenElement) return true;
  const webkit = (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement;
  if (webkit) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  const slack = 48;
  return (
    window.innerHeight >= window.screen.availHeight - slack &&
    window.innerWidth >= window.screen.availWidth - slack
  );
}

function toggleFullscreen(): void {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (isFillingScreen()) return;
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
    const isFs = isFillingScreen();
    button?.classList.toggle('is-active', isFs);
    button?.setAttribute('aria-label', isFs ? 'Salir de pantalla completa' : 'Pantalla completa');
  };

  updateFullscreenButton();
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  window.addEventListener('resize', updateFullscreenButton);
});

export {};
