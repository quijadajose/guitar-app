import type { TrackNoteWithDOM, TrackChordWithDOM } from '../gameplay';
import type { GameplayEngine } from '../gameplay';

export function renderNotesMotion(eng: GameplayEngine, width: number, height: number, hitZoneX: number): void {
  const container = document.querySelector('#view-notes .fretboard-canvas-container');
  const containerRect = container ? container.getBoundingClientRect() : null;
  const stringEls = container ? container.querySelectorAll<HTMLElement>('.track-string') : null;

  const stringYs: Record<number, number> = {};
  if (stringEls && stringEls.length === 6 && containerRect && containerRect.height > 0) {
    stringEls.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      stringYs[index + 1] = (rect.top - containerRect.top) + (rect.height / 2);
    });
  } else {
    for (let s = 1; s <= 6; s++) {
      stringYs[s] = height * eng.stringRatios[s];
    }
  }

  eng.notesTrack.forEach(note => {
    if (!note.hit && !note.missed && eng.currentTime > note.time + note.hold + 0.12) {
      note.missed = true;
      eng.recordProbe(note, null);
      eng.triggerNoteMiss(note);
    }
    if (!note.el) return;

    const noteX = hitZoneX + (note.time - eng.currentTime) * eng.scrollSpeed;
    const noteY = stringYs[note.string] || (height * 0.7);

    if (noteX > -260 && noteX < width + 300) {
      note.el.style.display = 'flex';
      note.el.style.transform = `translate3d(${noteX}px, ${noteY}px, 0) translateY(-50%)`;
    } else {
      note.el.style.display = 'none';
    }
  });

  let ballY = height * 0.7;

  let prevNote: TrackNoteWithDOM | null = null;
  let nextNote: TrackNoteWithDOM | null = null;

  for (let i = 0; i < eng.notesTrack.length; i++) {
    const n = eng.notesTrack[i];
    if (n.time <= eng.currentTime) {
      prevNote = n;
    } else {
      nextNote = n;
      break;
    }
  }

  if (prevNote && nextNote) {
    const interval = nextNote.time - prevNote.time;
    const u = Math.max(0, Math.min(1, (eng.currentTime - prevNote.time) / interval));
    const startY = stringYs[prevNote.string];
    const endY = stringYs[nextNote.string];
    const baseY = startY + (endY - startY) * u;
    const arcPeak = 75;
    const bounceHeight = 4 * arcPeak * u * (1 - u);
    ballY = baseY - bounceHeight;
  } else if (nextNote) {
    const timeToHit = nextNote.time - eng.currentTime;
    const u = Math.max(0, 1 - timeToHit / 2.0);
    const targetY = stringYs[nextNote.string];
    const arcPeak = 65;
    const bounceHeight = 4 * arcPeak * u * (1 - u);
    ballY = targetY - bounceHeight;
  } else if (prevNote) {
    ballY = stringYs[prevNote.string];
  }

  const ballEl = document.querySelector<HTMLElement>('#view-notes .bouncing-ball');
  if (ballEl) {
    ballEl.style.left = `${hitZoneX}px`;
    ballEl.style.top = `${ballY}px`;
  }

  const canvas = document.querySelector<HTMLCanvasElement>('#view-notes .trajectory-canvas');
  if (canvas) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

      for (let i = 0; i < eng.notesTrack.length - 1; i++) {
        const n1 = eng.notesTrack[i];
        const n2 = eng.notesTrack[i + 1];

        const x1 = hitZoneX + (n1.time - eng.currentTime) * eng.scrollSpeed;
        const y1 = stringYs[n1.string];
        const x2 = hitZoneX + (n2.time - eng.currentTime) * eng.scrollSpeed;
        const y2 = stringYs[n2.string];

        if (x2 > -100 && x1 < width + 100) {
          const arcWidth = x2 - x1;
          const peak = Math.min(90, Math.max(50, arcWidth * 0.25));

          ctx.beginPath();
          for (let px = 0; px <= arcWidth; px += 5) {
            const t = px / arcWidth;
            const curX = x1 + px;
            const baseY = y1 + (y2 - y1) * t;
            const curY = baseY - 4 * peak * t * (1 - t);

            if (px === 0) ctx.moveTo(curX, curY);
            else ctx.lineTo(curX, curY);
          }
          ctx.stroke();
        }
      }

      if (eng.notesTrack.length > 0) {
        const firstNote = eng.notesTrack[0];
        const fx = hitZoneX + (firstNote.time - eng.currentTime) * eng.scrollSpeed;
        const fy = stringYs[firstNote.string];
        const preBounceW = 140;

        for (let bx = fx - preBounceW * 2; bx < fx; bx += preBounceW) {
          if (bx + preBounceW > -50 && bx < width + 50) {
            ctx.beginPath();
            for (let px = 0; px <= preBounceW; px += 5) {
              const t = px / preBounceW;
              const curX = bx + px;
              const curY = fy - 4 * 60 * t * (1 - t);
              if (px === 0) ctx.moveTo(curX, curY);
              else ctx.lineTo(curX, curY);
            }
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    }
  }
}

