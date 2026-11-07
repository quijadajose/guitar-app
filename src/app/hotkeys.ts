import { gameplayEngine } from '../components/gameplay';
import { sessionCalibrator } from '../components/calibration';
import type { GuitarApp } from '../app';

export function setupHotkeys(eng: GuitarApp): void {
  window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typing) return;

    if (e.key === '1' && e.altKey) eng.switchScreen('tuner');
    if (e.key === '2' && e.altKey) eng.switchScreen('songs');
    if (e.key === '3' && e.altKey) eng.switchScreen('chords');
    if (e.key === '4' && e.altKey) eng.switchScreen('editor');

    const onGameplay = eng.currentScreenId === 'notes' || eng.currentScreenId === 'chords';
    // En Face-Off la barra espaciadora lanza el ataque (versusLobby); no pausar a la vez.
    const spaceIsAttack = e.key === ' ' && gameplayEngine.isVersusActive && gameplayEngine.isFaceOffMode;
    if (onGameplay && !spaceIsAttack && (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === ' ')) {
      e.preventDefault();
      if (sessionCalibrator.isActive) {
        if (e.key === 'Escape') sessionCalibrator.skip();
        return;
      }
      if (gameplayEngine.isCountingDown) {
        gameplayEngine.cancelCountdown();
        return;
      }
      if (e.key === 'Escape') {
        if (gameplayEngine.isPlaying) gameplayEngine.pausePlaying();
        return;
      }
      gameplayEngine.togglePlay();
      return;
    }

    if (!e.altKey && !e.ctrlKey && !e.metaKey && gameplayEngine.isPlaying && onGameplay) {
      const keyMap: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
      if (keyMap[e.key]) {
        gameplayEngine.userPlayString(keyMap[e.key]);
      } else if (e.key === 'Enter') {
        if (gameplayEngine.mode === 'notes') {
          const upcoming = gameplayEngine.notesTrack.find(n => !n.hit && !n.missed && Math.abs(gameplayEngine.currentTime - n.time) <= 0.4);
          if (upcoming) {
            gameplayEngine.userPlayString(upcoming.string, upcoming.fret);
          }
        } else if (gameplayEngine.mode === 'chords') {
          const upcoming = gameplayEngine.chordsTrack.find(c => !c.hit && !c.missed && Math.abs(gameplayEngine.currentTime - c.time) <= 0.5);
          if (upcoming) {
            gameplayEngine.userPlayChord(upcoming.chord);
          } else if (gameplayEngine.currentActiveChordName) {
            gameplayEngine.userPlayChord(gameplayEngine.currentActiveChordName);
          }
        }
      }
    }
  });
}
