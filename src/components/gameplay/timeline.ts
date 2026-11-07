import { sanitizeCssColor, sanitizeFinger } from '../../songSafety';
import type { GameplayEngine } from '../gameplay';

export function renderTimelineMarkers(eng: GameplayEngine): void {
  const activeViewId = eng.mode === 'notes' ? '#view-notes' : '#view-chords';
  const trackArea = document.querySelector(`${activeViewId} .timeline-track-area`);
  if (!trackArea) return;

  trackArea.querySelectorAll('.timeline-mini-marker').forEach(m => m.remove());

  if (eng.mode === 'notes') {
    const fingerColors: Record<number, string> = {
      0: '#8a929e',
      1: '#f5a623',
      2: '#00d2ff',
      3: '#e024c3',
      4: '#8e44ad'
    };

    eng.notesTrack.forEach(n => {
      const leftPercent = (n.time / eng.songDuration) * 100;
      if (leftPercent >= 0 && leftPercent <= 100) {
        const marker = document.createElement('div');
        marker.className = 'timeline-mini-marker type-note';
        marker.dataset.tlId = `n-${n.id}`;
        marker.style.left = `${leftPercent}%`;
        marker.style.background = fingerColors[sanitizeFinger(n.finger)] || '#f5a623';
        if (n.hit) marker.classList.add('is-hit');
        if (n.missed) marker.classList.add('is-miss');
        trackArea.appendChild(marker);
      }
    });
  } else {
    eng.chordsTrack.forEach(c => {
      const leftPercent = (c.time / eng.songDuration) * 100;
      const widthPercent = Math.max(3, (c.width / (eng.scrollSpeed * eng.songDuration)) * 100);
      if (leftPercent >= 0 && leftPercent <= 100) {
        const marker = document.createElement('div');
        marker.className = 'timeline-mini-marker type-chord';
        marker.dataset.tlId = `c-${c.id}`;
        marker.style.left = `${leftPercent}%`;
        marker.style.width = `${widthPercent}%`;
        marker.style.background = sanitizeCssColor(c.color);
        if (c.hit) marker.classList.add('is-hit');
        if (c.missed) marker.classList.add('is-miss');
        trackArea.appendChild(marker);
      }
    });
  }
}

export function markTimelineResult(eng: GameplayEngine, kind: 'n' | 'c', id: number, result: 'hit' | 'miss'): void {
  const activeViewId = eng.mode === 'notes' ? '#view-notes' : '#view-chords';
  const marker = document.querySelector(`${activeViewId} .timeline-mini-marker[data-tl-id="${kind}-${id}"]`);
  if (!marker) return;
  marker.classList.remove('is-hit', 'is-miss');
  marker.classList.add(result === 'hit' ? 'is-hit' : 'is-miss');
}
