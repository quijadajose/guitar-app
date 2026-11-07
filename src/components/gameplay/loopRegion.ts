import type { GameplayEngine } from '../gameplay';

export function armPracticeLoop(eng: GameplayEngine): void {
  if (eng.loopStartRatio === null || eng.loopEndRatio === null) {
    const half = 0.08;
    const center = eng.progress;
    const minGap = eng.loopMinGap();
    let start = Math.max(0, center - half);
    let end = Math.min(1, center + half);
    if (end - start < minGap) end = Math.min(1, start + minGap);
    if (end - start < minGap) start = Math.max(0, end - minGap);
    eng.loopStartRatio = start;
    eng.loopEndRatio = end;
  }
  eng.isLooping = true;
}

export function hasLoopRegion(eng: GameplayEngine): boolean {
  return eng.loopStartRatio !== null && eng.loopEndRatio !== null && eng.loopEndRatio - eng.loopStartRatio > 0.01;
}

export function loopMinGap(eng: GameplayEngine): number {
  return Math.max(0.035, 0.7 / Math.max(eng.songDuration, 1));
}

export function loopStartTime(eng: GameplayEngine): number {
  return (eng.loopStartRatio ?? 0) * eng.songDuration;
}

export function loopEndTime(eng: GameplayEngine): number {
  return (eng.loopEndRatio ?? 1) * eng.songDuration;
}

export function clearLoopRegion(eng: GameplayEngine): void {
  eng.loopStartRatio = null;
  eng.loopEndRatio = null;
  eng.updateLoopRegionUI();
}

export function setLoopPoint(eng: GameplayEngine, ratio: number): void {
  if (eng.sessionMode !== 'practice') {
    eng.setSessionMode('practice');
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  const minGap = eng.loopMinGap();

  if (eng.loopStartRatio === null) {
    eng.loopStartRatio = clamped;
    eng.loopEndRatio = Math.min(1, clamped + minGap);
  } else if (eng.loopEndRatio === null) {
    eng.placeLoopEnd(clamped, minGap);
  } else {
    const distStart = Math.abs(clamped - eng.loopStartRatio);
    const distEnd = Math.abs(clamped - eng.loopEndRatio);
    if (distStart <= distEnd) {
      eng.loopStartRatio = Math.min(clamped, eng.loopEndRatio - minGap);
    } else {
      eng.loopEndRatio = Math.max(clamped, eng.loopStartRatio + minGap);
    }
  }

  eng.loopStartRatio = Math.max(0, Math.min(1 - minGap, eng.loopStartRatio));
  eng.loopEndRatio = Math.max((eng.loopStartRatio ?? 0) + minGap, Math.min(1, eng.loopEndRatio ?? 1));
  eng.isLooping = true;
  eng.updateSessionModeUI();
  eng.updateLoopRegionUI();
}

export function placeLoopEnd(eng: GameplayEngine, clamped: number, minGap: number): void {
  const start = eng.loopStartRatio ?? 0;
  if (clamped < start) {
    eng.loopEndRatio = start;
    eng.loopStartRatio = Math.max(0, clamped);
  } else {
    eng.loopEndRatio = clamped;
  }
  if ((eng.loopEndRatio ?? 0) - (eng.loopStartRatio ?? 0) < minGap) {
    eng.loopEndRatio = Math.min(1, (eng.loopStartRatio ?? 0) + minGap);
  }
}

export function updateLoopRegionUI(eng: GameplayEngine): void {
  const show = eng.sessionMode === 'practice' && eng.loopStartRatio !== null;
  document.querySelectorAll<HTMLElement>('.timeline-loop-region').forEach(region => {
    if (!show) {
      region.hidden = true;
      return;
    }
    region.hidden = false;
    const start = (eng.loopStartRatio ?? 0) * 100;
    const end = (eng.loopEndRatio ?? (eng.loopStartRatio ?? 0) + 2) * 100;
    region.style.left = `${start}%`;
    region.style.width = `${Math.max(1.2, end - start)}%`;
  });
}

export function toggleLoop(eng: GameplayEngine): void {
  if (eng.sessionMode === 'performance') return;
  eng.isLooping = !eng.isLooping;

  // If enabling loop and no section is set yet, default to an initial 20%-80% section
  if (eng.isLooping && eng.loopStartRatio === null) {
    eng.loopStartRatio = 0.2;
    eng.loopEndRatio = 0.8;
  }

  eng.updateSessionModeUI();
  eng.updateLoopRegionUI();
}
