import type { GameplayEngine } from '../gameplay';

export function triggerMultiplierPopup(eng: GameplayEngine): void {
  const activeViewId = eng.mode === 'notes' ? '#view-notes' : '#view-chords';
  const multBox = document.querySelector(`${activeViewId} .hud-multiplier-box`);
  if (multBox) {
    multBox.classList.add('multiplier-up');
    setTimeout(() => multBox.classList.remove('multiplier-up'), 380);
  }
}

export function spawnTimingLabel(eng: GameplayEngine, deltaSeconds: number): void {
  const perfect = 0.12;
  let text = 'PERFECTO';
  let kind = 'timing-perfect';
  if (deltaSeconds < -perfect) {
    text = 'ADELANTADO';
    kind = 'timing-early';
  } else if (deltaSeconds > perfect) {
    text = 'ATRASADO';
    kind = 'timing-late';
  }
  eng.spawnScoreParticle(text, false, kind);
}

export function spawnScoreParticle(eng: GameplayEngine, text: string, isMiss: boolean = false, extraClass: string = ''): void {
  const activeViewId = eng.mode === 'notes' ? '#view-notes' : '#view-chords';
  const container = document.querySelector(`${activeViewId}.is-sheet #sheet-stage`)
    ?? document.querySelector(`${activeViewId} .fretboard-canvas-container`);
  if (!container) return;

  const particle = document.createElement('div');
  particle.className = `hit-score-particle ${isMiss ? 'particle-miss' : ''} ${extraClass}`.trim();
  particle.textContent = text;
  particle.style.left = '35%';
  particle.style.top = extraClass ? '58%' : isMiss ? '42%' : '38%';
  container.appendChild(particle);

  setTimeout(() => {
    particle.remove();
  }, 850);
}

export function updateHudChordCard(eng: GameplayEngine, chordName: string): void {
  eng.currentActiveChordName = chordName;

  const titleEl = document.querySelector('.hud-chord-card-title');
  if (titleEl) {
    titleEl.textContent = chordName;
  }

  const cardEl = document.querySelector('.hud-chord-card');
  if (cardEl) {
    cardEl.setAttribute('title', `Acorde actual: ${chordName}`);
    cardEl.classList.add('pulse');
    setTimeout(() => cardEl.classList.remove('pulse'), 250);
  }

  const svgEl = document.querySelector('.hud-chord-mini-svg');
  if (svgEl) {
    svgEl.querySelectorAll('.hud-finger-dot').forEach(dot => dot.remove());

    const diagram = eng.chordDiagrams[chordName] || eng.chordDiagrams['Am'];
    if (diagram && diagram.dots) {
      diagram.dots.forEach(d => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', 'hud-finger-dot');
        circle.setAttribute('cx', d.cx.toString());
        circle.setAttribute('cy', d.cy.toString());
        circle.setAttribute('r', '4.5');
        circle.setAttribute('fill', d.color);
        svgEl.appendChild(circle);
      });
    }
  }
}
