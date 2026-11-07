import type { GameplayEngine } from '../gameplay';

export function updateRivalHUD(eng: GameplayEngine, rivalName: string, rivalScore: number, accuracy: number = 100): void {
  eng.rivalLastScore = rivalScore;
  eng.rivalLastAccuracy = accuracy;

  const rivalEl = document.getElementById('hud-vs-rival');
  const nameEl = document.getElementById('vs-rival-name');
  const scoreEl = document.getElementById('vs-rival-score');
  const diffEl = document.getElementById('vs-score-diff');
  if (!rivalEl || !nameEl || !scoreEl || !diffEl) return;

  rivalEl.hidden = false;
  nameEl.textContent = rivalName;
  scoreEl.textContent = `${rivalScore} pts`;

  const diff = eng.score - rivalScore;
  if (diff >= 0) {
    diffEl.textContent = `+${diff}`;
    diffEl.className = 'vs-score-diff ahead';
  } else {
    diffEl.textContent = `${diff}`;
    diffEl.className = 'vs-score-diff behind';
  }

  const perfRivalScore = document.getElementById('perf-vs-rival-score');
  const perfRivalAcc = document.getElementById('perf-vs-rival-acc');
  if (perfRivalScore) perfRivalScore.textContent = `${rivalScore} pts`;
  if (perfRivalAcc) perfRivalAcc.textContent = `${Math.round(accuracy)}% Precisión`;
}

export function updateAttackHUD(eng: GameplayEngine): void {
  const box = document.getElementById('hud-vs-attack-box');
  const btn = document.getElementById('vs-attack-trigger-btn') as HTMLButtonElement | null;
  const label = document.getElementById('vs-attack-btn-label');
  if (!box || !btn || !label) return;

  if (!eng.isVersusActive || !eng.isFaceOffMode) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const isReady = eng.attackStreak >= eng.attackThreshold;
  btn.disabled = !isReady;
  if (isReady) {
    btn.classList.add('attack-ready');
    label.textContent = '¡Lanzar ataque!';
  } else {
    btn.classList.remove('attack-ready');
    label.textContent = `Cargando ${eng.attackStreak}/${eng.attackThreshold}`;
  }
}

export function launchAttack(eng: GameplayEngine): void {
  if (eng.attackStreak < eng.attackThreshold) return;
  eng.attackStreak = 0;
  eng.updateAttackHUD();

  const attacks: Array<'invert_screen' | 'blind_strings' | 'turbo_speed'> = [
    'invert_screen',
    'blind_strings',
    'turbo_speed',
  ];
  const chosen = attacks[Math.floor(Math.random() * attacks.length)];
  const duration = chosen === 'turbo_speed' ? 3500 : 3000;

  if (eng.onTriggerAttack) {
    eng.onTriggerAttack(chosen, duration);
  }
}

export function applyAttackEffect(eng: GameplayEngine, attackType: 'invert_screen' | 'blind_strings' | 'turbo_speed', durationMs: number = 3000): void {
  const trackWrapper = document.querySelector('.fretboard-canvas-container');
  if (!trackWrapper) return;

  if (attackType === 'invert_screen') {
    trackWrapper.classList.add('vs-attack-invert');
    setTimeout(() => trackWrapper.classList.remove('vs-attack-invert'), durationMs);
  } else if (attackType === 'blind_strings') {
    trackWrapper.classList.add('vs-attack-blind');
    setTimeout(() => trackWrapper.classList.remove('vs-attack-blind'), durationMs);
  } else if (attackType === 'turbo_speed') {
    const origSpeed = eng.speedMultiplier;
    eng.speedMultiplier = origSpeed * 1.35;
    setTimeout(() => {
      eng.speedMultiplier = origSpeed;
    }, durationMs);
  }
}
