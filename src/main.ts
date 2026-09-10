import { guitarApp } from './app';

function hideUrlBar(): void {
  const root = document.documentElement;
  if (document.fullscreenElement || !root.requestFullscreen) return;
  root.requestFullscreen().catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  guitarApp.init();
  window.addEventListener('pointerdown', hideUrlBar, { once: true });
});

export {};
