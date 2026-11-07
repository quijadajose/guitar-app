import { guitarAudio } from '../../audio/audioEngine';
import { STEPS_PER_BEAT, STEP_CELL_PX } from '../../rhythm';
import { startEditorTour } from '../../editorTour';
import { SONG_LIMITS, sanitizePlainText } from '../../songSafety';
import { getCurrentUserId, publishCommunitySong, requestMagicLink, signInWithPasskey } from '../../services/supabase';
import { markSheetRequested, scheduleEditorSheet } from './sheetSync';
import type { SongEditor } from '../editor';

export function setupEventListeners(eng: SongEditor): void {
  const titleInput = document.getElementById('editor-song-title') as HTMLInputElement | null;
  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      eng.currentSong.title = sanitizePlainText((e.target as HTMLInputElement).value, SONG_LIMITS.titleMax, 'Canción');
      eng.saveToStorage();
      scheduleEditorSheet(eng.currentSong);
    });
  }

  const bpmSlider = document.getElementById('editor-bpm-slider') as HTMLInputElement | null;
  const bpmVal = document.getElementById('editor-bpm-val');
  const applyBpm = (val: number): void => {
    const min = bpmSlider ? Number(bpmSlider.min) : 50;
    const max = bpmSlider ? Number(bpmSlider.max) : 180;
    const next = Math.min(max, Math.max(min, val));
    eng.currentSong.bpm = next;
    if (bpmSlider) bpmSlider.value = String(next);
    if (bpmVal) bpmVal.textContent = String(next);
    eng.updateStats();
    eng.saveToStorage();
    scheduleEditorSheet(eng.currentSong);
    if (eng.isSequencerPlaying) {
      const currentBeat = eng.currentSequencerBeat;
      eng.stopSequencerPlayback();
      eng.startSequencerPlayback();
      eng.currentSequencerBeat = currentBeat;
    }
  };
  bpmSlider?.addEventListener('input', (e) => {
    applyBpm(parseInt((e.target as HTMLInputElement).value, 10));
  });
  document.getElementById('editor-bpm-down')?.addEventListener('click', () => {
    applyBpm(eng.currentSong.bpm - 1);
  });
  document.getElementById('editor-bpm-up')?.addEventListener('click', () => {
    applyBpm(eng.currentSong.bpm + 1);
  });

  document.getElementById('editor-chord-lane')?.addEventListener('click', (e) => {
    if (eng.currentSong.mode !== 'chords') return;
    if ((e.target as HTMLElement).closest('.grid-chord-block')) return;
    const track = document.getElementById('chord-lane-track');
    if (!track) return;
    const x = e.clientX - track.getBoundingClientRect().left;
    const beatWidth = STEP_CELL_PX * STEPS_PER_BEAT;
    const beatIndex = Math.max(0, Math.floor(x / beatWidth));
    const maxBeat = eng.currentSong.measures * 4 - 1;
    const clamped = Math.min(beatIndex, maxBeat);
    eng.promptAddChord(Math.floor(clamped / 4) + 1, (clamped % 4) + 1);
  });

  document.querySelector('.editor-more')?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.editor-more-menu .editor-btn');
    if (item) (e.currentTarget as HTMLDetailsElement).open = false;
  });

  const presetSelect = document.getElementById('editor-preset-select') as HTMLSelectElement | null;
  if (presetSelect) {
    presetSelect.addEventListener('change', (e) => {
      eng.loadPreset((e.target as HTMLSelectElement).value);
    });
  }

  const clearBtn = document.getElementById('editor-clear-all-btn');
  const clearModal = document.getElementById('editor-clear-confirm-modal');
  const hideClearModal = (): void => {
    if (clearModal) clearModal.style.display = 'none';
  };
  const showClearModal = (): void => {
    if (clearModal) clearModal.style.display = 'flex';
  };

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      showClearModal();
    });
  }
  document.getElementById('editor-clear-confirm-close')?.addEventListener('click', hideClearModal);
  document.getElementById('editor-clear-confirm-cancel')?.addEventListener('click', hideClearModal);
  document.getElementById('editor-clear-confirm-ok')?.addEventListener('click', () => {
    eng.clearAllPlacedItems();
    hideClearModal();
  });
  if (clearModal) {
    clearModal.addEventListener('click', (e) => {
      if (e.target === clearModal) hideClearModal();
    });
  }

  document.getElementById('editor-tour-btn')?.addEventListener('click', () => {
    startEditorTour(true);
  });

  const playGameBtn = document.getElementById('editor-play-game-btn');
  if (playGameBtn) {
    playGameBtn.addEventListener('click', () => {
      eng.stopSequencerPlayback();
      eng.playInGame();
    });
  }

  const playSeqBtn = document.getElementById('editor-play-seq-btn');
  if (playSeqBtn) {
    playSeqBtn.addEventListener('click', () => {
      if (eng.isDualPlaybackPlaying) {
        eng.stopDualPlayback();
      }
      eng.toggleSequencerPlayback();
    });
  }

  const playBothBtn = document.getElementById('editor-play-both-btn');
  if (playBothBtn) {
    playBothBtn.addEventListener('click', () => {
      eng.toggleDualPlayback();
    });
  }

  const sheetToggle = document.getElementById('editor-sheet-toggle');
  const sheetPanel = document.getElementById('editor-sheet');
  if (sheetToggle && sheetPanel) {
    const paintToggle = (): void => {
      const open = sheetPanel.classList.contains('is-open');
      sheetToggle.classList.toggle('is-on', open);
      sheetToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
    };
    paintToggle();
    sheetToggle.addEventListener('click', () => {
      sheetPanel.classList.toggle('is-open');
      paintToggle();
      if (sheetPanel.classList.contains('is-open')) {
        markSheetRequested();
        scheduleEditorSheet(eng.currentSong);
      }
    });
  }

  const exportBtn = document.getElementById('editor-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      eng.exportSongJSON();
    });
  }

  const importBtn = document.getElementById('editor-import-btn');
  const fileInput = document.getElementById('editor-import-file') as HTMLInputElement | null;
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => {
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      eng.importSongJSON(e);
    });
  }

  const publishBtn = document.getElementById('editor-publish-btn');
  const publishModal = document.getElementById('community-publish-modal');
  const publishClose = document.getElementById('comm-publish-close');
  const publishCancel = document.getElementById('comm-publish-cancel');
  const publishSubmit = document.getElementById('comm-publish-submit') as HTMLButtonElement | null;
  const publishStatus = document.getElementById('comm-publish-status');

  const hidePublishModal = (): void => {
    if (publishModal) publishModal.style.display = 'none';
    if (publishStatus) {
      publishStatus.style.display = 'none';
      publishStatus.textContent = '';
    }
  };

  const accountGate = document.getElementById('comm-account-gate');
  const publishFields = document.getElementById('comm-publish-fields');
  const accountEmail = document.getElementById('comm-account-email') as HTMLInputElement | null;

  const showPublishStatus = (text: string, ok: boolean): void => {
    if (!publishStatus) return;
    publishStatus.style.display = 'block';
    publishStatus.style.background = ok ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    publishStatus.style.color = ok ? '#86efac' : '#fca5a5';
    publishStatus.textContent = text;
  };

  const refreshAccountGate = async (): Promise<boolean> => {
    const userId = await getCurrentUserId();
    const signedIn = Boolean(userId);
    if (accountGate) accountGate.hidden = signedIn;
    if (publishFields) publishFields.style.display = signedIn ? 'flex' : 'none';
    if (publishSubmit) publishSubmit.disabled = !signedIn;
    return signedIn;
  };

  if (publishBtn && publishModal) {
    publishBtn.addEventListener('click', () => {
      publishModal.style.display = 'flex';
      void refreshAccountGate();
    });
  }

  document.getElementById('comm-account-magic')?.addEventListener('click', () => {
    const email = accountEmail?.value.trim() || '';
    if (!email) {
      showPublishStatus('Ingresá un email para recibir el enlace.', false);
      return;
    }
    void requestMagicLink(email).then((result) => {
      showPublishStatus(
        result.ok ? 'Te mandamos un enlace. Abrilo desde el email y volvé a publicar.' : (result.error || 'No se pudo enviar el enlace.'),
        result.ok
      );
    });
  });
  document.getElementById('comm-account-passkey')?.addEventListener('click', () => {
    void signInWithPasskey().then(async (result) => {
      if (!result.ok) {
        showPublishStatus(result.error || 'No se pudo entrar con passkey.', false);
        return;
      }
      showPublishStatus('Cuenta lista. Ya podés cargar la canción.', true);
      await refreshAccountGate();
    });
  });

  if (publishClose) publishClose.addEventListener('click', hidePublishModal);
  if (publishCancel) publishCancel.addEventListener('click', hidePublishModal);
  if (publishModal) {
    publishModal.addEventListener('click', (e) => {
      if (e.target === publishModal) hidePublishModal();
    });
  }

  if (publishSubmit) {
    publishSubmit.addEventListener('click', async () => {
      const nameInput = document.getElementById('comm-creator-name') as HTMLInputElement | null;
      const diffSelect = document.getElementById('comm-song-difficulty') as HTMLSelectElement | null;
      const publicCheckbox = document.getElementById('comm-song-is-public') as HTMLInputElement | null;

      const creatorName = nameInput?.value.trim() || 'Comunidad';
      const difficulty = (diffSelect?.value as 'easy' | 'medium' | 'hard' | 'expert') || 'medium';
      const isPublic = publicCheckbox ? publicCheckbox.checked : true;

      if (publishStatus) {
        publishStatus.style.display = 'block';
        publishStatus.style.background = 'rgba(59, 130, 246, 0.2)';
        publishStatus.style.color = '#93c5fd';
        publishStatus.textContent = 'Subiendo partitura a Supabase…';
      }
      publishSubmit.disabled = true;

      const res = await publishCommunitySong({
        song: eng.currentSong,
        creatorName,
        difficulty,
        isPublic
      });

      publishSubmit.disabled = false;

      if (res.success) {
        if (publishStatus) {
          publishStatus.style.background = 'rgba(34, 197, 94, 0.2)';
          publishStatus.style.color = '#86efac';
          publishStatus.textContent = '¡Canción publicada exitosamente en la comunidad!';
        }
        setTimeout(() => {
          hidePublishModal();
        }, 1500);
      } else {
        if (publishStatus) {
          publishStatus.style.background = 'rgba(239, 68, 68, 0.2)';
          publishStatus.style.color = '#fca5a5';
          publishStatus.textContent = `Error al publicar: ${res.error || 'Verifica tu conexión'}`;
        }
      }
    });
  }

  eng.setupAudioExtractionEvents();
  eng.setupAudioPlayerEvents();
  eng.setupPopoverEvents();
}

export function setupPopoverEvents(eng: SongEditor): void {
  const closeBtn = document.getElementById('selector-close-btn');
  const modal = document.getElementById('note-selector-modal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('visible');
    });
  }

  document.querySelectorAll<HTMLElement>('.fret-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fret-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedFret = parseInt(btn.dataset.fret || '0');
      if (eng.selectedCell) {
        guitarAudio.playString(eng.selectedCell.string, eng.selectedFret);
      }
    });
  });

  document.querySelectorAll<HTMLElement>('.finger-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.finger-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedFinger = parseInt(btn.dataset.finger || '0');
    });
  });

  document.querySelectorAll<HTMLElement>('.duration-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedNoteDuration = parseInt(btn.dataset.duration || '1');
    });
  });

  const applyBtn = document.getElementById('selector-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      eng.applySelectedNote();
    });
  }

  const deleteBtn = document.getElementById('selector-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      eng.deleteSelectedNote();
    });
  }
}
