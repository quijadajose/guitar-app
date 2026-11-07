import { guitarAudio } from '../../audio/audioEngine';
import type { GameplaySessionMode } from '../../types/gameplay.types';
import { goToScreen } from '../../screens';
import type { GameplayEngine } from '../gameplay';

export function setupScrubbingListeners(eng: GameplayEngine): void {
  const trackAreas = document.querySelectorAll<HTMLElement>('.timeline-track-area');
  trackAreas.forEach(track => {
    let isDragging = false;

    const ratioFromEvent = (e: MouseEvent | TouchEvent): number | null => {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const handleSeek = (e: MouseEvent | TouchEvent) => {
      const ratio = ratioFromEvent(e);
      if (ratio === null) return;
      if (eng.loopHandleDrag) {
        const minGap = eng.loopMinGap();
        if (eng.loopHandleDrag === 'start') {
          eng.loopStartRatio = Math.min(ratio, (eng.loopEndRatio ?? 1) - minGap);
          eng.loopStartRatio = Math.max(0, eng.loopStartRatio);
        } else {
          eng.loopEndRatio = Math.max(ratio, (eng.loopStartRatio ?? 0) + minGap);
          eng.loopEndRatio = Math.min(1, eng.loopEndRatio);
        }
        eng.updateLoopRegionUI();
        return;
      }
      eng.seekTo(ratio);
    };

    track.addEventListener('mousedown', (e) => {
      const handle = (e.target as HTMLElement).closest('.timeline-loop-handle');
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        eng.loopHandleDrag = handle.classList.contains('is-start') ? 'start' : 'end';
        if (eng.sessionMode !== 'practice') eng.setSessionMode('practice');
        eng.isLooping = true;
        isDragging = true;
        return;
      }
      if (e.shiftKey) {
        const ratio = ratioFromEvent(e);
        if (ratio !== null) eng.setLoopPoint(ratio);
        return;
      }
      isDragging = true;
      handleSeek(e);
    });

    track.addEventListener('dblclick', (e) => {
      e.preventDefault();
      eng.clearLoopRegion();
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        handleSeek(e);
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      eng.loopHandleDrag = null;
    });

    track.addEventListener('touchstart', (e) => {
      const target = e.target as HTMLElement;
      const handle = target.closest('.timeline-loop-handle');
      if (handle) {
        eng.loopHandleDrag = handle.classList.contains('is-start') ? 'start' : 'end';
        if (eng.sessionMode !== 'practice') eng.setSessionMode('practice');
        eng.isLooping = true;
        isDragging = true;
        return;
      }
      isDragging = true;
      handleSeek(e);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (isDragging) {
        if (eng.loopHandleDrag && e.cancelable) {
          e.preventDefault();
        }
        handleSeek(e);
      }
    }, { passive: false });

    window.addEventListener('touchend', () => {
      isDragging = false;
      eng.loopHandleDrag = null;
    });
  });

  eng.setupHUDListeners();

  document.addEventListener('visibilitychange', () => {
    const onGameplay = document.getElementById('view-notes')?.classList.contains('view-active')
      || document.getElementById('view-chords')?.classList.contains('view-active');
    if (!onGameplay) return;

    if (document.hidden) {
      if (eng.isCountingDown) eng.cancelCountdown();
      if (eng.isPlaying) eng.pausePlaying();
    } else if (eng.isPlaying) {
      eng.requestScreenWakeLock();
    }
  });

  document.querySelectorAll<HTMLElement>('.fretboard-canvas-container').forEach(canvas => {
    canvas.addEventListener('click', (e) => {
      if (eng.isCountingDown || !eng.isPlaying) return;
      const target = e.target as HTMLElement;
      if (target.closest('.timeline-track-area') || target.closest('.play-pause-btn')) return;
      e.preventDefault();
      eng.pausePlaying();
    });
  });

  const resumeBtn = document.getElementById('pause-resume-btn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.startPlaying();
    });
  }

  const pauseExitBtn = document.getElementById('pause-exit-btn');
  if (pauseExitBtn) {
    pauseExitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.wasPlayingThisSession = false;
      eng.pausePlaying();
      goToScreen(eng.leaveGameplay());
    });
  }
}

export function setupHUDListeners(eng: GameplayEngine): void {
  // Mode switcher buttons
  document.querySelectorAll<HTMLElement>('.mode-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (eng.isPlaying) return;
      const sMode = (btn.getAttribute('data-session-mode') || 'performance') as GameplaySessionMode;
      eng.setSessionMode(sMode);
      guitarAudio.playClickSound();
    });
  });

  // Speed slider
  document.querySelectorAll<HTMLInputElement>('.gameplay-speed-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      eng.setSpeed(val / 100);
    });
  });

  // Step speed buttons
  document.querySelectorAll<HTMLElement>('.speed-minus-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.adjustSpeed(-0.1);
      guitarAudio.playClickSound();
    });
  });

  document.querySelectorAll<HTMLElement>('.speed-plus-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.adjustSpeed(0.1);
      guitarAudio.playClickSound();
    });
  });

  // Loop toggle button
  document.querySelectorAll<HTMLElement>('.hud-loop-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      eng.toggleLoop();
      guitarAudio.playClickSound();
    });
  });
  eng.updateSessionModeUI();

  // Performance Results Modal buttons
  const retryBtn = document.getElementById('perf-btn-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      eng.retryPerformance();
    });
  }

  const practiceBtn = document.getElementById('perf-btn-practice');
  if (practiceBtn) {
    practiceBtn.addEventListener('click', () => {
      eng.switchToPracticeFromModal();
    });
  }

  const copyBtn = document.getElementById('probe-log-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = document.getElementById('probe-log-text')?.textContent ?? '';
      navigator.clipboard?.writeText(text).then(() => {
        copyBtn.textContent = 'Copiado';
      }).catch(() => {
        copyBtn.textContent = 'No se pudo copiar';
      });
    });
  }

  const downloadBtn = document.getElementById('probe-log-download');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const text = document.getElementById('probe-log-text')?.textContent ?? '';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prueba-de-sonido.txt';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const exitBtn = document.getElementById('perf-btn-exit');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      const modal = document.getElementById('performance-results-modal');
      if (modal) modal.style.display = 'none';

      goToScreen(eng.leaveGameplay());
    });
  }
}
