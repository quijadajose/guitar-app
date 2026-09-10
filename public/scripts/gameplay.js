/**
 * Yousician Gameplay Engine
 * Real-time rhythmic runway with scrolling notes, synchronized parabolic bouncing ball,
 * audio hit synthesis, dynamic canvas trajectories, and animated timeline progress.
 */
class GameplayEngine {
  constructor() {
    this.isPlaying = false;
    this.mode = 'notes'; // 'notes' (Screen 3) or 'chords' (Screen 4)
    this.score = 0;
    this.targetScore = 3450;
    this.multiplier = 3;
    this.combo = 5;
    this.progress = 0;
    this.bpm = 85;
    this.scrollSpeed = 220; // pixels per second
    this.lastTime = 0;
    this.animationFrame = null;

    // Default Note Track (Screen 3)
    this.defaultNotes = [
      { id: 1, string: 2, fret: 3, time: 2.0, finger: 1, label: '3', hit: false },
      { id: 2, string: 2, fret: 0, time: 4.5, finger: 0, label: '0', hit: false },
      { id: 3, string: 3, fret: 2, time: 7.0, finger: 2, label: '2', hit: false },
      { id: 4, string: 1, fret: 1, time: 9.5, finger: 1, label: '1', hit: false },
      { id: 5, string: 2, fret: 3, time: 12.0, finger: 1, label: '3', hit: false },
      { id: 6, string: 3, fret: 0, time: 14.5, finger: 0, label: '0', hit: false },
      { id: 7, string: 2, fret: 3, time: 17.0, finger: 1, label: '3', hit: false },
      { id: 8, string: 2, fret: 0, time: 19.5, finger: 0, label: '0', hit: false }
    ];

    // Default Chord Track (Screen 4)
    this.defaultChords = [
      { id: 1, chord: 'Am', time: 2.5, width: 330, color: '#ea5b57', label: 'Am', hit: false },
      { id: 2, chord: 'Am', time: 6.5, width: 300, color: '#aa22e6', label: 'Am', hit: false },
      { id: 3, chord: 'C',  time: 10.5, width: 330, color: '#27ae60', label: 'C', hit: false },
      { id: 4, chord: 'Em', time: 14.5, width: 300, color: '#e67e22', label: 'Em', hit: false },
      { id: 5, chord: 'Am', time: 18.5, width: 330, color: '#ea5b57', label: 'Am', hit: false }
    ];

    this.notesTrack = [];
    this.chordsTrack = [];

    this.currentTime = 0;
    this.songDuration = 22.0;
    this.speedMultiplier = 1.0; // 0.5x, 0.75x, 1.0x, 1.25x

    // String vertical percentage offsets (string 1 thin steel at top -> string 6 thick wound at bottom)
    this.stringRatios = {
      1: 0.355,
      2: 0.465,
      3: 0.576,
      4: 0.687,
      5: 0.797,
      6: 0.907
    };

    // Dictionary of fingerings for the mini HUD chord diagram
    // Fretboard layout: 6 strings (y: 14=E4, 28=B3, 42=G3, 56=D3, 70=A2, 78=E2)
    // Frets: 1 (cx: 33), 2 (cx: 63), 3 (cx: 93)
    this.chordDiagrams = {
      'Am': {
        dots: [
          { cx: 33, cy: 28, color: '#f39c12', finger: 1 }, // Cuerda 2, traste 1
          { cx: 63, cy: 56, color: '#00d2ff', finger: 2 }, // Cuerda 4, traste 2
          { cx: 63, cy: 42, color: '#e024c3', finger: 3 }  // Cuerda 3, traste 2
        ]
      },
      'C': {
        dots: [
          { cx: 33, cy: 28, color: '#f39c12', finger: 1 }, // Cuerda 2, traste 1
          { cx: 63, cy: 56, color: '#00d2ff', finger: 2 }, // Cuerda 4, traste 2
          { cx: 93, cy: 70, color: '#e024c3', finger: 3 }  // Cuerda 5, traste 3
        ]
      },
      'Em': {
        dots: [
          { cx: 63, cy: 70, color: '#00d2ff', finger: 2 }, // Cuerda 5, traste 2
          { cx: 63, cy: 56, color: '#e024c3', finger: 3 }  // Cuerda 4, traste 2
        ]
      },
      'G': {
        dots: [
          { cx: 63, cy: 70, color: '#00d2ff', finger: 2 }, // Cuerda 5, traste 2
          { cx: 93, cy: 78, color: '#e024c3', finger: 3 }, // Cuerda 6, traste 3
          { cx: 93, cy: 14, color: '#f39c12', finger: 1 }  // Cuerda 1, traste 3
        ]
      },
      'D': {
        dots: [
          { cx: 63, cy: 42, color: '#f39c12', finger: 1 }, // Cuerda 3, traste 2
          { cx: 63, cy: 14, color: '#00d2ff', finger: 2 }, // Cuerda 1, traste 2
          { cx: 93, cy: 28, color: '#e024c3', finger: 3 }  // Cuerda 2, traste 3
        ]
      },
      'Dm': {
        dots: [
          { cx: 33, cy: 14, color: '#f39c12', finger: 1 }, // Cuerda 1, traste 1
          { cx: 63, cy: 42, color: '#00d2ff', finger: 2 }, // Cuerda 3, traste 2
          { cx: 93, cy: 28, color: '#e024c3', finger: 3 }  // Cuerda 2, traste 3
        ]
      },
      'F': {
        dots: [
          { cx: 33, cy: 14, color: '#f39c12', finger: 1 }, // Cejilla traste 1
          { cx: 33, cy: 28, color: '#f39c12', finger: 1 },
          { cx: 63, cy: 42, color: '#00d2ff', finger: 2 }, // Cuerda 3, traste 2
          { cx: 93, cy: 56, color: '#e024c3', finger: 3 }  // Cuerda 4, traste 3
        ]
      },
      'E': {
        dots: [
          { cx: 33, cy: 42, color: '#f39c12', finger: 1 }, // Cuerda 3, traste 1
          { cx: 63, cy: 70, color: '#00d2ff', finger: 2 }, // Cuerda 5, traste 2
          { cx: 63, cy: 56, color: '#e024c3', finger: 3 }  // Cuerda 4, traste 2
        ]
      }
    };

    this.currentActiveChordName = 'Am';
  }

