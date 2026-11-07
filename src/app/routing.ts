import { probeMultiplayerServer } from '../services/network/serverStatus';
import { probeSupabase } from '../services/supabase';
import { readPlayer } from '../player';
import type { GuitarApp } from '../app';

export async function refreshBackends(eng: GuitarApp): Promise<void> {
  const [multiplayer, supabaseUp] = await Promise.all([
    probeMultiplayerServer(),
    probeSupabase()
  ]);
  eng.multiplayerOnline = multiplayer;
  eng.supabaseOnline = supabaseUp;
  document.querySelectorAll<HTMLElement>('[data-multiplayer]').forEach(el => {
    el.hidden = !multiplayer;
  });
  document.querySelectorAll<HTMLElement>('[data-supabase]').forEach(el => {
    el.hidden = !supabaseUp;
  });
  const roomLink = /(?:^|[?&])code=/i.test(window.location.hash);
  if (!multiplayer && eng.currentScreenId === 'vs' && !roomLink) eng.switchScreen('menu');
  if (!supabaseUp && eng.activeSongTab === 'community') {
    document.querySelector<HTMLButtonElement>('.song-tab-btn[data-tab="lessons"]')?.click();
  }
}

export function joinRoomWhenReady(eng: GuitarApp): void {
  const enter = (): void => {
    void eng.ensureVersus().then((lobby) => lobby.joinFromLocation());
  };
  const gateOpen = document.body.classList.contains('player-gate-open');
  if (readPlayer() && !gateOpen) {
    enter();
    return;
  }
  if (eng.waitingForPlayerToJoin) return;
  eng.waitingForPlayerToJoin = true;
  window.addEventListener('player-ready', () => {
    eng.waitingForPlayerToJoin = false;
    enter();
  }, { once: true });
}

export function checkHash(eng: GuitarApp): void {
  const raw = window.location.hash.replace(/^#/, '');
  const hash = raw.split('?')[0] || 'menu';
  const roomCode = new URLSearchParams(raw.split('?')[1] || '').get('code');
  const known = Object.prototype.hasOwnProperty.call(eng.screens, hash);
  if (known && hash === eng.currentScreenId && eng.screens[hash]?.classList.contains('view-active') && !roomCode) {
    return;
  }
  if (known && eng.screens[hash]) {
    eng.switchScreen(hash);
    if (hash === 'vs' && roomCode) {
      eng.joinRoomWhenReady();
    }
  } else {
    eng.switchScreen('menu');
  }
}
