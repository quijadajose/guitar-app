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