  setSpeed(speed) {
    this.speedMultiplier = Math.max(0.25, Math.min(2.0, parseFloat(speed) || 1.0));
  }

  seekTo(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.currentTime = clamped * this.songDuration;
    this.progress = clamped;

    // Reset hit flags for notes/chords ahead of new currentTime
    const list = this.mode === 'notes' ? this.notesTrack : this.chordsTrack;
    list.forEach(item => {
      item.hit = item.time < this.currentTime;
      item.missed = false;
      if (item.el) {
        item.el.classList.remove('hit-flash');
        item.el.classList.remove('miss-flash');
      }
    });

    this.renderFrame();
    this.updateUI();
  }

  init(mode = 'notes') {
    this.mode = mode;
    this.score = 0;
    this.multiplier = 1;
    this.combo = 0;
    this.comboInTier = 0; // 0 to 5 dots
    this.currentTime = 0;
    this.progress = 0;

    if (mode === 'notes') {
      this.targetScore = 3450;
      this.songDuration = 22.0;
      this.notesTrack = JSON.parse(JSON.stringify(this.defaultNotes));
      this.buildDOMNotes();
    } else {
      this.targetScore = 3050;
      this.songDuration = 22.0;
      this.chordsTrack = JSON.parse(JSON.stringify(this.defaultChords));
      this.buildDOMChords();
    }

    this.renderTimelineMarkers();
    this.updateUI();
    this.renderFrame();
    this.startPlaying();
  }

  setMode(mode) {
    this.init(mode);
  }

  loadCustomSong(songData) {
    this.mode = songData.mode || 'notes';
    this.bpm = songData.bpm || 85;
    this.scrollSpeed = (this.bpm / 60) * 160; // scale scroll speed to tempo
    const beatSeconds = 60 / this.bpm;
    this.songDuration = Math.max(12, ((songData.measures || 8) * 4) * beatSeconds);
    this.score = 0;
    this.currentTime = 0;
    this.progress = 0;

    if (this.mode === 'notes') {
      this.targetScore = Math.max(1200, (songData.notes.length || 6) * 450);
      this.notesTrack = songData.notes.map((n, idx) => {
        const beatIndex = (n.measure - 1) * 4 + (n.beat - 1);
        return {
          id: n.id || idx,
          string: n.string,
          fret: n.fret,
          time: beatIndex * beatSeconds + 1.5,
          finger: n.finger,
          label: `${n.fret}`,
          hit: false
        };
      });
      this.notesTrack.sort((a, b) => a.time - b.time);
      this.buildDOMNotes();
    } else {
      this.targetScore = Math.max(1200, (songData.chords.length || 4) * 750);
      this.chordsTrack = songData.chords.map((c, idx) => {
        const beatIndex = (c.measure - 1) * 4 + (c.beat - 1);
        return {
          id: c.id || idx,
          chord: c.chord,
          time: beatIndex * beatSeconds + 1.5,
          width: (c.durationBeats || 4) * 70,
          color: c.color || '#ea5b57',
          label: c.chord,
          hit: false
        };
      });
      this.chordsTrack.sort((a, b) => a.time - b.time);
      this.buildDOMChords();
    }

    // Update Section Title on Screen
    const sectionLabels = document.querySelectorAll('.game-section-label');
    sectionLabels.forEach(lbl => {
      lbl.textContent = songData.section || songData.title || 'Canción';
    });

    this.renderTimelineMarkers();
    this.updateUI();
    this.renderFrame();
    this.startPlaying();
  }

