import { gameplayEngine } from '../gameplay';
import { goToScreen, queueGameplaySong } from '../../screens';
import { isAllowedJsonFile, sanitizeDownloadName, sanitizeSongProject } from '../../songSafety';
import type { SongEditor } from '../editor';

export function playInGame(eng: SongEditor): void {
  eng.stopSequencerPlayback();
  if (eng.isDualPlaybackPlaying) {
    eng.stopDualPlayback();
  }
  if (eng.referenceAudio && eng.isReferenceAudioPlaying) {
    eng.toggleReferenceAudio();
  }

  eng.saveToStorage();
  queueGameplaySong(eng.currentSong);

  const targetScreen = eng.currentSong.mode === 'chords' ? 'chords' : 'notes';
  goToScreen(targetScreen);
  gameplayEngine.loadCustomSong(eng.currentSong);
  requestAnimationFrame(() => {
    if (gameplayEngine.mode === 'notes') gameplayEngine.buildDOMNotes();
    else gameplayEngine.buildDOMChords();
    gameplayEngine.renderFrame();
  });
}

export function exportSongJSON(eng: SongEditor): void {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(eng.currentSong, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `${sanitizeDownloadName(eng.currentSong.title)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

export function importSongJSON(eng: SongEditor, event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!isAllowedJsonFile(file)) {
    eng.showEditorMessage('JSON inválido o demasiado grande (máx. 512 KB).');
    target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const imported = sanitizeSongProject(JSON.parse(content));
      if (!imported) {
        eng.showEditorMessage('El JSON no tiene una canción válida.');
        return;
      }
      eng.applySong(imported);
      eng.showEditorMessage(`Canción «${imported.title}» importada.`);
    } catch {
      eng.showEditorMessage('No se pudo leer el archivo JSON.');
    } finally {
      target.value = '';
    }
  };
  reader.readAsText(file);
}
