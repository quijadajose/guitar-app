import { audioExtractor } from '../../audio/audioExtractor';
import { copyPcmChannels, extractionClient } from '../../audio/extractionClient';
import { SONG_LIMITS, isAllowedMediaFile, sanitizePlainText } from '../../songSafety';
import type { SongEditor } from '../editor';

export function setupAudioExtractionEvents(eng: SongEditor): void {
  const extractBtn = document.getElementById('editor-audio-extract-btn');
  const fileInput = document.getElementById('editor-audio-extract-file') as HTMLInputElement | null;
  const modal = document.getElementById('audio-extract-modal');
  const closeBtn = document.getElementById('extract-modal-close-btn');
  const cancelBtn = document.getElementById('extract-btn-cancel');
  const dropzone = document.getElementById('extract-dropzone');
  const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;

  if (extractBtn && modal) {
    extractBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
  }

  const closeModal = () => {
    extractionClient.cancel();
    eng.extractionGeneration += 1;
    if (modal) modal.style.display = 'none';
    const progress = document.getElementById('extract-progress-wrap');
    if (progress) {
      progress.style.display = 'none';
      progress.classList.remove('is-error');
    }
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Dropzone & File Input events
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => {
      fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        eng.handleSelectedAudioFile(files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        eng.handleSelectedAudioFile(files[0]);
      }
    });
  }

  // Process & Confirm button
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (eng.pendingFileToExtract) {
        await eng.processPendingAudioFile(eng.pendingFileToExtract);
      }
    });
  }
}

export function showEditorMessage(message: string): void {
  const hint = document.querySelector('.editor-hint span') || document.getElementById('extract-status-text');
  if (hint) hint.textContent = message;
}

export function revokeReferenceObjectUrl(eng: SongEditor): void {
  if (eng.referenceObjectUrl) {
    URL.revokeObjectURL(eng.referenceObjectUrl);
    eng.referenceObjectUrl = null;
  }
}

export function handleSelectedAudioFile(eng: SongEditor, file: File): void {
  if (!isAllowedMediaFile(file)) {
    eng.pendingFileToExtract = null;
    eng.showEditorMessage(
      file.size > SONG_LIMITS.audioMaxBytes
        ? 'El archivo supera el límite de 50 MB.'
        : 'Formato no permitido. Usá audio o video (mp3, wav, ogg, mp4…).'
    );
    const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  eng.pendingFileToExtract = file;
  const mainText = document.getElementById('extract-drop-main-text');
  const confirmBtn = document.getElementById('extract-btn-confirm') as HTMLButtonElement | null;

  if (mainText) {
    mainText.textContent = `Archivo seleccionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    mainText.style.color = 'var(--accent)';
  }

  if (confirmBtn) {
    confirmBtn.disabled = false;
  }
}

export async function processPendingAudioFile(eng: SongEditor, file: File): Promise<void> {
  if (!isAllowedMediaFile(file)) {
    eng.showEditorMessage('Archivo de audio/video no permitido o demasiado grande.');
    return;
  }

  const progressWrap = document.getElementById('extract-progress-wrap');
  const progressFill = document.getElementById('extract-progress-fill');
  const statusText = document.getElementById('extract-status-text');

  if (progressWrap) {
    progressWrap.style.display = 'flex';
    progressWrap.classList.remove('is-error');
  }
    if (progressFill) progressFill.style.width = '8%';
  if (statusText) {
    statusText.classList.remove('is-error');
    statusText.textContent = `Leyendo ${file.name}…`;
  }

  const generation = ++eng.extractionGeneration;

  try {
    const arrayBuffer = await file.arrayBuffer();
    if (generation !== eng.extractionGeneration) return;

    if (progressFill) progressFill.style.width = '12%';
    if (statusText) statusText.textContent = 'Decodificando pista de audio…';

    const audioBuffer = await audioExtractor.decodeAudioFile(arrayBuffer);
    if (generation !== eng.extractionGeneration) return;
    eng.decodedAudioBuffer = audioBuffer;

    const sensitivitySelect = document.getElementById('extract-sensitivity') as HTMLSelectElement | null;
    const bpmSelect = document.getElementById('extract-bpm-mode') as HTMLSelectElement | null;

    const threshold = sensitivitySelect ? parseFloat(sensitivitySelect.value) : 1.8;
    let bpmParam: number | undefined = undefined;
    let autoBpm = true;

    if (bpmSelect && bpmSelect.value !== 'auto') {
      autoBpm = false;
      if (bpmSelect.value === 'custom') {
        bpmParam = eng.currentSong.bpm;
      } else {
        bpmParam = parseInt(bpmSelect.value);
      }
    }

    if (statusText) statusText.textContent = 'Analizando en segundo plano…';
    const outcome = await extractionClient.extract(
      {
        channels: copyPcmChannels(audioBuffer),
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration
      },
      sanitizePlainText(file.name, SONG_LIMITS.titleMax, 'Canción detectada'),
      { threshold, bpm: bpmParam, autoBpm },
      (progress) => {
        if (generation !== eng.extractionGeneration) return;
        if (progressFill) progressFill.style.width = `${Math.round(12 + progress.ratio * 86)}%`;
        if (statusText) statusText.textContent = progress.stage;
      }
    );
    if (generation !== eng.extractionGeneration) return;

    const extractedProject = outcome.project;
    if (progressFill) progressFill.style.width = '100%';
    if (statusText) {
      const cut = outcome.truncated
        ? ` (se recortó a ${SONG_LIMITS.measuresMax} de ${outcome.rawMeasures} compases)`
        : '';
      statusText.textContent = `¡Completado! ${extractedProject.notes.length} notas volcadas en ${extractedProject.measures} compases.${cut}`;
    }

    const audioUrl = URL.createObjectURL(file);

    setTimeout(() => {
      if (generation !== eng.extractionGeneration) return;
      eng.applySong(extractedProject);
      eng.setupReferenceAudioPlayer(audioUrl, file.name);
      const modal = document.getElementById('audio-extract-modal');
      if (modal) modal.style.display = 'none';
      if (progressWrap) progressWrap.style.display = 'none';
    }, 500);

  } catch (err) {
    console.error('Extraction error:', err);
    if (progressWrap) progressWrap.classList.add('is-error');
    if (statusText) {
      statusText.classList.add('is-error');
      statusText.textContent = 'No se pudo leer ese archivo. Probá otro MP3, WAV u OGG, o un MP4 con audio.';
    }
  }
}