  buildDOMNotes() {
    const container = document.querySelector('#view-notes .fretboard-canvas-container');
    if (!container) return;

    // Clear existing notes
    container.querySelectorAll('.game-note-capsule').forEach(el => el.remove());

    const fingerClasses = {
      0: 'note-capsule-grey',
      1: 'note-capsule-orange',
      2: 'note-capsule-cyan',
      3: 'note-capsule-magenta',
      4: 'note-capsule-purple'
    };

    const fingerColors = {
      0: 'linear-gradient(180deg, #8a929e 0%, #6e7683 100%)',
      1: 'linear-gradient(180deg, #f5a623 0%, #e67e22 100%)',
      2: 'linear-gradient(180deg, #00d2ff 0%, #0099cc 100%)',
      3: 'linear-gradient(180deg, #e024c3 0%, #b8149e 100%)',
      4: 'linear-gradient(180deg, #8e44ad 0%, #6c3483 100%)'
    };

    this.notesTrack.forEach(note => {
      const capsule = document.createElement('div');
      capsule.className = `game-note-capsule ${fingerClasses[note.finger] || 'note-capsule-orange'}`;
      capsule.dataset.string = note.string;
      capsule.dataset.fret = note.fret;
      capsule.textContent = note.label;
      if (fingerColors[note.finger]) {
        capsule.style.background = fingerColors[note.finger];
      }
      capsule.style.width = '180px';
      capsule.style.left = '0px';
      capsule.style.top = '0px';
      capsule.style.willChange = 'transform';

      capsule.addEventListener('click', () => {
        this.userPlayString(note.string, note.fret);
      });

      note.el = capsule;
      container.appendChild(capsule);
    });
  }

  buildDOMChords() {
    const container = document.querySelector('#view-chords .fretboard-canvas-container');
    if (!container) return;

    container.querySelectorAll('.game-chord-block').forEach(el => el.remove());

    this.chordsTrack.forEach(chord => {
      const blockFrag = GuitarDOM.cloneTemplate('tpl-game-chord-block');
      const block = GuitarDOM.firstElement(blockFrag);
      block.dataset.chord = chord.chord;
      block.style.background = chord.color;
      block.style.width = `${chord.width}px`;
      block.style.left = '0px';
      block.style.willChange = 'transform';
      GuitarDOM.setSlotText(block, 'label', chord.label);

      block.addEventListener('click', () => {
        this.userPlayChord(chord.chord);
      });

      chord.el = block;
      container.appendChild(blockFrag);
    });
  }

