import { multiplayerOrigin } from '../../services/network/serverStatus';
import { goToScreen } from '../../screens';
import { gameplayEngine } from '../gameplay';
import { furEliseSong } from '../../songs/furElise';
import type { VersusLobby } from '../versusLobby';

export function startLocalMatch(eng: VersusLobby): void {
  const localSong = document.querySelector<HTMLElement>('#vs-step-local [data-local-song].active');
  const localMode = document.querySelector<HTMLElement>('#vs-step-local [data-local-mode].active');
  if (localSong) eng.selectedSongId = localSong.getAttribute('data-local-song') || 'sultans_swing';
  if (localMode) eng.selectedMode = eng.readMode(localMode.getAttribute('data-local-mode'));
  const first = eng.playerName();
  const secondInput = document.getElementById('vs-local-name-2') as HTMLInputElement | null;
  const second = secondInput?.value.trim().slice(0, 20) || 'Jugador 2';
  eng.localNames = [first, second];
  eng.localTurn = 0;
  eng.localFirst = null;
  if (!eng.preloadSong()) {
    eng.setStatus('No se pudo cargar la canción', true);
    return;
  }
  eng.armLocalEngine();
  const screen = eng.selectedSongId === 'chords_progression' ? 'chords' : 'notes';
  goToScreen(screen);
  eng.setStatus(`Turno de ${first}. Cuando termine, pasa el aparato.`);
}

export function armLocalEngine(eng: VersusLobby): void {
  gameplayEngine.isVersusActive = false;
  gameplayEngine.isFaceOffMode = false;
  gameplayEngine.isLocalHotseat = true;
  gameplayEngine.localPassHandoff = false;
  gameplayEngine.attackStreak = 0;
  gameplayEngine.updateAttackHUD();
  gameplayEngine.onTriggerAttack = null;
  gameplayEngine.onProgressUpdate = null;
  gameplayEngine.onNoteHitCallback = null;
  gameplayEngine.onNoteMissCallback = null;
  gameplayEngine.onMatchFinished = (score, _combo, accuracy) => {
    eng.onLocalTurnDone(score, accuracy);
  };
  gameplayEngine.onLocalRetry = () => {
    eng.continueLocal();
  };
}

export function onLocalTurnDone(eng: VersusLobby, score: number, accuracy: number): void {
  const names = eng.localNames;
  if (!names) return;
  const verdict = document.getElementById('perf-verdict-text');
  const retryLabel = document.querySelector('#perf-btn-retry span');
  const practice = document.getElementById('perf-btn-practice');
  const vsBox = document.getElementById('perf-vs-comparison');
  if (eng.localTurn === 0) {
    eng.localFirst = { score, accuracy, combo: gameplayEngine.maxCombo };
    gameplayEngine.localPassHandoff = true;
    if (verdict) verdict.textContent = `${names[0]} hizo ${score} pts. Pasá el aparato: le toca a ${names[1]}.`;
    if (retryLabel) retryLabel.textContent = `Turno de ${names[1]}`;
    if (practice) practice.hidden = true;
    const rematch = document.getElementById('perf-btn-rematch');
    if (rematch) rematch.hidden = true;
    if (vsBox) vsBox.hidden = true;
    return;
  }
  const first = eng.localFirst;
  gameplayEngine.localPassHandoff = false;
  if (practice) practice.hidden = true;
  // La revancha rápida es del modo en línea; en local se usa «Otra vez».
  const rematch = document.getElementById('perf-btn-rematch');
  if (rematch) rematch.hidden = true;
  if (retryLabel) retryLabel.textContent = 'Otra vez';
  if (!first || !vsBox) return;
  vsBox.hidden = false;
  const banner = document.getElementById('perf-vs-banner');
  const myScore = document.getElementById('perf-vs-my-score');
  const myAcc = document.getElementById('perf-vs-my-acc');
  const rivalScore = document.getElementById('perf-vs-rival-score');
  const rivalAcc = document.getElementById('perf-vs-rival-acc');
  const rivalLabel = document.getElementById('perf-vs-rival-label');
  const localBadge = vsBox.querySelector('.player-local .perf-vs-badge');
  if (localBadge) localBadge.textContent = names[0];
  if (rivalLabel) rivalLabel.textContent = names[1];
  if (myScore) myScore.textContent = `${first.score} pts`;
  if (myAcc) myAcc.textContent = `${Math.round(first.accuracy)}% Precisión`;
  if (rivalScore) rivalScore.textContent = `${score} pts`;
  if (rivalAcc) rivalAcc.textContent = `${Math.round(accuracy)}% Precisión`;
  if (banner) {
    if (first.score > score) banner.textContent = `Gana ${names[0]}`;
    else if (score > first.score) banner.textContent = `Gana ${names[1]}`;
    else banner.textContent = 'Empate';
  }
  if (verdict) verdict.textContent = 'Misma canción, dos turnos.';
}

export function continueLocal(eng: VersusLobby): void {
  const names = eng.localNames;
  if (!names) return;
  const modal = document.getElementById('performance-results-modal');
  if (modal) modal.style.display = 'none';
  if (gameplayEngine.localPassHandoff) {
    eng.localTurn = 1;
    gameplayEngine.localPassHandoff = false;
  } else {
    eng.localTurn = 0;
    eng.localFirst = null;
    const retryLabel = document.querySelector('#perf-btn-retry span');
    if (retryLabel) retryLabel.textContent = 'Reintentar';
  }
  eng.armLocalEngine();
  gameplayEngine.restartPerformance();
}

export function preloadSong(eng: VersusLobby): boolean {
  if (eng.selectedSongId === 'fur_elise') {
    gameplayEngine.loadCustomSong(furEliseSong);
  } else if (eng.selectedSongId === 'chords_progression') {
    gameplayEngine.init('chords');
  } else if (eng.selectedSongId === 'sultans_swing') {
    gameplayEngine.init('notes');
  } else {
    eng.songPrepared = false;
    return false;
  }
  // Si la partitura local no tiene las notas que espera el servidor, todos quedarían
  // descalificados al final: mejor no dejar empezar y avisar.
  const expected = eng.serverSongEvents?.get(eng.selectedSongId);
  const local = eng.selectedSongId === 'chords_progression'
    ? gameplayEngine.chordsTrack.length
    : gameplayEngine.notesTrack.length;
  if (expected !== undefined && local !== expected) {
    console.error(`Versus: ${eng.selectedSongId} tiene ${local} eventos locales y ${expected} en el servidor`);
    eng.songPrepared = false;
    return false;
  }
  eng.songPrepared = true;
  return true;
}

export function loadServerSongs(eng: VersusLobby): void {
  if (eng.serverSongEvents || eng.serverSongsLoading) return;
  eng.serverSongsLoading = true;
  fetch(`${multiplayerOrigin()}/songs`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: unknown) => {
      const list = (data as { songs?: unknown } | null)?.songs;
      if (!Array.isArray(list)) return;
      const map = new Map<string, number>();
      for (const item of list) {
        const row = item as { id?: unknown; events?: unknown };
        if (typeof row.id === 'string' && typeof row.events === 'number') map.set(row.id, row.events);
      }
      eng.serverSongEvents = map;
    })
    .catch(() => undefined)
    .finally(() => {
      eng.serverSongsLoading = false;
    });
}
