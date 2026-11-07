import { readPlayer } from '../../player';
import { gameplayEngine } from '../gameplay';
import { ROOM_CODE } from './shared';
import type { VersusLobby } from '../versusLobby';

export function setupListeners(eng: VersusLobby): void {
  // Modo selector
  const modeButtons = eng.container?.querySelectorAll<HTMLElement>('#vs-step-online [data-mode]');
  modeButtons?.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedMode = eng.readMode(btn.getAttribute('data-mode'));
      eng.renderPublicRooms();
    });
  });
  const localModes = eng.container?.querySelectorAll<HTMLElement>('#vs-step-local [data-local-mode]');
  localModes?.forEach((btn) => {
    btn.addEventListener('click', () => {
      localModes.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedMode = eng.readMode(btn.getAttribute('data-local-mode'));
    });
  });
  const localSongs = eng.container?.querySelectorAll<HTMLElement>('#vs-step-local [data-local-song]');
  localSongs?.forEach((btn) => {
    btn.addEventListener('click', () => {
      localSongs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedSongId = btn.getAttribute('data-local-song') || 'sultans_swing';
    });
  });

  document.getElementById('vs-btn-create-room')?.addEventListener('click', () => {
    void eng.createRoom();
  });

  document.getElementById('vs-btn-local')?.addEventListener('click', () => {
    eng.startLocalMatch();
  });

  eng.container?.querySelectorAll<HTMLElement>('[data-vs-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.vsPath === 'online' ? 'online' : 'local';
      eng.showPath(path);
    });
  });
  document.querySelector('#view-vs .btn-back-menu')?.addEventListener('click', (event) => {
    const how = document.getElementById('vs-step-how');
    if (eng.client || eng.currentRoomCode) {
      event.preventDefault();
      event.stopPropagation();
      eng.leaveRoom();
      return;
    }
    if (how?.hidden) {
      event.preventDefault();
      event.stopPropagation();
      eng.showPath('how');
    }
  }, true);

  document.getElementById('vs-btn-refresh-rooms')?.addEventListener('click', () => {
    void eng.refreshPublicRooms();
  });

  // Unirse a sala
  document.getElementById('vs-btn-join-room')?.addEventListener('click', () => {
    const code = eng.roomCodeInput?.value.trim().toUpperCase() ?? '';
    if (ROOM_CODE.test(code)) {
      void eng.joinRoom(code);
    } else {
      eng.setStatus('Ingresá un código de 5 letras o números', true);
    }
  });

  // Copiar enlace
  document.getElementById('vs-copy-code')?.addEventListener('click', () => {
    const link = eng.roomLinkInput?.value;
    if (!link) return;
    if (!navigator.clipboard) {
      eng.setStatus(`Copiá este enlace: ${link}`);
      return;
    }
    navigator.clipboard.writeText(link).then(() => {
      const button = document.getElementById('vs-copy-code');
      const label = button?.querySelector('.hub-kicker');
      button?.classList.add('is-copied');
      if (label) label.textContent = 'Enlace copiado';
      window.setTimeout(() => {
        button?.classList.remove('is-copied');
        if (label) label.textContent = 'Clic para copiar';
      }, 1400);
    }).catch(() => {
      eng.setStatus(`No se pudo copiar. Enlace: ${link}`, true);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (eng.myRole !== 'host') return;
      eng.selectedMode = eng.readMode(btn.dataset.roomMode);
      eng.paintRoomSettings();
      eng.pushRoomSettings();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('#vs-active-room [data-room-song]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (eng.myRole !== 'host') return;
      eng.selectedSongId = btn.dataset.roomSong || 'sultans_swing';
      eng.paintRoomSettings();
      eng.pushRoomSettings();
    });
  });
  document.getElementById('vs-chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('vs-chat-input') as HTMLInputElement | null;
    const text = input?.value.trim().slice(0, 180) ?? '';
    if (!text || !eng.client) return;
    eng.client.send({ type: 'chat', payload: { text } });
    if (input) input.value = '';
  });
  document.getElementById('vs-room-live-public')?.addEventListener('change', (event) => {
    if (eng.myRole !== 'host') return;
    eng.roomPublic = (event.target as HTMLInputElement).checked;
    eng.pushRoomSettings();
  });

  // Botón Listo
  eng.readyBtn?.addEventListener('click', () => {
    if (!eng.client) return;
    if (!eng.songPrepared && !eng.preloadSong()) {
      eng.setStatus('No se pudo cargar la canción de la sala', true);
      return;
    }
    const isReady = !(eng.readyBtn?.classList.contains('ready-active') ?? false);
    // El estado real llega con room_updated; acá solo se pide el cambio.
    eng.client.send({
      type: 'set_ready',
      payload: { ready: isReady },
    });
  });

  // Selector de Canción del Duelo
  const songTabs = eng.container?.querySelectorAll<HTMLElement>('#vs-step-online [data-song]');
  songTabs?.forEach((btn) => {
    btn.addEventListener('click', () => {
      songTabs.forEach((tab) => tab.classList.remove('active'));
      btn.classList.add('active');
      eng.selectedSongId = btn.getAttribute('data-song') || 'sultans_swing';
      eng.renderPublicRooms();
    });
  });

  // Botón de Ataque / Trampas (Face-Off)
  document.getElementById('vs-attack-trigger-btn')?.addEventListener('click', () => {
    gameplayEngine.launchAttack();
  });

  // Tecla Espacio para disparar ataque en Face-Off cuando esté cargado
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && gameplayEngine.isVersusActive && gameplayEngine.isFaceOffMode) {
      e.preventDefault();
      if (gameplayEngine.attackStreak >= gameplayEngine.attackThreshold) {
        gameplayEngine.launchAttack();
      }
    }
  });

  // Botón Iniciar (Host)
  eng.startBtn?.addEventListener('click', () => {
    if (eng.client && eng.myRole === 'host') {
      eng.client.send({
        type: 'start_game',
      });
    }
  });

  // Botón Revancha Rápida (Modal de Resultados)
  document.getElementById('perf-btn-rematch')?.addEventListener('click', () => {
    if (!eng.client) return;
    const rematchStatusEl = document.getElementById('perf-vs-rematch-status');
    const rematchBtn = document.getElementById('perf-btn-rematch') as HTMLButtonElement | null;
    if (rematchStatusEl) {
      rematchStatusEl.textContent = 'Solicitud de revancha enviada...';
      rematchStatusEl.hidden = false;
    }
    if (rematchBtn) {
      rematchBtn.disabled = true;
      rematchBtn.textContent = 'Esperando rival...';
    }

    // Antes el anfitrión mandaba start_game a ciegas a los 1,2 s, aunque el rival
    // no hubiera aceptado. Ahora cada uno se marca listo y el anfitrión arranca
    // cuando el servidor confirma que ambos lo están (ver room_updated).
    eng.rematchPending = true;
    eng.client.send({ type: 'request_rematch' });
    eng.client.send({ type: 'set_ready', payload: { ready: true } });
  });
}

export function showPath(eng: VersusLobby, path: 'how' | 'local' | 'online'): void {
  const how = document.getElementById('vs-step-how');
  const setup = document.getElementById('vs-step-setup');
  const local = document.getElementById('vs-step-local');
  const online = document.getElementById('vs-step-online');
  if (how) how.hidden = path !== 'how';
  if (setup) setup.hidden = path === 'how';
  if (local) local.hidden = path !== 'local';
  if (online) online.hidden = path !== 'online';
  if (path === 'online') void eng.refreshPublicRooms();
}

export function playerName(): string {
  return readPlayer()?.name || 'Invitado';
}