  startPlaying() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.lastTime = performance.now();
      this.updatePlayPauseIcons();
      this.loop(this.lastTime);
    }
  }

  pausePlaying() {
    this.isPlaying = false;
    this.updatePlayPauseIcons();
    cancelAnimationFrame(this.animationFrame);
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pausePlaying();
    } else {
      this.startPlaying();
    }
  }

  updatePlayPauseIcons() {
    const playBtns = document.querySelectorAll('.play-pause-btn');
    playBtns.forEach(btn => {
      const iconId = this.isPlaying ? 'tpl-icon-pause' : 'tpl-icon-play';
      btn.replaceChildren(GuitarDOM.cloneTemplate(iconId));
    });
  }

  loop(now) {
    if (!this.isPlaying) return;
    const rawDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const dt = rawDt * this.speedMultiplier;

    // Advance song time
    this.currentTime += dt;
    if (this.currentTime >= this.songDuration) {
      this.currentTime = 0;
      this.resetHits();
    }

    this.progress = this.currentTime / this.songDuration;

    this.renderFrame();
    this.updateUI();

    this.animationFrame = requestAnimationFrame((t) => this.loop(t));
  }

  resetHits() {
    const list = this.mode === 'notes' ? this.notesTrack : this.chordsTrack;
    list.forEach(item => {
      item.hit = false;
      item.missed = false;
      if (item.el) {
        item.el.classList.remove('hit-flash');
        item.el.classList.remove('miss-flash');
      }
    });
  }

  renderFrame() {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const container = document.querySelector(`${activeViewId} .fretboard-canvas-container`);
    if (!container) return;

    const width = container.clientWidth || 1100;
    const height = container.clientHeight || 340;
    const hitZoneX = width * 0.35; // The fixed cyan target line where ball lands

    if (this.mode === 'notes') {
      this.renderNotesMotion(width, height, hitZoneX);
    } else {
      this.renderChordsMotion(width, height, hitZoneX);
    }
  }

  renderNotesMotion(width, height, hitZoneX) {
    const container = document.querySelector('#view-notes .fretboard-canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : null;
    const stringEls = container ? container.querySelectorAll('.track-string') : null;

    // Dynamically calculate the exact Y center of each string directly from DOM elements
    const stringYs = {};
    if (stringEls && stringEls.length === 6 && containerRect && containerRect.height > 0) {
      stringEls.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        stringYs[index + 1] = (rect.top - containerRect.top) + (rect.height / 2);
      });
    } else {
      stringYs[1] = height * this.stringRatios[1];
      stringYs[2] = height * this.stringRatios[2];
      stringYs[3] = height * this.stringRatios[3];
      stringYs[4] = height * this.stringRatios[4];
      stringYs[5] = height * this.stringRatios[5];
      stringYs[6] = height * this.stringRatios[6];
    }

    // 1. Move and position note capsules along the runway
    this.notesTrack.forEach(note => {
      if (!note.el) return;

      // Note X position relative to hitZoneX
      const noteX = hitZoneX + (note.time - this.currentTime) * this.scrollSpeed;
      const noteY = stringYs[note.string] || (height * 0.7);

      // Only show if reasonably close to viewport
      if (noteX > -260 && noteX < width + 300) {
        note.el.style.display = 'flex';
        note.el.style.transform = `translate3d(${noteX}px, ${noteY}px, 0) translateY(-50%)`;
      } else {
        note.el.style.display = 'none';
      }

      // Note hit window evaluation:
      // If note passes the target line with reasonable grace period for acoustic latency (currentTime > note.time + 0.45) without being played -> MISS
      if (!note.hit && !note.missed) {
        if (this.currentTime > note.time + 0.45) {
          note.missed = true;
          this.triggerNoteMiss(note);
        }
      }
    });

    // 2. Ball Physics: Calculate smooth parabolic bounce between notes
    let ballY = height * 0.7; // fallback
    let currentTargetStringY = height * 0.7;

    // Find previous note and next upcoming note
    let prevNote = null;
    let nextNote = null;

    for (let i = 0; i < this.notesTrack.length; i++) {
      const n = this.notesTrack[i];
      if (n.time <= this.currentTime) {
        prevNote = n;
      } else {
        nextNote = n;
        break;
      }
    }

    if (prevNote && nextNote) {
      const interval = nextNote.time - prevNote.time;
      const u = Math.max(0, Math.min(1, (this.currentTime - prevNote.time) / interval));
      const startY = stringYs[prevNote.string];
      const endY = stringYs[nextNote.string];
      const baseY = startY + (endY - startY) * u;
      const arcPeak = 75;
      const bounceHeight = 4 * arcPeak * u * (1 - u);
      ballY = baseY - bounceHeight;
      currentTargetStringY = baseY;
    } else if (nextNote) {
      // Approaching first note
      const timeToHit = nextNote.time - this.currentTime;
      const u = Math.max(0, 1 - timeToHit / 2.0);
      const targetY = stringYs[nextNote.string];
      const arcPeak = 65;
      const bounceHeight = 4 * arcPeak * u * (1 - u);
      ballY = targetY - bounceHeight;
    } else if (prevNote) {
      // Past last note
      ballY = stringYs[prevNote.string];
    }

    // Position bouncing ball
    const ballEl = document.querySelector('#view-notes .bouncing-ball');
    if (ballEl) {
      ballEl.style.left = `${hitZoneX}px`;
      ballEl.style.top = `${ballY}px`;
    }

    // 3. Draw Moving Dotted Parabolic Trajectory on Canvas
    const canvas = document.querySelector('#view-notes .trajectory-canvas');
    if (canvas) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

      // Draw parabolic arcs connecting consecutive notes
      for (let i = 0; i < this.notesTrack.length - 1; i++) {
        const n1 = this.notesTrack[i];
        const n2 = this.notesTrack[i + 1];

        const x1 = hitZoneX + (n1.time - this.currentTime) * this.scrollSpeed;
        const y1 = stringYs[n1.string];
        const x2 = hitZoneX + (n2.time - this.currentTime) * this.scrollSpeed;
        const y2 = stringYs[n2.string];

        // Draw if within visible horizon
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

      // Pre-bounce trail before the first note
      if (this.notesTrack.length > 0) {
        const firstNote = this.notesTrack[0];
        const fx = hitZoneX + (firstNote.time - this.currentTime) * this.scrollSpeed;
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

  renderChordsMotion(width, height, hitZoneX) {
    const chordBaseY = height * 0.62;

    // Find current active chord (the one currently passing the hitZone or upcoming)
    let currentActiveChord = null;
    let closestUpcoming = null;
    let minUpcomingDiff = Infinity;

    for (const chord of this.chordsTrack) {
      const blockWidth = chord.width || 300;
      const startX = hitZoneX + (chord.time - this.currentTime) * this.scrollSpeed;
      const endX = startX + blockWidth;

      // Is the ball/hitline currently inside this chord block?
      if (hitZoneX >= startX - 20 && hitZoneX <= endX + 40) {
        currentActiveChord = chord;
        break;
      }

      // Or find the closest upcoming chord
      const diff = chord.time - this.currentTime;
      if (diff > 0 && diff < minUpcomingDiff) {
        minUpcomingDiff = diff;
        closestUpcoming = chord;
      }
    }

    const chordToDisplay = currentActiveChord || closestUpcoming || this.chordsTrack[0];
    if (chordToDisplay && chordToDisplay.chord !== this.currentActiveChordName) {
      this.updateHudChordCard(chordToDisplay.chord);
    }

    // Move chord blocks from right to left
    this.chordsTrack.forEach(chord => {
      if (!chord.el) return;

      const chordX = hitZoneX + (chord.time - this.currentTime) * this.scrollSpeed;

      if (chordX > -400 && chordX < width + 400) {
        chord.el.style.display = 'flex';
        chord.el.style.transform = `translate3d(${chordX}px, 0, 0)`;
      } else {
        chord.el.style.display = 'none';
      }

      // Hit detection
      if (!chord.hit && Math.abs(this.currentTime - chord.time) < 0.1) {
        chord.hit = true;
        this.triggerChordHit(chord);
      }
    });

    // Bouncing ball for chords
    const ballEl = document.querySelector('#view-chords .bouncing-ball');
    let ballY = chordBaseY;
    if (this.isPlaying) {
      const cycle = (this.currentTime * 2) % 1;
      const h = Math.sin(cycle * Math.PI) * 35;
      ballY = chordBaseY - h;
    }
    if (ballEl) {
      ballEl.style.left = `${hitZoneX}px`;
      ballEl.style.top = `${ballY}px`;
    }

    // Trajectory for chords
    const canvas = document.querySelector('#view-chords .trajectory-canvas');
    if (canvas) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';

      for (let i = 0; i < this.chordsTrack.length - 1; i++) {
        const c1 = this.chordsTrack[i];
        const c2 = this.chordsTrack[i + 1];
        const x1 = hitZoneX + (c1.time - this.currentTime) * this.scrollSpeed;
        const x2 = hitZoneX + (c2.time - this.currentTime) * this.scrollSpeed;

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

  triggerNoteHit(note) {
    if (window.guitarAudio) {
      window.guitarAudio.playString(note.string, note.fret);
      window.guitarAudio.playHitSound();
    }

    // Increment combo
    this.combo++;
    this.comboInTier++;

    // Every 5 consecutive hits, level up multiplier (1x -> 2x -> 3x -> 4x max)
    if (this.comboInTier >= 5) {
      this.comboInTier = 0;
      if (this.multiplier < 4) {
        this.multiplier++;
        this.triggerMultiplierPopup();
      }
    }

    this.score += 150 * this.multiplier;
    if (this.score > this.targetScore) this.score = this.targetScore;

    if (note.el) {
      note.el.classList.remove('miss-flash');
      note.el.classList.add('hit-flash');
      setTimeout(() => note.el.classList.remove('hit-flash'), 220);
    }

    const ball = document.querySelector('#view-notes .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${150 * this.multiplier}`, false);
    this.updateUI();
  }

  triggerNoteMiss(note) {
    // Break combo and reset multiplier to 1x
    this.combo = 0;
    this.comboInTier = 0;
    this.multiplier = 1;

    // Play dull miss error sound
    if (window.guitarAudio && typeof window.guitarAudio.playMissSound === 'function') {
      window.guitarAudio.playMissSound();
    }

    if (note.el) {
      note.el.classList.add('miss-flash');
    }

    // Spawn red floating "MISS" particle
    this.spawnScoreParticle('MISS', true);
    this.updateUI();
  }

  // Called when user plucks a note (either clicking the note or playing the string on guitar)
  userPlayString(stringNum, fret = 0) {
    if (window.guitarAudio) {
      window.guitarAudio.playString(stringNum, fret);
    }

    if (!this.isPlaying || this.mode !== 'notes') return;

    // Find the closest upcoming or current note within hit window (+/- 0.35s)
    let bestNote = null;
    let minDiff = Infinity;

    for (const note of this.notesTrack) {
      if (note.hit || note.missed) continue;
      const diff = Math.abs(this.currentTime - note.time);
      if (diff <= 0.38 && diff < minDiff) {
        minDiff = diff;
        bestNote = note;
      }
    }

    if (bestNote) {
      // Check if user played matching string (and fret if specified)
      const stringMatches = parseInt(bestNote.string) === parseInt(stringNum);
      const fretMatches = fret === undefined || parseInt(bestNote.fret) === parseInt(fret);

      if (stringMatches && fretMatches) {
        bestNote.hit = true;
        this.triggerNoteHit(bestNote);
      } else {
        // Wrong note played
        bestNote.missed = true;
        this.triggerNoteMiss(bestNote);
      }
    }
  }

  // Handle pitch detected from real microphone during gameplay
  handleMicNoteDetected(freq, stringMatch, fretMatch) {
    if (!this.isPlaying || this.mode !== 'notes') return;

    // Find the closest upcoming or active note within hit tolerance (+/- 0.65s)
    let bestNote = null;
    let minDiff = Infinity;

    for (const note of this.notesTrack) {
      if (note.hit || note.missed) continue;
      const diff = Math.abs(this.currentTime - note.time);
      if (diff <= 0.65 && diff < minDiff) {
        minDiff = diff;
        bestNote = note;
      }
    }

    if (!bestNote) {
      return;
    }

    // Target note exact frequency (e.g. Cuerda 2, Traste 3 = D4 ~ 293.7 Hz)
    const targetFreq = window.guitarAudio ? window.guitarAudio.getFretFrequency(bestNote.string, bestNote.fret) : 293.7;
    const diffPercent = Math.abs(freq - targetFreq) / targetFreq;

    // Also check for sub-harmonic (octave below / half frequency) or second harmonic (double frequency)
    const halfFreqDiff = Math.abs(freq - (targetFreq / 2)) / (targetFreq / 2);
    const doubleFreqDiff = Math.abs(freq - (targetFreq * 2)) / (targetFreq * 2);

    // Check direct fret match from audio analysis
    const exactFretMatched = fretMatch && 
      parseInt(fretMatch.string) === parseInt(bestNote.string) && 
      parseInt(fretMatch.fret) === parseInt(bestNote.fret);

    // Tolerant matching:
    // 1. Direct pitch within 12% tolerance
    // 2. Harmonic/octave within 8% tolerance
    // 3. Exact fretMatch
    // 4. Open-string match if target note is fret 0
    const matchesPitch = diffPercent < 0.12 || halfFreqDiff < 0.08 || doubleFreqDiff < 0.08;
    const matchesOpenString = parseInt(bestNote.fret) === 0 && stringMatch && parseInt(stringMatch.string) === parseInt(bestNote.string);

    console.log(`[Canción: Nota] Objetivo: Cuerda ${bestNote.string} Traste ${bestNote.fret} (${targetFreq.toFixed(1)}Hz) | Detectada: ${freq}Hz (Dif: ${(diffPercent * 100).toFixed(1)}%) | Match: ${exactFretMatched || matchesPitch || matchesOpenString ? '✅ SÍ' : '❌ NO'}`);

    if (exactFretMatched || matchesPitch || matchesOpenString) {
      console.log(`%c[Canción] ¡ACIERTO VERIFICADO! Cuerda ${bestNote.string} Traste ${bestNote.fret} con ${freq}Hz`, 'color: #2ecc71; font-weight: bold;');
      bestNote.hit = true;
      this.triggerNoteHit(bestNote);
    }
  }

  handleMicChordDetected(freq) {
    if (!this.isPlaying || this.mode !== 'chords') return;

    let bestChord = null;
    let minDiff = Infinity;

    for (const chord of this.chordsTrack) {
      if (chord.hit || chord.missed) continue;
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff <= 0.55 && diff < minDiff) {
        minDiff = diff;
        bestChord = chord;
      }
    }

    if (!bestChord) return;

    console.log(`[Canción: Acordes] Acorde actual: ${bestChord.chord} | Sonido detectado: ${freq}Hz`);
    bestChord.hit = true;
    this.triggerChordHit(bestChord);
  }

  // Called when user strums a chord
  userPlayChord(chordName) {
    if (window.guitarAudio) {
      window.guitarAudio.playChord(chordName);
    }

    if (!this.isPlaying || this.mode !== 'chords') return;

    let bestChord = null;
    let minDiff = Infinity;

    for (const chord of this.chordsTrack) {
      if (chord.hit || chord.missed) continue;
      const diff = Math.abs(this.currentTime - chord.time);
      if (diff <= 0.5 && diff < minDiff) {
        minDiff = diff;
        bestChord = chord;
      }
    }

    if (bestChord) {
      if (bestChord.chord === chordName) {
        bestChord.hit = true;
        this.triggerChordHit(bestChord);
      } else {
        bestChord.missed = true;
        this.triggerChordMiss(bestChord);
      }
    }
  }

  triggerChordMiss(chord) {
    this.combo = 0;
    this.comboInTier = 0;
    this.multiplier = 1;

    if (window.guitarAudio && typeof window.guitarAudio.playMissSound === 'function') {
      window.guitarAudio.playMissSound();
    }

    if (chord.el) {
      chord.el.classList.add('miss-flash');
    }

    this.spawnScoreParticle('MISS', true);
    this.updateUI();
  }

  updateHudChordCard(chordName) {
    this.currentActiveChordName = chordName;

    // Update title text in the mini HUD card
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

    // Re-render the mini fretboard SVG dots for this chord
    const svgEl = document.querySelector('.hud-chord-mini-svg');
    if (svgEl) {
      // Remove any existing finger dots
      svgEl.querySelectorAll('.hud-finger-dot').forEach(dot => dot.remove());

      const diagram = this.chordDiagrams[chordName] || this.chordDiagrams['Am'];
      if (diagram && diagram.dots) {
        diagram.dots.forEach(d => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'hud-finger-dot');
          circle.setAttribute('cx', d.cx);
          circle.setAttribute('cy', d.cy);
          circle.setAttribute('r', '4.5');
          circle.setAttribute('fill', d.color);
          svgEl.appendChild(circle);
        });
      }
    }
  }

  triggerChordHit(chord) {
    if (window.guitarAudio) {
      window.guitarAudio.playChord(chord.chord);
      window.guitarAudio.playHitSound();
    }

    // Increment combo
    this.combo++;
    this.comboInTier++;

    // Level up multiplier every 3 chord hits (chords are longer)
    if (this.comboInTier >= 3) {
      this.comboInTier = 0;
      if (this.multiplier < 4) {
        this.multiplier++;
        this.triggerMultiplierPopup();
      }
    }

    this.score += 300 * this.multiplier;
    if (this.score > this.targetScore) this.score = this.targetScore;

    if (chord.el) {
      chord.el.classList.add('hit-flash');
      setTimeout(() => chord.el.classList.remove('hit-flash'), 220);
    }

    const ball = document.querySelector('#view-chords .bouncing-ball');
    if (ball) {
      ball.classList.add('hit-pulse');
      setTimeout(() => ball.classList.remove('hit-pulse'), 250);
    }

    this.spawnScoreParticle(`+${300 * this.multiplier}`);
    this.updateUI();
  }

  triggerMultiplierPopup() {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const multBox = document.querySelector(`${activeViewId} .hud-multiplier-box`);
    if (multBox) {
      multBox.classList.add('multiplier-up');
      setTimeout(() => multBox.classList.remove('multiplier-up'), 380);
    }
  }

  spawnScoreParticle(text, isMiss = false) {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const container = document.querySelector(`${activeViewId} .fretboard-canvas-container`);
    if (!container) return;

    const particle = document.createElement('div');
    particle.className = `hit-score-particle ${isMiss ? 'particle-miss' : ''}`;
    particle.textContent = text;
    particle.style.left = '35%';
    particle.style.top = isMiss ? '42%' : '38%';
    container.appendChild(particle);

    setTimeout(() => {
      particle.remove();
    }, 850);
  }

  renderTimelineMarkers() {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';
    const trackArea = document.querySelector(`${activeViewId} .timeline-track-area`);
    if (!trackArea) return;

    // Remove previously generated dynamic markers
    trackArea.querySelectorAll('.timeline-mini-marker').forEach(m => m.remove());

    if (this.mode === 'notes') {
      const fingerColors = {
        0: '#8a929e',
        1: '#f5a623',
        2: '#00d2ff',
        3: '#e024c3',
        4: '#8e44ad'
      };

      this.notesTrack.forEach(n => {
        const leftPercent = (n.time / this.songDuration) * 100;
        if (leftPercent >= 0 && leftPercent <= 100) {
          const marker = document.createElement('div');
          marker.className = 'timeline-mini-marker type-note';
          marker.style.left = `${leftPercent}%`;
          marker.style.background = fingerColors[n.finger] || '#f5a623';
          trackArea.appendChild(marker);
        }
      });
    } else {
      // Chords markers
      this.chordsTrack.forEach(c => {
        const leftPercent = (c.time / this.songDuration) * 100;
        const widthPercent = Math.max(3, (c.width / (this.scrollSpeed * this.songDuration)) * 100);
        if (leftPercent >= 0 && leftPercent <= 100) {
          const marker = document.createElement('div');
          marker.className = 'timeline-mini-marker type-chord';
          marker.style.left = `${leftPercent}%`;
          marker.style.width = `${widthPercent}%`;
          marker.style.background = c.color || '#ea5b57';
          trackArea.appendChild(marker);
        }
      });
    }
  }

  setupScrubbingListeners() {
    const trackAreas = document.querySelectorAll('.timeline-track-area');
    trackAreas.forEach(track => {
      let isDragging = false;

      const handleSeek = (e) => {
        const rect = track.getBoundingClientRect();
        if (rect.width > 0) {
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const ratio = (clientX - rect.left) / rect.width;
          this.seekTo(ratio);
        }
      };

      track.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleSeek(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (isDragging) {
          handleSeek(e);
        }
      });

      window.addEventListener('mouseup', () => {
        isDragging = false;
      });

      // Touch events for mobile/tablets
      track.addEventListener('touchstart', (e) => {
        isDragging = true;
        handleSeek(e);
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (isDragging) {
          handleSeek(e);
        }
      }, { passive: true });

      window.addEventListener('touchend', () => {
        isDragging = false;
      });
    });
  }

  updateUI() {
    const activeViewId = this.mode === 'notes' ? '#view-notes' : '#view-chords';

    // Update score numbers
    const scoreEls = document.querySelectorAll(`${activeViewId} .current-score`);
    scoreEls.forEach(el => el.textContent = Math.floor(this.score));

    const targetScoreEls = document.querySelectorAll(`${activeViewId} .target-score`);
    targetScoreEls.forEach(el => el.textContent = this.targetScore);

    // Update multiplier text (1x, 2x, 3x, 4x)
    const multTexts = document.querySelectorAll(`${activeViewId} .hud-multiplier-text`);
    multTexts.forEach(el => {
      el.textContent = `${this.multiplier}×`;
    });

    // Update combo dots (5 dots total)
    const comboDots = document.querySelectorAll(`${activeViewId} .hud-combo-dot`);
    comboDots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx < this.comboInTier);
    });

    // Update bottom progress fill & animated playhead pin
    const percent = Math.min(100, Math.max(0, this.progress * 100));

    const progressFills = document.querySelectorAll(`${activeViewId} .timeline-progress-green, ${activeViewId} .progress-fill`);
    progressFills.forEach(fill => {
      fill.style.width = `${percent}%`;
    });

    const playheads = document.querySelectorAll(`${activeViewId} .timeline-playhead`);
    playheads.forEach(pin => {
      pin.style.left = `${percent}%`;
    });
  }
}

window.gameplayEngine = new GameplayEngine();
document.addEventListener('DOMContentLoaded', () => {
  window.gameplayEngine.setupScrubbingListeners();
});

