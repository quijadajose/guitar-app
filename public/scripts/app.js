/**
 * Yousician Guitar App Coordinator
 * Manages screen switching, interactive tuner, mic calibration, chord practice, gameplay, and song editor.
 */
document.addEventListener('DOMContentLoaded', () => {
  const screens = {
    menu: document.getElementById('view-menu'),
    tuner: document.getElementById('view-tuner'),
    practice: document.getElementById('view-practice'),
    notes: document.getElementById('view-notes'),
    chords: document.getElementById('view-chords'),
    editor: document.getElementById('view-editor')
  };

  const navBtns = document.querySelectorAll('.view-tab-btn');
  const skipBtns = document.querySelectorAll('.btn-skip');
  const menuCards = document.querySelectorAll('.menu-card');
  const backBtns = document.querySelectorAll('.btn-back-menu');

  let currentScreenId = 'menu';

  // Navigation Switcher
  function switchScreen(targetId) {
    if (!screens[targetId]) {
      console.warn(`Screen ${targetId} not found`);
      return;
    }

    currentScreenId = targetId;
    if (window.location.hash !== `#${targetId}`) {
      window.location.hash = targetId;
    }

    // Update navigation button active state (if present)
    navBtns.forEach(btn => {
      const isTarget = btn.getAttribute('data-target') === targetId;
      btn.classList.toggle('active', isTarget);
    });

    // Toggle screen views
    Object.keys(screens).forEach(id => {
      const view = screens[id];
      if (view) {
        if (id === targetId) {
          view.classList.remove('view-hidden');
          view.classList.add('view-active');
        } else {
          view.classList.remove('view-active');
          view.classList.add('view-hidden');
        }
      }
    });

    // Handle view specific initializations & autoplay motion
    if (targetId === 'notes') {
      if (window.gameplayEngine) {
        window.gameplayEngine.setMode('notes');
        window.gameplayEngine.startPlaying();
      }
    } else if (targetId === 'chords') {
      if (window.gameplayEngine) {
        window.gameplayEngine.setMode('chords');
        window.gameplayEngine.startPlaying();
      }
    } else {
      if (window.gameplayEngine) {
        window.gameplayEngine.pausePlaying();
      }
      if (targetId === 'editor' && window.songEditor) {
        window.songEditor.renderGrid();
      }
    }

    // Trigger canvas resize for the newly active view
    setTimeout(resizeCanvases, 50);

    // Audio click feedback
    try {
      if (window.guitarAudio) {
        window.guitarAudio.playClickSound();
      }
    } catch (err) {
      console.log('Audio gesture:', err);
    }

    // Tuner view activation logic: if entering tuner and not granted yet, show prompt
    if (targetId === 'tuner') {
      if (typeof isMicActive !== 'undefined' && !isMicActive && !hasGrantedMicPermission) {
        if (micOverlay) micOverlay.classList.remove('hidden');
      }
    } else {
      // If leaving tuner, stop mic pitch tracking to conserve battery and CPU
      if (typeof stopTunerMicrophone === 'function' && isMicActive) {
        stopTunerMicrophone();
      }
    }

    // Practice view microphone tracking
    if (targetId === 'practice') {
      if (typeof startPracticeMicrophone === 'function') {
        startPracticeMicrophone();
      }
    } else {
      if (typeof stopPracticeMicrophone === 'function') {
        stopPracticeMicrophone();
      }
    }

    // Gameplay view (notes & chords) microphone tracking
    if (targetId === 'notes' || targetId === 'chords') {
      if (typeof startGameplayMicrophone === 'function') {
        startGameplayMicrophone();
      }
    } else {
      if (typeof stopGameplayMicrophone === 'function') {
        stopGameplayMicrophone();
      }
    }

  }

  window.switchGuitarScreen = switchScreen;

  // Nav buttons click handlers
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-target');
      if (target) {
        switchScreen(target);
      }
    });
  });

  // Main Menu Cards Click Handlers
  menuCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const target = card.getAttribute('data-nav');
      if (target) {
        switchScreen(target);
      }
    });
    // Keyboard accessibility (Enter or Space)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const target = card.getAttribute('data-nav');
        if (target) {
          switchScreen(target);
        }
      }
    });
  });

  // Back to Menu buttons
  backBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchScreen('menu');
    });
  });

  // "Omitir" (Skip) buttons advance to the next screen in flow:
  // Tuner -> Practice -> Notes -> Chords -> Editor -> Fretboard -> Menu
  const flowOrder = ['tuner', 'practice', 'notes', 'chords', 'editor', 'menu'];
  skipBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentIndex = flowOrder.indexOf(currentScreenId);
      const nextIndex = (currentIndex + 1) % flowOrder.length;
      switchScreen(flowOrder[nextIndex]);
    });
  });

  // Handle hash changes
  function checkHash() {
    const hash = window.location.hash.replace('#', '');
    if (screens[hash]) {
      switchScreen(hash);
    } else {
      switchScreen('menu');
    }
  }

  window.addEventListener('hashchange', checkHash);

  // ==========================================
  // ==========================================
  // SCREEN 1: AFINADOR (GUITAR TUNER)
  // ==========================================
  const pegButtons = document.querySelectorAll('.tuner-peg-badge');
  const pitchIndicator = document.getElementById('tuner-pitch-indicator');
  const tunerPitchLabel = document.getElementById('tuner-pitch-label');
  let tunerPitchSlots = null;

  function fillTunerPitchLabel(name, spanish, freq) {
    if (!tunerPitchLabel) return;
    if (!tunerPitchSlots) {
      const frag = GuitarDOM.cloneTemplate('tpl-tuner-pitch-label');
      tunerPitchLabel.replaceChildren(frag);
      tunerPitchSlots = {
        name: GuitarDOM.slot(tunerPitchLabel, 'name'),
        spanish: GuitarDOM.slot(tunerPitchLabel, 'spanish'),
        freq: GuitarDOM.slot(tunerPitchLabel, 'freq')
      };
    }
    if (tunerPitchSlots.name) tunerPitchSlots.name.textContent = name;
    if (tunerPitchSlots.spanish) tunerPitchSlots.spanish.textContent = spanish;
    if (tunerPitchSlots.freq) tunerPitchSlots.freq.textContent = freq;
  }

  fillTunerPitchLabel('E4', 'Mi agudo', '329.6');

  const tunerCentsLabel = document.getElementById('tuner-cents-label');
  const tunerPromptText = document.getElementById('tuner-prompt-text');
  const tunerCompleteTitle = document.getElementById('tuner-complete-title');
  const tunerContinueBtn = document.getElementById('tuner-continue-btn');

  const tuningInfo = {
    1: { name: 'E4', string: 1, freq: 329.63, noteSpanish: 'Mi agudo', cents: 0 },
    2: { name: 'B3', string: 2, freq: 246.94, noteSpanish: 'Si', cents: 0 },
    3: { name: 'G3', string: 3, freq: 196.00, noteSpanish: 'Sol', cents: 0 },
    4: { name: 'D3', string: 4, freq: 146.83, noteSpanish: 'Re', cents: 0 },
    5: { name: 'A2', string: 5, freq: 110.00, noteSpanish: 'La', cents: 0 },
    6: { name: 'E2', string: 6, freq: 82.41, noteSpanish: 'Mi grave', cents: 0 }
  };

  let activePeg = 2;
  let tunerCooldownTimer = null;
  let autoProgressTimer = null;
  const tunedStrings = new Set();
  const tuningOrder = [6, 5, 4, 3, 2, 1];

  function showTunerComplete() {
    if (tunerCompleteTitle) {
      tunerCompleteTitle.textContent = '¡Listo, está afinado!';
      tunerCompleteTitle.classList.add('visible');
    }
    if (tunerPromptText) {
      tunerPromptText.style.display = 'none';
    }
    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'Todas las cuerdas afinadas correctamente';
      tunerCentsLabel.style.color = '#00d68f';
    }
    if (tunerContinueBtn) {
      tunerContinueBtn.classList.add('visible');
    }
    if (window.guitarAudio && typeof window.guitarAudio.playCompletionFanfare === 'function') {
      window.guitarAudio.playCompletionFanfare();
    }

    // Stop mic and automatically return to menu after celebratory fanfare (2.2s)
    setTimeout(() => {
      stopTunerMicrophone();
      switchScreen('menu');
    }, 2200);
  }

  function markStringTuned(pegNum) {
    const checkEl = document.getElementById(`tuner-check-${pegNum}`);
    const isNew = !tunedStrings.has(pegNum);
    tunedStrings.add(pegNum);

    if (checkEl) {
      checkEl.classList.add('tuned');
      if (isNew) {
        checkEl.classList.add('pop-in');
        setTimeout(() => checkEl.classList.remove('pop-in'), 600);
      }
    }

    if (isNew && window.guitarAudio && typeof window.guitarAudio.playTunedChime === 'function') {
      window.guitarAudio.playTunedChime();
    }

    // Check if all 6 are tuned
    if (tunedStrings.size === 6) {
      showTunerComplete();
    } else if (isNew) {
      // Auto progress to next untuned string (matching video sequence)
      if (autoProgressTimer) clearTimeout(autoProgressTimer);
      autoProgressTimer = setTimeout(() => {
        const nextUntuned = tuningOrder.find(s => !tunedStrings.has(s));
        if (nextUntuned) {
          const slider = document.getElementById('tuner-manual-slider');
          if (slider) slider.value = 0;
          activatePeg(nextUntuned, 0, true, true);
        }
      }, 1200);
    }
  }

  function resetTunerActiveState() {
    // Clear vibration on all strings
    document.querySelectorAll('.headstock-string').forEach(str => {
      str.classList.remove('vibrating');
      if (str._vibrateTimeout) {
        clearTimeout(str._vibrateTimeout);
        str._vibrateTimeout = null;
      }
    });

    // Remove active from floating fret tags
    document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));

    // Remove active highlight from peg badges
    document.querySelectorAll('.tuner-peg-badge').forEach(b => {
      b.classList.remove('active');
    });

    // Reset pitch indicator to neutral
    if (pitchIndicator) {
      pitchIndicator.style.transform = 'translateX(0px)';
      pitchIndicator.classList.remove('in-tune');
    }

    if (tunerPromptText && tunedStrings.size < 6) {
      tunerPromptText.textContent = 'Toca una cuerda para afinar';
    }

    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'En espera de pulsación...';
      tunerCentsLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    }

    if (detectedFreqLabel && isMicActive) {
      detectedFreqLabel.textContent = 'En espera de sonido...';
      detectedFreqLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    }
  }

  function animateStringVibration(stringNum, durationMs = 650) {
    const stringLine = document.getElementById(`tuner-string-${stringNum}`);
    const fretTag = document.getElementById(`tuner-string-tag-${stringNum}`);

    // Show floating string number beside the active vibrating string
    document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));
    if (fretTag) {
      fretTag.classList.add('active');
    }

    if (!stringLine) return;

    if (stringLine._vibrateTimeout) {
      clearTimeout(stringLine._vibrateTimeout);
    }
    stringLine.classList.remove('vibrating');
    void stringLine.offsetWidth;
    stringLine.classList.add('vibrating');

    stringLine._vibrateTimeout = setTimeout(() => {
      stringLine.classList.remove('vibrating');
      stringLine._vibrateTimeout = null;
      if (fretTag) {
        fretTag.classList.remove('active');
      }
    }, durationMs);
  }

  function activatePeg(pegNum, manualCents, playSound = false, vibrate = false) {
    activePeg = pegNum;
    const info = tuningInfo[pegNum];
    if (!info) return;

    // Reset any pending cooldown timer whenever user plays/clicks
    if (tunerCooldownTimer) {
      clearTimeout(tunerCooldownTimer);
      tunerCooldownTimer = null;
    }

    // Highlight peg badge with white glowing state
    document.querySelectorAll('.tuner-peg-badge').forEach(b => {
      const bPeg = parseInt(b.getAttribute('data-peg'));
      b.classList.toggle('active', bPeg === pegNum);
    });

    // Play string sound on user click/selection
    if (playSound) {
      try {
        if (window.guitarAudio) {
          window.guitarAudio.playString(info.string, 0, 2.5, 0.95);
        }
      } catch (e) {
        console.warn('Audio error:', e);
      }
    }

    // Vibrate string and show fret tag
    if (vibrate) {
      animateStringVibration(pegNum, 1400);
    }

    // Pitch needle position
    const effectiveCents = manualCents !== undefined ? manualCents : info.cents;
    const pxOffset = (Math.max(-40, Math.min(40, effectiveCents)) / 40) * 90;

    const isInTune = Math.abs(effectiveCents) <= 5;

    if (pitchIndicator) {
      pitchIndicator.style.transform = `translateX(${pxOffset}px)`;
      pitchIndicator.classList.toggle('in-tune', isInTune);
    }

    // Mark as tuned when in tune zone and user played/plucked or microphone tuned it
    if (isInTune && (playSound || vibrate || manualCents !== undefined)) {
      markStringTuned(pegNum);
    }

    if (tunerPitchLabel) {
      fillTunerPitchLabel(info.name, info.noteSpanish, info.freq.toFixed(1));
    }

    if (tunerCentsLabel) {
      if (isInTune) {
        tunerCentsLabel.textContent = '¡AFINADO!';
        tunerCentsLabel.style.color = '#00d68f';
      } else if (effectiveCents > 0) {
        tunerCentsLabel.textContent = `+${effectiveCents} cents (Demasiado alto)`;
        tunerCentsLabel.style.color = '#e74c3c';
      } else {
        tunerCentsLabel.textContent = `${effectiveCents} cents (Demasiado bajo)`;
        tunerCentsLabel.style.color = '#e74c3c';
      }
    }

    // Cooldown: after 700ms of no sound, clear active state and stop vibrating
    tunerCooldownTimer = setTimeout(() => {
      resetTunerActiveState();
    }, 700);
  }

  pegButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pegNum = parseInt(btn.getAttribute('data-peg'));
      const slider = document.getElementById('tuner-manual-slider');
      if (slider) slider.value = 0;
      // Pluck the string: play sound, vibrate string, show number, and register tuning
      activatePeg(pegNum, 0, true, true);
    });
  });

  // Tuner manual deviation slider
  const tunerSlider = document.getElementById('tuner-manual-slider');
  if (tunerSlider) {
    tunerSlider.addEventListener('input', (e) => {
      const cents = parseInt(e.target.value);
      activatePeg(activePeg, cents, false, false);
    });
  }

  // Continue button (transitions to Practice / Lesson screen)
  if (tunerContinueBtn) {
    tunerContinueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchScreen('practice');
    });
  }

  // ==========================================
  // REAL MICROPHONE LISTENING & STRING MATCHING
  // ==========================================
  const micToggleBtn = document.getElementById('tuner-mic-toggle');
  const micLabel = document.getElementById('tuner-mic-label');
  const detectedFreqLabel = document.getElementById('tuner-detected-freq-label');
  const micOverlay = document.getElementById('tuner-mic-overlay');
  const btnEnableMic = document.getElementById('tuner-btn-enable-mic');
  const btnManualMode = document.getElementById('tuner-btn-manual-mode');
  let isMicActive = false;
  let hasGrantedMicPermission = false;

  async function startTunerMicrophone() {
    if (!window.guitarAudio) return false;
    if (detectedFreqLabel) {
      detectedFreqLabel.textContent = 'Solicitando permiso...';
      detectedFreqLabel.style.color = '#f1c40f';
    }

    let smoothedCents = null;
    let lastPitchTime = 0;

    const started = await window.guitarAudio.startMicrophonePitchTracking((data) => {
      if (!data) return;

      const now = performance.now();

      if (data.freq && data.stringMatch) {
        const match = data.stringMatch;
        if (detectedFreqLabel) {
          detectedFreqLabel.textContent = `${data.freq} Hz (${match.name}: ${match.cents > 0 ? '+' : ''}${match.cents}c)`;
          detectedFreqLabel.style.color = match.inTune ? '#2ecc71' : '#f1c40f';
        }

        // Apply smooth exponential moving average to cents deviation
        if (smoothedCents === null || activePeg !== match.string) {
          smoothedCents = match.cents;
        } else {
          smoothedCents = smoothedCents * 0.72 + match.cents * 0.28;
        }

        // Throttle rapid visual jumps so movement is progressive and natural
        if (now - lastPitchTime > 120) {
          lastPitchTime = now;
          activatePeg(match.string, Math.round(smoothedCents), false, true);
        }
      } else if (data.freq) {
        // Sound detected, but not close to any standard open guitar string
        if (detectedFreqLabel) {
          detectedFreqLabel.textContent = `${data.freq} Hz (Ajustando...)`;
          detectedFreqLabel.style.color = 'rgba(255, 255, 255, 0.7)';
        }
        const activeInfo = tuningInfo[activePeg];
        if (activeInfo && now - lastPitchTime > 150) {
          lastPitchTime = now;
          const diffCents = Math.round(1200 * Math.log2(data.freq / activeInfo.freq));
          const clampedCents = Math.max(-40, Math.min(40, diffCents));
          if (smoothedCents === null) {
            smoothedCents = clampedCents;
          } else {
            smoothedCents = smoothedCents * 0.8 + clampedCents * 0.2;
          }
          activatePeg(activePeg, Math.round(smoothedCents), false, false);
        }
      } else {
        smoothedCents = null;
        // When no clear guitar string frequency is present, immediately stop vibrations and wait
        document.querySelectorAll('.headstock-string').forEach(str => str.classList.remove('vibrating'));
        document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));

        if (detectedFreqLabel) {
          detectedFreqLabel.textContent = 'En espera de sonido...';
          detectedFreqLabel.style.color = 'rgba(255, 255, 255, 0.6)';
        }
      }
    });

    if (started) {
      isMicActive = true;
      hasGrantedMicPermission = true;
      if (micOverlay) micOverlay.classList.add('hidden');
      if (micToggleBtn) micToggleBtn.classList.add('listening');
      if (micLabel) micLabel.textContent = 'Micrófono Activo';
      if (tunerPromptText && tunedStrings.size < 6) {
        tunerPromptText.textContent = 'Toca una cuerda para afinar';
      }
      return true;
    } else {
      if (detectedFreqLabel) {
        detectedFreqLabel.textContent = 'Permiso denegado';
        detectedFreqLabel.style.color = '#e74c3c';
      }
      alert('No se pudo acceder al micrófono. Por favor permite el acceso al micrófono en el navegador para afinación automática.');
      return false;
    }
  }

  function stopTunerMicrophone() {
    if (window.guitarAudio) {
      window.guitarAudio.stopMicrophonePitchTracking();
    }
    isMicActive = false;
    if (micToggleBtn) micToggleBtn.classList.remove('listening');
    if (micLabel) micLabel.textContent = 'Activar Micrófono';
    if (detectedFreqLabel) {
      detectedFreqLabel.textContent = 'Micrófono apagado';
      detectedFreqLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    }
  }

  // Hook up Permission Modal Buttons
  if (btnEnableMic) {
    btnEnableMic.addEventListener('click', async (e) => {
      e.stopPropagation();
      await startTunerMicrophone();
    });
  }

  if (btnManualMode) {
    btnManualMode.addEventListener('click', (e) => {
      e.stopPropagation();
      if (micOverlay) micOverlay.classList.add('hidden');
      if (tunerPromptText && tunedStrings.size < 6) {
        tunerPromptText.textContent = 'Modo manual: pulsa una clavija o usa el simulador';
      }
      if (detectedFreqLabel) {
        detectedFreqLabel.textContent = 'Modo manual activo';
        detectedFreqLabel.style.color = 'rgba(255, 255, 255, 0.6)';
      }
    });
  }

  if (micToggleBtn) {
    micToggleBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isMicActive) {
        await startTunerMicrophone();
      } else {
        stopTunerMicrophone();
      }
    });
  }


  // ==========================================
  // SCREEN 2: PRÁCTICA / CALIBRACIÓN
  // ==========================================
  const chordCard = document.getElementById('practice-chord-card');
  const micLeds = document.querySelectorAll('.mic-meter-dot');
  let micInterval = null;

  function startMicSimulation() {
    if (micInterval) clearInterval(micInterval);
    micInterval = setInterval(() => {
      const count = Math.floor(Math.random() * 4) + 1;
      micLeds.forEach((dot, idx) => {
        dot.classList.toggle('active', idx < count);
      });
    }, 120);
  }
  startMicSimulation();

  function triggerMicChordPulse() {
    let count = 12;
    const pulseTimer = setInterval(() => {
      count--;
      micLeds.forEach((dot, idx) => {
        dot.classList.toggle('active', idx < count);
      });
      if (count <= 2) {
        clearInterval(pulseTimer);
        startMicSimulation();
      }
    }, 40);
  }

  // Chord sequence for practice with characteristic frequencies
  const practiceChords = [
    {
      name: 'Am',
      nutIndicators: ['O', '', '', '', 'O', 'X'],
      // Am notes: A2 (110Hz), E3 (164.8Hz), A3 (220Hz), C4 (261.6Hz), E4 (329.6Hz)
      notes: [110.0, 164.8, 220.0, 261.6, 329.6],
      dots: [
        { class: 'dot-index-finger', left: '10%', top: '28%', title: 'Dedo 1 (Índice) - Cuerda 2, Traste 1' },
        { class: 'dot-middle-finger', left: '30%', top: '46%', title: 'Dedo 2 (Medio) - Cuerda 4, Traste 2' },
        { class: 'dot-ring-finger', left: '30%', top: '63%', title: 'Dedo 3 (Anular) - Cuerda 3, Traste 2' }
      ]
    },
    {
      name: 'C',
      nutIndicators: ['O', '', '', 'O', '', 'X'],
      // C notes: C3 (130.8Hz), E3 (164.8Hz), G3 (196Hz), C4 (261.6Hz), E4 (329.6Hz)
      notes: [130.8, 164.8, 196.0, 261.6, 329.6],
      dots: [
        { class: 'dot-index-finger', left: '10%', top: '28%', title: 'Dedo 1 (Índice) - Cuerda 2, Traste 1' },
        { class: 'dot-middle-finger', left: '30%', top: '46%', title: 'Dedo 2 (Medio) - Cuerda 4, Traste 2' },
        { class: 'dot-ring-finger', left: '50%', top: '80%', title: 'Dedo 3 (Anular) - Cuerda 5, Traste 3' }
      ]
    },
    {
      name: 'Em',
      nutIndicators: ['O', 'O', 'O', '', '', 'O'],
      // Em notes: E2 (82.4Hz), B2 (123.5Hz), E3 (164.8Hz), G3 (196Hz), B3 (246.9Hz), E4 (329.6Hz)
      notes: [82.4, 123.5, 164.8, 196.0, 246.9, 329.6],
      dots: [
        { class: 'dot-middle-finger', left: '30%', top: '80%', title: 'Dedo 2 (Medio) - Cuerda 5, Traste 2' },
        { class: 'dot-ring-finger', left: '30%', top: '63%', title: 'Dedo 3 (Anular) - Cuerda 4, Traste 2' }
      ]
    },
    {
      name: 'G',
      nutIndicators: ['', 'O', 'O', 'O', '', ''],
      // G notes: G2 (98.0Hz), B2 (123.5Hz), D3 (146.8Hz), G3 (196Hz), B3 (246.9Hz), G4 (392Hz)
      notes: [98.0, 123.5, 146.8, 196.0, 246.9, 392.0],
      dots: [
        { class: 'dot-index-finger', left: '30%', top: '80%', title: 'Dedo 1 (Índice) - Cuerda 5, Traste 2' },
        { class: 'dot-middle-finger', left: '50%', top: '96%', title: 'Dedo 2 (Medio) - Cuerda 6, Traste 3' },
        { class: 'dot-ring-finger', left: '50%', top: '12%', title: 'Dedo 3 (Anular) - Cuerda 1, Traste 3' }
      ]
    }
  ];

  let currentPracticeIndex = 0;
  let isAdvancingChord = false;

  const chordNameEl = document.getElementById('practice-chord-name');
  const chordDiagramEl = document.getElementById('practice-chord-diagram');
  const successCheckEl = document.getElementById('practice-success-check');
  const dotsContainer = document.getElementById('practice-dots-container');
  const nutColumn = document.getElementById('practice-nut-column');
  const stepCounterEl = document.querySelector('.practice-step-counter');

  function renderPracticeChord(index) {
    const chord = practiceChords[index];
    if (!chord) return;

    if (chordNameEl) chordNameEl.textContent = chord.name;
    if (stepCounterEl) {
      stepCounterEl.textContent = `${index + 1} / ${practiceChords.length}`;
    }

    const fingerDotClasses = new Set([
      'dot-index-finger',
      'dot-middle-finger',
      'dot-ring-finger',
      'dot-pinky-finger'
    ]);

    if (nutColumn && chord.nutIndicators) {
      GuitarDOM.clearChildren(nutColumn);
      chord.nutIndicators.forEach((sym) => {
        const frag = GuitarDOM.cloneTemplate('tpl-nut-indicator');
        GuitarDOM.setSlotText(frag, 'symbol', sym);
        nutColumn.appendChild(frag);
      });
    }

    if (dotsContainer && chord.dots) {
      GuitarDOM.clearChildren(dotsContainer);
      chord.dots.forEach((d) => {
        const frag = GuitarDOM.cloneTemplate('tpl-chord-finger-dot');
        const dot = GuitarDOM.firstElement(frag);
        if (fingerDotClasses.has(d.class)) {
          dot.classList.add(d.class);
        }
        dot.style.left = d.left;
        dot.style.top = d.top;
        dot.title = d.title;
        dotsContainer.appendChild(frag);
      });
    }

    // Hide success checkmark
    if (successCheckEl) successCheckEl.classList.remove('show');
    if (chordDiagramEl) chordDiagramEl.classList.remove('chord-success');
  }

  // Initialize practice view
  renderPracticeChord(0);

  function handleChordSuccess() {
    if (isAdvancingChord) return;
    isAdvancingChord = true;

    const chord = practiceChords[currentPracticeIndex];

    // Sound feedback
    try {
      if (window.guitarAudio) {
        window.guitarAudio.playChord(chord.name);
        if (typeof window.guitarAudio.playHitSound === 'function') {
          setTimeout(() => window.guitarAudio.playHitSound(), 180);
        }
      }
    } catch (e) {}

    triggerMicChordPulse();

    // Show verified checkmark badge and feedback toast
    if (successCheckEl) successCheckEl.classList.add('show');
    if (chordDiagramEl) chordDiagramEl.classList.add('chord-success');

    const feedback = document.getElementById('practice-feedback');
    if (feedback) {
      feedback.textContent = `¡Correcto! Acorde ${chord.name} verificado`;
      feedback.classList.add('show');
      setTimeout(() => feedback.classList.remove('show'), 1500);
    }

    // Advance to next chord after short rewarding animation
    setTimeout(() => {
      if (currentPracticeIndex < practiceChords.length - 1) {
        currentPracticeIndex++;
        renderPracticeChord(currentPracticeIndex);
        isAdvancingChord = false;
      } else {
        // Completed all practice chords -> advance to gameplay/notes screen
        if (feedback) {
          feedback.textContent = '¡Práctica completada! Iniciando canción...';
          feedback.classList.add('show');
        }
        setTimeout(() => {
          isAdvancingChord = false;
          switchScreen('notes');
        }, 1200);
      }
    }, 1100);
  }

  let isPracticeMicActive = false;

  async function startPracticeMicrophone() {
    if (!window.guitarAudio || isPracticeMicActive) return;
    isPracticeMicActive = true;

    await window.guitarAudio.startMicrophonePitchTracking((data) => {
      if (!data || !data.freq) return;

      console.log(`[Mic Práctica] Frecuencia detectada: ${data.freq} Hz (Volumen RMS: ${data.rms?.toFixed(3)})`);

      // Update microphone volume LEDs based on real input energy
      if (data.rms) {
        const level = Math.min(12, Math.max(1, Math.round(data.rms * 90)));
        micLeds.forEach((dot, idx) => {
          dot.classList.toggle('active', idx < level);
        });
      }

      if (isAdvancingChord) return;

      const currentChord = practiceChords[currentPracticeIndex];
      if (!currentChord || !currentChord.notes) return;

      // Check if detected frequency matches any note in the current chord (within 8%)
      const matchesChordNote = currentChord.notes.some(noteFreq => {
        return Math.abs(data.freq - noteFreq) / noteFreq < 0.08;
      });

      if (matchesChordNote) {
        console.log(`%c[Mic Práctica] ¡Coincidencia! Nota detectada para acorde ${currentChord.name}`, 'color: #00d68f; font-weight: bold;');
        handleChordSuccess();
      }
    });
  }

  function stopPracticeMicrophone() {
    if (!isPracticeMicActive) return;
    isPracticeMicActive = false;
    if (window.guitarAudio) {
      window.guitarAudio.stopMicrophonePitchTracking();
    }
  }

  // ==========================================
  // GAMEPLAY REAL MICROPHONE TRACKING & CONSOLE LOGS
  // ==========================================
  let isGameplayMicActive = false;

  async function startGameplayMicrophone() {
    if (!window.guitarAudio || isGameplayMicActive) return;
    isGameplayMicActive = true;

    console.log('%c[Mic Canción] Escucha activa en canción...', 'color: #2fe7b6; font-weight: bold;');

    await window.guitarAudio.startMicrophonePitchTracking((data) => {
      if (!data || !data.freq) return;

      console.log(`[Mic Canción] 🎵 Nota detectada: ${data.freq} Hz | Cuerda estimada: ${data.stringMatch?.name || 'Incierta'} (RMS: ${data.rms?.toFixed(3)})`);

      if (!window.gameplayEngine || !window.gameplayEngine.isPlaying) return;

      if (window.gameplayEngine.mode === 'notes') {
        // Match detected frequency with target notes (including fret and octave match)
        window.gameplayEngine.handleMicNoteDetected(data.freq, data.stringMatch, data.fretMatch);
      } else if (window.gameplayEngine.mode === 'chords') {
        window.gameplayEngine.handleMicChordDetected(data.freq);
      }
    });
  }

  function stopGameplayMicrophone() {
    if (!isGameplayMicActive) return;
    isGameplayMicActive = false;
    console.log('[Mic Canción] Micrófono detenido en canción.');
    if (window.guitarAudio) {
      window.guitarAudio.stopMicrophonePitchTracking();
    }
  }

  if (chordCard) {
    chordCard.addEventListener('click', () => {
      handleChordSuccess();
    });
  }

  // Practice Speed Controls (50%, 75%, 100%, 125%)
  const speedButtons = document.querySelectorAll('.practice-speed-controller .speed-btn');
  speedButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const speedVal = parseFloat(btn.getAttribute('data-speed')) || 1.0;
      if (window.gameplayEngine) {
        window.gameplayEngine.setSpeed(speedVal);
      }

      const feedback = document.getElementById('practice-feedback');
      if (feedback) {
        feedback.textContent = `Velocidad de práctica: ${Math.round(speedVal * 100)}%`;
        feedback.classList.add('show');
        setTimeout(() => feedback.classList.remove('show'), 1400);
      }

      if (window.guitarAudio) {
        window.guitarAudio.playClickSound();
      }
    });
  });


  // ==========================================
  // SCREENS 3 & 4: GAMEPLAY CONTROLS
  // ==========================================
  const playPauseBtns = document.querySelectorAll('.play-pause-btn');
  playPauseBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.gameplayEngine) {
        window.gameplayEngine.togglePlay();
      }
    });
  });

  // Note capsule clicking
  document.querySelectorAll('.game-note-capsule').forEach(noteEl => {
    noteEl.addEventListener('click', () => {
      const string = parseInt(noteEl.getAttribute('data-string') || 2);
      const fret = parseInt(noteEl.getAttribute('data-fret') || 3);
      if (window.gameplayEngine) {
        window.gameplayEngine.userPlayString(string, fret);
      } else if (window.guitarAudio) {
        window.guitarAudio.playString(string, fret);
        window.guitarAudio.playHitSound();
      }
      noteEl.classList.add('note-clicked');
      setTimeout(() => noteEl.classList.remove('note-clicked'), 200);
    });
  });

  // Chord block clicking
  document.querySelectorAll('.game-chord-block').forEach(chordEl => {
    chordEl.addEventListener('click', () => {
      const chord = chordEl.getAttribute('data-chord') || 'Am';
      if (window.gameplayEngine) {
        window.gameplayEngine.userPlayChord(chord);
      } else if (window.guitarAudio) {
        window.guitarAudio.playChord(chord);
        window.guitarAudio.playHitSound();
      }
      chordEl.classList.add('chord-clicked');
      setTimeout(() => chordEl.classList.remove('chord-clicked'), 200);
    });
  });

  // Hand icon tooltip modal
  document.querySelectorAll('.finger-legend-icon').forEach(hand => {
    hand.addEventListener('click', () => {
      const tooltip = document.getElementById('hand-legend-modal');
      if (tooltip) {
        tooltip.classList.toggle('visible');
      }
    });
  });

  document.addEventListener('click', (e) => {
    const modal = document.getElementById('hand-legend-modal');
    if (modal && modal.classList.contains('visible') && !e.target.closest('.finger-legend-icon') && !e.target.closest('#hand-legend-modal')) {
      modal.classList.remove('visible');
    }
  });

  // Resize canvases
  function resizeCanvases() {
    const canvases = document.querySelectorAll('.trajectory-canvas');
    canvases.forEach(canvas => {
      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 0) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
      }
    });
    if (window.gameplayEngine) {
      window.gameplayEngine.renderTrajectory();
    }
  }

  window.addEventListener('resize', resizeCanvases);
  setTimeout(resizeCanvases, 100);

  // Keyboard navigation shortcuts: 1, 2, 3, 4, 5
  window.addEventListener('keydown', (e) => {
    if (e.key === '1' && e.altKey) switchScreen('tuner');
    if (e.key === '2' && e.altKey) switchScreen('practice');
    if (e.key === '3' && e.altKey) switchScreen('notes');
    if (e.key === '4' && e.altKey) switchScreen('chords');
    if (e.key === '5' && e.altKey) switchScreen('editor');
    if (e.key === ' ') {
      if (window.gameplayEngine) window.gameplayEngine.togglePlay();
    }

    // Interactive gameplay keys (1 to 6 or Enter to pluck string when in notes screen)
    if (!e.altKey && !e.ctrlKey && !e.metaKey && window.gameplayEngine && window.gameplayEngine.isPlaying) {
      const keyMap = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
      if (keyMap[e.key]) {
        window.gameplayEngine.userPlayString(keyMap[e.key]);
      } else if (e.key === 'Enter') {
        // Pluck whatever string the ball is currently targeting
        const upcoming = window.gameplayEngine.notesTrack.find(n => !n.hit && !n.missed && Math.abs(window.gameplayEngine.currentTime - n.time) <= 0.4);
        if (upcoming) {
          window.gameplayEngine.userPlayString(upcoming.string, upcoming.fret);
        }
      }
    }
  });

  // Initialize
  if (window.songEditor) {
    window.songEditor.init();
  }

  checkHash();
  // Set initial selected peg without triggering sound or vibrations
  activePeg = 2;
  document.querySelectorAll('.tuner-peg-badge').forEach(b => {
    b.classList.toggle('active', parseInt(b.getAttribute('data-peg')) === 2);
  });
});