export function renderChordsMotion(eng: GameplayEngine, width: number, height: number, hitZoneX: number): void {
  const chordBaseY = height * 0.62;

  let currentActiveChord: TrackChordWithDOM | null = null;
  let closestUpcoming: TrackChordWithDOM | null = null;
  let minUpcomingDiff = Infinity;

  for (const chord of eng.chordsTrack) {
    const blockWidth = chord.width || 300;
    const startX = hitZoneX + (chord.time - eng.currentTime) * eng.scrollSpeed;
    const endX = startX + blockWidth;

    if (hitZoneX >= startX - 20 && hitZoneX <= endX + 40) {
      currentActiveChord = chord;
      break;
    }

    const diff = chord.time - eng.currentTime;
    if (diff > 0 && diff < minUpcomingDiff) {
      minUpcomingDiff = diff;
      closestUpcoming = chord;
    }
  }

  const chordToDisplay = currentActiveChord || closestUpcoming || eng.chordsTrack[0];
  if (chordToDisplay && chordToDisplay.chord !== eng.currentActiveChordName) {
    eng.updateHudChordCard(chordToDisplay.chord);
  }

  eng.chordsTrack.forEach(chord => {
    if (!chord.el) return;

    const chordX = hitZoneX + (chord.time - eng.currentTime) * eng.scrollSpeed;

    if (chordX > -400 && chordX < width + 400) {
      chord.el.style.display = 'flex';
      chord.el.style.transform = `translate3d(${chordX}px, 0, 0)`;
    } else {
      chord.el.style.display = 'none';
    }

    if (eng.isPlaying && !chord.hit && !chord.missed && eng.currentTime > chord.time + chord.hold + 0.12) {
      chord.missed = true;
      eng.triggerChordMiss(chord);
    }
  });

  const ballEl = document.querySelector<HTMLElement>('#view-chords .bouncing-ball');
  let ballY = chordBaseY;
  if (eng.isPlaying) {
    const cycle = (eng.currentTime * 2) % 1;
    const h = Math.sin(cycle * Math.PI) * 35;
    ballY = chordBaseY - h;
  }
  if (ballEl) {
    ballEl.style.left = `${hitZoneX}px`;
    ballEl.style.top = `${ballY}px`;
  }

  const canvas = document.querySelector<HTMLCanvasElement>('#view-chords .trajectory-canvas');
  if (canvas) {
    // Resolución física del dispositivo: en un teléfono (dpr ~2,6) la línea punteada se veía borrosa.
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

      for (let i = 0; i < eng.chordsTrack.length - 1; i++) {
        const c1 = eng.chordsTrack[i];
        const c2 = eng.chordsTrack[i + 1];
        const x1 = hitZoneX + (c1.time - eng.currentTime) * eng.scrollSpeed;
        const x2 = hitZoneX + (c2.time - eng.currentTime) * eng.scrollSpeed;

        if (x2 > -100 && x1 < width + 100) {
          const arcW = x2 - x1;
          ctx.beginPath();
          for (let px = 0; px <= arcW; px += 6) {
            const t = px / arcW;
            const curX = x1 + px;
            const curY = chordBaseY - 4 * 70 * t * (1 - t);
            if (px === 0) ctx.moveTo(curX, curY);
            else ctx.lineTo(curX, curY);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}
