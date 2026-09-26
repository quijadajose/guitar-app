import { guitarAudio } from './audio/audioEngine';
import { songEditor } from './components/editor';
import { gameplayEngine } from './components/gameplay';
import { sessionCalibrator } from './components/calibration';
import { tunerMotion } from './components/tunerMotion';
import type { PitchMatchResult } from './types/audio.types';
import { cloneTemplate, slot } from './dom';
import { registerScreenSwitcher, takeQueuedGameplaySong, queueGameplaySong, recallSong } from './screens';
import { listNotePickerItems, removeLibrarySong, clearLibrary } from './songLibrary';
import { soundProbeSong } from './songs/soundProbe';
import { publishLiveFrame } from './audio/liveFeed';
import { versusLobby } from './components/versusLobby';
import { probeMultiplayerServer } from './services/network/serverStatus';
import {
  fetchCommunitySongs,
  communityRecordToSongProject,
  cancelScheduledDeletion,
  currentAccountEmail,
  currentAccountProfile,
  scheduleAccountDeletion,
  scheduledDeletionDue,
  probeSupabase,
  requestMagicLink,
  requestPasswordRecovery,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  supabase,
  type DifficultyLevel
} from './services/supabase';
import { applyNoteNaming, readNoteNaming, readNotationView, writeNoteNaming, writeNotationView, type NoteNaming, type NotationView } from './notation/notationPreference';
import { clearSheet, renderSheet } from './notation/sheetView';
import type { SongProject } from './types/editor.types';

function demoSheetProject(notes: Array<{ string: number; fret: number }>, title: string): SongProject {
  return {
    title: title || 'Demostración',
    section: '',
    bpm: 90,
    mode: 'notes',
    measures: Math.max(1, Math.ceil(notes.length / 4)),
    notes: notes.map((note, index) => ({
      id: index + 1,
      measure: Math.floor(index / 4) + 1,
      beat: (index % 4) + 1,
      step: (index % 4) * 4 + 1,
      duration: 4,
      string: note.string,
      fret: note.fret,
      finger: 0
    })),
    chords: []
  };
}

export class GuitarApp {
  public screens: Record<string, HTMLElement | null> = {};
  public navBtns: NodeListOf<HTMLElement>;
  public skipBtns: NodeListOf<HTMLElement>;
  public menuCards: NodeListOf<HTMLElement>;
  public backBtns: NodeListOf<HTMLElement>;

  public currentScreenId: string = 'menu';
  public multiplayerOnline = false;
  public supabaseOnline = false;
  public readonly flowOrder: string[] = ['tuner', 'songs', 'chords', 'menu'];

  // Tuner state
  public activePeg: number = 2;
  public tunedStrings: Set<number> = new Set<number>();
  public readonly tuningOrder: number[] = [6, 5, 4, 3, 2, 1];
  public tunerCooldownTimer: number | null = null;
  public autoProgressTimer: number | null = null;
  public isMicActive: boolean = false;
  public hasGrantedMicPermission: boolean = false;
  private tunerMicCandidate: number | null = null;
  /** Milliseconds the same open string has been detected continuously. */
  private tunerMicStableFrames: number = 0;
  private tunerMicInTuneMs: number = 0;
  private tunerMicLastFrameAt: number = 0;
  private tunerSmoothedCents: number | null = null;
  private tunerLastPitchTime: number = 0;
  private tunerPitchSlots: { name: Element | null; spanish: Element | null; freq: Element | null } | null = null;
  private readonly micScreens = new Set(['tuner', 'notes', 'chords', 'fretboard']);

  public readonly tuningInfo: Record<number, { name: string; string: number; freq: number; noteSpanish: string; cents: number }> = {
    1: { name: 'E4', string: 1, freq: 329.63, noteSpanish: 'Mi agudo', cents: 0 },
    2: { name: 'B3', string: 2, freq: 246.94, noteSpanish: 'Si', cents: 0 },
    3: { name: 'G3', string: 3, freq: 196.00, noteSpanish: 'Sol', cents: 0 },
    4: { name: 'D3', string: 4, freq: 146.83, noteSpanish: 'Re', cents: 0 },
    5: { name: 'A2', string: 5, freq: 110.00, noteSpanish: 'La', cents: 0 },
    6: { name: 'E2', string: 6, freq: 82.41, noteSpanish: 'Mi grave', cents: 0 }
  };

  // Practice state
  public isGameplayMicActive: boolean = false;

  // Song Picker State
  public activeSongTab: 'lessons' | 'yours' | 'community' = 'lessons';
  public playKind: 'notes' | 'chords' = 'notes';
  public communityPage: number = 1;
  public communityDifficulty: DifficultyLevel = 'all';
  public communitySearch: string = '';
  public communityTotalPages: number = 1;
  private communityDebounceTimer: number | null = null;

  constructor() {
    this.screens = {
      menu: document.getElementById('view-menu'),
      songs: document.getElementById('view-songs'),
      tuner: document.getElementById('view-tuner'),
      notes: document.getElementById('view-notes'),
      chords: document.getElementById('view-chords'),
      editor: document.getElementById('view-editor'),
      vs: document.getElementById('view-vs')
    };

    this.navBtns = document.querySelectorAll<HTMLElement>('.view-tab-btn');
    this.skipBtns = document.querySelectorAll<HTMLElement>('.btn-skip');
    this.menuCards = document.querySelectorAll<HTMLElement>('[data-nav]');
    this.backBtns = document.querySelectorAll<HTMLElement>('.btn-back-menu');
  }

  public init(): void {
    this.setupNavigation();
    this.setupTuner();
    this.setupGameplay();
    this.setupHotkeys();
    sessionCalibrator.bind();

    songEditor.init();
    versusLobby.init();
    gameplayEngine.setupScrubbingListeners();
    this.setupNotationSettings();
    this.setupAccount();
    void this.refreshBackends();

    this.hasGrantedMicPermission =
      guitarAudio.hasMicPermission || sessionStorage.getItem('guitar_mic_granted') === '1';

    registerScreenSwitcher((id: string) => this.switchScreen(id));

    this.checkHash();
    this.activePeg = 0;
  }

  public switchScreen(targetId: string): void {
    if (targetId === 'vs' && !this.multiplayerOnline) {
      targetId = 'menu';
    }

    if (!this.screens[targetId]) {
      console.warn(`Screen ${targetId} not found`);
      return;
    }

    const fromId = this.currentScreenId;
    const alreadyVisible = fromId === targetId && this.screens[targetId]?.classList.contains('view-active');
    const queued = targetId === 'notes' || targetId === 'chords' ? takeQueuedGameplaySong() : null;

    if (alreadyVisible && !queued) {
      return;
    }

    this.currentScreenId = targetId;
    const account = document.getElementById('hub-account');
    if (account) account.hidden = targetId === 'notes' || targetId === 'chords';
    if (window.location.hash !== `#${targetId}`) {
      window.location.hash = targetId;
    }

    this.navBtns.forEach(btn => {
      const isTarget = btn.getAttribute('data-target') === targetId;
      btn.classList.toggle('active', isTarget);
    });

    Object.keys(this.screens).forEach(id => {
      const view = this.screens[id];
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

    if (targetId === 'songs') {
      this.renderSongPicker();
    }

    const notesView = this.screens.notes;
    const useSheet = targetId === 'notes' && readNotationView() === 'sheet';
    notesView?.classList.toggle('is-sheet', useSheet);

    if (targetId === 'notes' || targetId === 'chords') {
      if (queued) {
        gameplayEngine.loadCustomSong(queued);
      } else if (fromId === 'editor') {
        gameplayEngine.loadCustomSong(songEditor.currentSong);
      } else if (!gameplayEngine.isCustomSongLoaded) {
        const saved = recallSong(targetId === 'chords' ? 'chords' : 'notes');
        if (saved) gameplayEngine.loadCustomSong(saved);
        else gameplayEngine.setMode(targetId === 'chords' ? 'chords' : 'notes');
      }
      applyNoteNaming();
      if (useSheet) {
        gameplayEngine.cancelCountdown();
        gameplayEngine.pausePlaying();
        renderSheet(gameplayEngine.loadedProject ?? demoSheetProject(gameplayEngine.notesTrack, gameplayEngine.songTitle));
        requestAnimationFrame(() => {
          sessionCalibrator.start(() => gameplayEngine.beginWithCountdown());
        });
      } else {
        clearSheet();
        requestAnimationFrame(() => {
          if (gameplayEngine.mode === 'notes') gameplayEngine.buildDOMNotes();
          else gameplayEngine.buildDOMChords();
          gameplayEngine.renderFrame();
          sessionCalibrator.start(() => gameplayEngine.beginWithCountdown());
        });
      }
    } else {
      sessionCalibrator.abort();
      gameplayEngine.cancelCountdown();
      gameplayEngine.wasPlayingThisSession = false;
      gameplayEngine.pausePlaying();
      if (targetId === 'editor') {
        songEditor.renderGrid();
      }
      if (targetId !== 'notes') clearSheet();
    }

    setTimeout(() => this.resizeCanvases(), 50);

    try {
      guitarAudio.playClickSound();
    } catch {
      // ignore
    }

    this.detachAllMicListeners();
    if (targetId !== 'tuner') {
      tunerMotion.stop();
    }

    void this.syncMicForScreen(targetId);
  }

  private async refreshBackends(): Promise<void> {
    const [multiplayer, supabaseUp] = await Promise.all([
      probeMultiplayerServer(),
      probeSupabase()
    ]);
    this.multiplayerOnline = multiplayer;
    this.supabaseOnline = supabaseUp;
    document.querySelectorAll<HTMLElement>('[data-multiplayer]').forEach(el => {
      el.hidden = !multiplayer;
    });
    document.querySelectorAll<HTMLElement>('[data-supabase]').forEach(el => {
      el.hidden = !supabaseUp;
    });
    if (!multiplayer && this.currentScreenId === 'vs') this.switchScreen('menu');
    if (!supabaseUp && this.activeSongTab === 'community') {
      document.querySelector<HTMLButtonElement>('.song-tab-btn[data-tab="lessons"]')?.click();
    }
  }

  private setupAccount(): void {
    const status = document.getElementById('hub-account-status');
    const button = document.getElementById('hub-account-btn');
    if (!status || !button) return;

    const paint = async (): Promise<void> => {
      const email = await currentAccountEmail();
      if (email) {
        status.textContent = `Sesión iniciada como ${email}`;
        button.textContent = 'Tu cuenta';
      } else {
        status.textContent = 'Iniciaste como anónimo.';
        button.textContent = 'Iniciar sesión';
      }
    };

    const profile = document.createElement('dialog');
    profile.className = 'account-dialog';
    profile.innerHTML = `
      <form method="dialog">
        <header class="account-dialog-head">
          <h2>Tu cuenta</h2>
          <button type="button" class="account-dialog-close" data-profile-close aria-label="Cerrar">×</button>
        </header>
        <p class="account-dialog-lead" data-profile-email></p>
        <p class="account-dialog-lead" data-profile-since hidden></p>
        <p class="account-dialog-msg is-info" data-profile-msg hidden></p>
        <div class="account-dialog-actions">
          <button type="button" class="account-btn-ghost" data-profile-signout>Cerrar sesión</button>
          <button type="button" class="account-btn-danger" data-profile-delete>Eliminar cuenta</button>
        </div>
      </form>`;
    document.body.appendChild(profile);

    const dialog = document.createElement('dialog');
    dialog.className = 'account-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <header class="account-dialog-head">
          <h2>Iniciar sesión</h2>
          <button type="button" class="account-dialog-close" data-account-close aria-label="Cerrar">×</button>
        </header>
        <p class="account-dialog-lead">Hace falta una cuenta para cargar una canción. Podés practicar igual como anónimo.</p>
        <label class="account-field">Email
          <input type="email" name="email" required autocomplete="email" placeholder="tu@email.com" class="vs-input">
        </label>
        <label class="account-field">Contraseña
          <input type="password" name="password" minlength="6" autocomplete="current-password" placeholder="Mínimo 6 caracteres" class="vs-input">
        </label>
        <p class="account-dialog-msg" data-account-msg hidden></p>
        <div class="account-dialog-actions">
          <button type="submit" class="account-btn-primary" value="signin">Entrar</button>
          <button type="button" class="account-btn-ghost" value="signup" data-multiplayer hidden>Crear cuenta</button>
          <button type="button" class="account-btn-ghost" data-account-magic data-multiplayer hidden>Entrar con enlace al email</button>
          <button type="button" class="account-link" data-account-recover data-multiplayer hidden>Olvidé mi contraseña</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    const msg = dialog.querySelector<HTMLElement>('[data-account-msg]');
    if (!form || !msg) return;

    const showMsg = (text: string): void => {
      msg.hidden = false;
      msg.textContent = text;
    };

    const emailValue = (): string | null => {
      const email = String(new FormData(form).get('email') || '').trim();
      if (!email) {
        showMsg('Ingresá un email.');
        return null;
      }
      return email;
    };

    const credentials = (): { email: string; password: string } | null => {
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      if (!email || password.length < 6) {
        showMsg('Ingresá un email y una contraseña de al menos 6 caracteres.');
        return null;
      }
      return { email, password };
    };

    form.querySelector<HTMLButtonElement>('button[value="signup"]')?.addEventListener('click', async () => {
      const creds = credentials();
      if (!creds) return;
      const result = await signUpWithEmail(creds.email, creds.password);
      msg.hidden = false;
      if (!result.ok) {
        msg.textContent = result.error || 'No se pudo crear la cuenta.';
        return;
      }
      if (result.needsConfirmation) {
        msg.textContent = 'Cuenta creada. Confirmá el email y volvé a entrar.';
        return;
      }
      dialog.close();
      await paint();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const creds = credentials();
      if (!creds) return;
      const result = await signInWithEmail(creds.email, creds.password);
      msg.hidden = false;
      if (!result.ok) {
        msg.textContent = result.error || 'No se pudo entrar.';
        return;
      }
      dialog.close();
      await paint();
    });

    dialog.querySelector('[data-account-magic]')?.addEventListener('click', async () => {
      const email = emailValue();
      if (!email) return;
      const result = await requestMagicLink(email);
      showMsg(result.ok ? 'Te mandamos un enlace para entrar. Abrilo desde el email.' : (result.error || 'No se pudo enviar el enlace.'));
    });

    dialog.querySelector('[data-account-recover]')?.addEventListener('click', async () => {
      const email = emailValue();
      if (!email) return;
      const result = await requestPasswordRecovery(email);
      showMsg(result.ok ? 'Te mandamos un email para cambiar la contraseña.' : (result.error || 'No se pudo enviar el email.'));
    });

    button.addEventListener('click', async () => {
      const account = await currentAccountProfile();
      if (account) {
        const emailLine = profile.querySelector<HTMLElement>('[data-profile-email]');
        const sinceLine = profile.querySelector<HTMLElement>('[data-profile-since]');
        const profileMsg = profile.querySelector<HTMLElement>('[data-profile-msg]');
        if (emailLine) emailLine.textContent = account.email;
        if (sinceLine) {
          const created = account.createdAt ? new Date(account.createdAt) : null;
          if (created && !Number.isNaN(created.getTime())) {
            sinceLine.hidden = false;
            sinceLine.textContent = `Cuenta creada el ${created.toLocaleDateString('es')}.`;
          } else {
            sinceLine.hidden = true;
          }
        }
        if (profileMsg) profileMsg.hidden = true;
        profile.showModal();
        return;
      }
      msg.hidden = true;
      dialog.showModal();
    });

    profile.querySelector('[data-profile-close]')?.addEventListener('click', () => profile.close());
    profile.querySelector('[data-profile-signout]')?.addEventListener('click', async () => {
      await signOut();
      profile.close();
      await paint();
    });
    profile.querySelector('[data-profile-delete]')?.addEventListener('click', async () => {
      const profileMsg = profile.querySelector<HTMLElement>('[data-profile-msg]');
      const accepted = window.confirm('Tu cuenta se eliminará en 14 días si no volvés a iniciar sesión. ¿Seguir?');
      if (!accepted) return;
      const result = await scheduleAccountDeletion();
      profile.close();
      await paint();
      msg.hidden = false;
      msg.classList.toggle('is-info', result.ok);
      msg.textContent = result.ok
        ? 'Sesión cerrada. Tu cuenta se eliminará en 14 días. Si volvés a entrar, vas a poder restaurarla o dejar que se borre.'
        : (result.error || 'No se pudo programar la eliminación.');
      dialog.showModal();
    });
    dialog.querySelector('[data-account-close]')?.addEventListener('click', () => dialog.close());

    const restore = document.createElement('dialog');
    restore.className = 'account-dialog';
    restore.innerHTML = `
      <form method="dialog">
        <header class="account-dialog-head">
          <h2>Cuenta por borrarse</h2>
        </header>
        <p class="account-dialog-lead" data-restore-lead></p>
        <p class="account-dialog-msg" data-restore-msg hidden></p>
        <div class="account-dialog-actions">
          <button type="button" class="account-btn-primary" data-restore-keep>Restaurar cuenta</button>
          <button type="button" class="account-btn-ghost" data-restore-back>Volver atrás</button>
        </div>
      </form>`;
    document.body.appendChild(restore);
    const restoreLead = restore.querySelector<HTMLElement>('[data-restore-lead]');
    const restoreMsg = restore.querySelector<HTMLElement>('[data-restore-msg]');

    const offerRestore = async (): Promise<void> => {
      const due = await scheduledDeletionDue();
      if (!due || !restoreLead) return;
      const when = new Date(due);
      const label = Number.isNaN(when.getTime()) ? due : when.toLocaleString('es');
      restoreLead.textContent = `Tu cuenta está programada para borrarse el ${label}. Restaurala para seguir usándola, o volvé atrás y se borrará en esa fecha.`;
      if (restoreMsg) restoreMsg.hidden = true;
      if (!restore.open) restore.showModal();
    };

    restore.querySelector('[data-restore-keep]')?.addEventListener('click', async () => {
      const kept = await cancelScheduledDeletion();
      if (!kept) {
        if (restoreMsg) {
          restoreMsg.hidden = false;
          restoreMsg.textContent = 'No se pudo restaurar la cuenta.';
        }
        return;
      }
      restore.close();
      await paint();
    });
    restore.querySelector('[data-restore-back]')?.addEventListener('click', async () => {
      await signOut();
      restore.close();
      await paint();
    });

    supabase.auth.onAuthStateChange((event) => {
      void paint();
      if (event === 'SIGNED_IN') void offerRestore();
    });
    void offerRestore();

    void paint();
  }

  private setupNotationSettings(): void {
    const dialog = document.getElementById('notation-settings') as HTMLDialogElement | null;
    const open = document.getElementById('btn-notation-settings');
    const form = dialog?.querySelector('form');
    if (!dialog || !open || !form) return;

    const apply = (view: NotationView, naming: NoteNaming) => {
      form.querySelectorAll<HTMLInputElement>('input[name="notation"]').forEach(input => {
        input.checked = input.value === view;
      });
      form.querySelectorAll<HTMLInputElement>('input[name="naming"]').forEach(input => {
        input.checked = input.value === naming;
      });
    };
    apply(readNotationView(), readNoteNaming());
    applyNoteNaming();

    open.addEventListener('click', () => {
      apply(readNotationView(), readNoteNaming());
      dialog.showModal();
    });
    const commit = () => {
      const selected = form.querySelector<HTMLInputElement>('input[name="notation"]:checked');
      if (selected?.value === 'sheet' || selected?.value === 'fretboard') {
        writeNotationView(selected.value);
      }
      const naming = form.querySelector<HTMLInputElement>('input[name="naming"]:checked');
      if (naming?.value === 'solfege' || naming?.value === 'letters') {
        writeNoteNaming(naming.value);
        applyNoteNaming(naming.value);
      }
    };
    form.addEventListener('change', commit);
    form.addEventListener('submit', commit);
  }

  private setupNavigation(): void {
    this.navBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const target = btn.getAttribute('data-target');
        if (target) this.switchScreen(target);
      });
    });

    this.menuCards.forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const target = card.getAttribute('data-nav');
        if (target) this.switchScreen(target);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const target = card.getAttribute('data-nav');
          if (target) this.switchScreen(target);
        }
      });
    });

    this.backBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchScreen('menu');
      });
    });

    this.skipBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentIndex = this.flowOrder.indexOf(this.currentScreenId);
        const nextIndex = (currentIndex + 1) % this.flowOrder.length;
        this.switchScreen(this.flowOrder[nextIndex]);
      });
    });

    window.addEventListener('hashchange', () => this.checkHash());
    this.setupSongPickerTabs();
  }

  private setupSongPickerTabs(): void {
    document.querySelectorAll<HTMLButtonElement>('#play-kind-tabs .song-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#play-kind-tabs .song-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.playKind = btn.dataset.kind === 'chords' ? 'chords' : 'notes';
        this.renderSongPicker();
      });
    });

    const tabBtns = document.querySelectorAll<HTMLButtonElement>('#song-category-tabs .song-tab-btn');
    const filterBar = document.getElementById('community-filter-bar');
    const pagination = document.getElementById('community-pagination');
    const searchInput = document.getElementById('community-search-input') as HTMLInputElement | null;
    const diffChips = document.querySelectorAll<HTMLButtonElement>('.diff-chip');
    const prevBtn = document.getElementById('comm-prev-page') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('comm-next-page') as HTMLButtonElement | null;

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = (btn.dataset.tab as 'lessons' | 'yours' | 'community') || 'lessons';
        this.activeSongTab = tab;

        if (filterBar) filterBar.hidden = tab !== 'community';
        if (pagination) pagination.hidden = tab !== 'community';

        this.renderSongPicker();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.communitySearch = (e.target as HTMLInputElement).value;
        this.communityPage = 1;
        if (this.communityDebounceTimer) clearTimeout(this.communityDebounceTimer);
        this.communityDebounceTimer = window.setTimeout(() => {
          this.renderSongPicker();
        }, 300);
      });
    }

    diffChips.forEach(chip => {
      chip.addEventListener('click', () => {
        diffChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.communityDifficulty = (chip.dataset.diff as DifficultyLevel) || 'all';
        this.communityPage = 1;
        this.renderSongPicker();
      });
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.communityPage > 1) {
          this.communityPage--;
          this.renderSongPicker();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.communityPage < this.communityTotalPages) {
          this.communityPage++;
          this.renderSongPicker();
        }
      });
    }
  }

  private async renderSongPicker(): Promise<void> {
    const list = document.getElementById('song-picker-list');
    if (!list) return;
    list.replaceChildren();

    if (this.activeSongTab === 'community') {
      const loading = document.createElement('p');
      loading.className = 'song-picker-empty';
      loading.textContent = 'Cargando canciones de la comunidad…';
      list.appendChild(loading);

      const res = await fetchCommunitySongs({
        page: this.communityPage,
        pageSize: 6,
        difficulty: this.communityDifficulty,
        searchQuery: this.communitySearch
      });

      list.replaceChildren();

      this.communityTotalPages = res.totalPages;
      const pageInfo = document.getElementById('comm-page-info');
      const prevBtn = document.getElementById('comm-prev-page') as HTMLButtonElement | null;
      const nextBtn = document.getElementById('comm-next-page') as HTMLButtonElement | null;
      if (pageInfo) pageInfo.textContent = `Página ${res.currentPage} de ${res.totalPages} (${res.totalCount} canciones)`;
      if (prevBtn) prevBtn.disabled = res.currentPage <= 1;
      if (nextBtn) nextBtn.disabled = res.currentPage >= res.totalPages;

      if (!res.songs.length) {
        const empty = document.createElement('p');
        empty.className = 'song-picker-empty';
        empty.textContent = 'No se encontraron canciones en la comunidad con esos filtros. ¡Sé el primero en publicar una desde el editor!';
        list.appendChild(empty);
        return;
      }

      res.songs.forEach(item => {
        const row = document.createElement('div');
        row.className = 'song-picker-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'song-picker-item';

        const textWrap = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'song-picker-item-title';
        title.textContent = item.title;

        const meta = document.createElement('span');
        meta.className = 'song-picker-item-meta';
        if (item.mode !== this.playKind) return;
        const diffEmoji = item.difficulty === 'easy' ? '🟢 Fácil' : item.difficulty === 'medium' ? '🟡 Media' : item.difficulty === 'hard' ? '🔴 Difícil' : '🟣 Experto';
        const count = this.playKind === 'chords' ? `${item.chords.length} acordes` : `${item.notes.length} notas`;
        meta.textContent = `Por ${item.creator_name} · ${diffEmoji} · ${count}`;
        textWrap.append(title, meta);

        const bpm = document.createElement('span');
        bpm.className = 'song-picker-item-bpm';
        bpm.textContent = `${item.bpm} BPM`;

        btn.append(textWrap, bpm);
        btn.addEventListener('click', () => {
          const songProject = communityRecordToSongProject(item);
          queueGameplaySong(songProject);
          this.switchScreen(this.playKind === 'chords' ? 'chords' : 'notes');
        });

        row.appendChild(btn);
        list.appendChild(row);
      });
      return;
    }

    const items = listNotePickerItems(songEditor.presets, this.playKind);
    const lessons = this.playKind === 'notes'
      ? [{ id: 'builtin:sound_probe', source: 'leccion' as const, song: soundProbeSong }, ...items.filter(item => item.source === 'leccion')]
      : items.filter(item => item.source === 'leccion');
    const yours = items.filter(item => item.source === 'tuya');

    const addGroup = (label: string, rows: typeof items, emptyText?: string, yoursGroup = false): void => {
      const heading = document.createElement('div');
      heading.className = 'song-picker-group-row';
      const headingLabel = document.createElement('p');
      headingLabel.className = 'song-picker-group';
      headingLabel.textContent = label;
      heading.appendChild(headingLabel);
      if (yoursGroup && rows.length) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'song-picker-clear-btn';
        clearBtn.textContent = 'Vaciar';
        clearBtn.title = 'Borrar las canciones guardadas en este dispositivo';
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearLibrary();
          this.renderSongPicker();
        });
        heading.appendChild(clearBtn);
      }
      list.appendChild(heading);

      if (!rows.length && emptyText) {
        const empty = document.createElement('p');
        empty.className = 'song-picker-empty';
        empty.textContent = emptyText;
        list.appendChild(empty);
        return;
      }

      rows.forEach(item => {
        const row = document.createElement('div');
        row.className = 'song-picker-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'song-picker-item';
        const textWrap = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'song-picker-item-title';
        title.textContent = item.song.title;
        const meta = document.createElement('span');
        meta.className = 'song-picker-item-meta';
        const count = item.song.mode === 'chords' ? `${item.song.chords.length} acordes` : `${item.song.notes.length} notas`;
        meta.textContent = `${item.song.section} · ${count}`;
        textWrap.append(title, meta);
        const bpm = document.createElement('span');
        bpm.className = 'song-picker-item-bpm';
        bpm.textContent = `${item.song.bpm} BPM`;
        btn.append(textWrap, bpm);
        btn.addEventListener('click', () => {
          queueGameplaySong(item.song);
          this.switchScreen(item.song.mode === 'chords' ? 'chords' : 'notes');
        });
        row.appendChild(btn);

        if (yoursGroup) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'song-picker-delete-btn';
          del.title = 'Quitar de Tus canciones';
          del.setAttribute('aria-label', 'Quitar');
          del.textContent = '×';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeLibrarySong(item.id);
            this.renderSongPicker();
          });
          row.appendChild(del);
        }

        list.appendChild(row);
      });
    };

    if (this.activeSongTab === 'lessons') {
      addGroup('Lecciones', lessons);
    } else if (this.activeSongTab === 'yours') {
      addGroup('Tus canciones', yours, 'Todavía no hay nada del editor. Guardá una melodía ahí y aparece acá.', true);
    }
  }

  private checkHash(): void {
    const hash = window.location.hash.replace('#', '');
    if (hash === this.currentScreenId && this.screens[hash]?.classList.contains('view-active')) {
      return;
    }
    if (this.screens[hash]) {
      this.switchScreen(hash);
    } else {
      this.switchScreen('menu');
    }
  }

  // ================= TUNER LOGIC =================
  private setupTuner(): void {
    const pegButtons = document.querySelectorAll<HTMLElement>('.tuner-peg-badge');
    const tunerContinueBtn = document.getElementById('tuner-continue-btn');
    const btnEnableMic = document.getElementById('tuner-btn-enable-mic');

    pegButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pegNum = parseInt(btn.getAttribute('data-peg') || '0');
        this.activatePeg(pegNum, undefined, true, true, false);
      });
    });

    if (tunerContinueBtn) {
      tunerContinueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchScreen('notes');
      });
    }

    if (btnEnableMic) {
      btnEnableMic.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.grantMicAndAttach();
      });
    }
  }

  public activatePeg(
    pegNum: number,
    manualCents?: number,
    playSound: boolean = false,
    vibrate: boolean = false,
    commitTune: boolean = false
  ): void {
    this.activePeg = pegNum;
    const info = this.tuningInfo[pegNum];
    if (!info) return;

    if (this.tunerCooldownTimer !== null) {
      clearTimeout(this.tunerCooldownTimer);
      this.tunerCooldownTimer = null;
    }

    document.querySelectorAll<HTMLElement>('.tuner-peg-badge').forEach(b => {
      const bPeg = parseInt(b.getAttribute('data-peg') || '0');
      b.classList.toggle('active', bPeg === pegNum);
    });

    if (playSound) {
      try {
        guitarAudio.playString(info.string, 0, 2.5, 0.95);
      } catch (e) {
        console.warn('Audio error:', e);
      }
    }

    if (vibrate) {
      this.animateStringVibration(pegNum, 1400, this.isMicActive);
    }

    const hasReading = manualCents !== undefined;
    const effectiveCents = hasReading ? manualCents : 0;
    const pxOffset = hasReading ? (Math.max(-40, Math.min(40, effectiveCents)) / 40) * 90 : 0;
    const isInTune = hasReading && Math.abs(effectiveCents) <= 15;

    const pitchIndicator = document.getElementById('tuner-pitch-indicator');
    if (pitchIndicator) {
      pitchIndicator.style.transform = `translateX(${pxOffset}px)`;
      pitchIndicator.classList.toggle('in-tune', isInTune);
    }

    if (isInTune && commitTune) {
      this.markStringTuned(pegNum);
    }

    const tunerPitchLabel = document.getElementById('tuner-pitch-label');
    if (tunerPitchLabel) {
      this.fillTunerPitchLabel(info.name, info.noteSpanish, info.freq.toFixed(1));
    }

    const tunerCentsLabel = document.getElementById('tuner-cents-label');
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

    this.tunerCooldownTimer = window.setTimeout(() => {
      this.resetTunerActiveState();
    }, 700);
  }

  private fillTunerPitchLabel(name: string, spanish: string, freq: string): void {
    const tunerPitchLabel = document.getElementById('tuner-pitch-label');
    if (!tunerPitchLabel) return;
    if (!this.tunerPitchSlots) {
      tunerPitchLabel.replaceChildren(cloneTemplate('tpl-tuner-pitch-label'));
      this.tunerPitchSlots = {
        name: slot(tunerPitchLabel, 'name'),
        spanish: slot(tunerPitchLabel, 'spanish'),
        freq: slot(tunerPitchLabel, 'freq')
      };
    }
    if (this.tunerPitchSlots.name) this.tunerPitchSlots.name.textContent = name;
    if (this.tunerPitchSlots.spanish) this.tunerPitchSlots.spanish.textContent = spanish;
    if (this.tunerPitchSlots.freq) this.tunerPitchSlots.freq.textContent = freq;
  }

  public animateStringVibration(stringNum: number, durationMs: number = 650, sustain = false): void {
    tunerMotion.pluck(stringNum, sustain);
    if (!sustain) {
      window.setTimeout(() => tunerMotion.release(), durationMs);
    }
  }

  public markStringTuned(pegNum: number): void {
    const checkEl = document.getElementById(`tuner-check-${pegNum}`);
    const isNew = !this.tunedStrings.has(pegNum);
    this.tunedStrings.add(pegNum);

    if (checkEl) {
      checkEl.classList.add('tuned');
      if (isNew) {
        checkEl.classList.add('pop-in');
        setTimeout(() => checkEl.classList.remove('pop-in'), 600);
      }
    }

    if (isNew) {
      guitarAudio.playTunedChime();
    }

    if (this.tunedStrings.size === 6) {
      this.showTunerComplete();
    } else if (isNew) {
      if (this.autoProgressTimer) clearTimeout(this.autoProgressTimer);
      this.autoProgressTimer = window.setTimeout(() => {
        const nextUntuned = this.tuningOrder.find(s => !this.tunedStrings.has(s));
        if (nextUntuned) {
          this.activatePeg(nextUntuned, undefined, false, false, false);
        }
      }, 1200);
    }
  }

  public showTunerComplete(): void {
    const tunerCompleteTitle = document.getElementById('tuner-complete-title');
    const tunerPromptText = document.getElementById('tuner-prompt-text');
    const tunerCentsLabel = document.getElementById('tuner-cents-label');
    const tunerContinueBtn = document.getElementById('tuner-continue-btn');

    if (tunerCompleteTitle) {
      tunerCompleteTitle.textContent = '¡Listo, está afinado!';
      tunerCompleteTitle.classList.add('visible');
    }
    if (tunerPromptText) tunerPromptText.style.display = 'none';
    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'Todas las cuerdas afinadas correctamente';
      tunerCentsLabel.style.color = '#00d68f';
    }
    if (tunerContinueBtn) tunerContinueBtn.classList.add('visible');

    guitarAudio.playCompletionFanfare();
  }

  public resetTunerActiveState(): void {
    document.querySelectorAll<HTMLElement & { _vibrateTimeout?: number }>('.headstock-string').forEach(str => {
      str.classList.remove('vibrating');
      if (str._vibrateTimeout) {
        clearTimeout(str._vibrateTimeout);
        str._vibrateTimeout = undefined;
      }
    });

    document.querySelectorAll('.tuner-fret-tag').forEach(tag => tag.classList.remove('active'));
    document.querySelectorAll('.tuner-peg-badge').forEach(b => b.classList.remove('active'));

    const pitchIndicator = document.getElementById('tuner-pitch-indicator');
    if (pitchIndicator) {
      pitchIndicator.style.transform = 'translateX(0px)';
      pitchIndicator.classList.remove('in-tune');
    }

    const tunerPromptText = document.getElementById('tuner-prompt-text');
    if (tunerPromptText && this.tunedStrings.size < 6) {
      tunerPromptText.textContent = 'Toca una cuerda para afinar';
    }

    const tunerCentsLabel = document.getElementById('tuner-cents-label');
    if (tunerCentsLabel) {
      tunerCentsLabel.textContent = 'En espera de pulsación...';
      tunerCentsLabel.style.color = 'rgba(255, 255, 255, 0.6)';
    }
  }

  private micGateGen = 0;

  private async queryMicPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state;
    } catch {
      return 'unknown';
    }
  }

  private rememberMicGranted(): void {
    this.hasGrantedMicPermission = true;
    guitarAudio.hasMicPermission = true;
    sessionStorage.setItem('guitar_mic_granted', '1');
  }

  private async syncMicForScreen(targetId: string): Promise<void> {
    const gen = ++this.micGateGen;
    const micOverlay = document.getElementById('tuner-mic-overlay');

    if (!this.micScreens.has(targetId)) {
      if (micOverlay) micOverlay.classList.add('hidden');
      guitarAudio.releaseMicrophone();
      this.isMicActive = false;
      this.isGameplayMicActive = false;
      return;
    }

    const perm = await this.queryMicPermissionState();
    if (gen !== this.micGateGen) return;

    const alreadyAllowed =
      perm === 'granted' ||
      this.hasGrantedMicPermission ||
      guitarAudio.hasMicPermission ||
      sessionStorage.getItem('guitar_mic_granted') === '1';

    if (alreadyAllowed) {
      this.rememberMicGranted();
      if (micOverlay) micOverlay.classList.add('hidden');
      await this.attachMicForScreen(targetId);
      return;
    }

    if (micOverlay) micOverlay.classList.remove('hidden');
  }

  private detachAllMicListeners(): void {
    guitarAudio.detachPitchListener(this.onTunerPitch);
    guitarAudio.detachPitchListener(this.onGameplayPitch);
    guitarAudio.setWaveformListener(null);
    this.stopTunerDebug();
    this.isMicActive = false;
    this.isGameplayMicActive = false;
  }

  private async attachMicForScreen(screenId: string): Promise<void> {
    this.detachAllMicListeners();
    if (screenId === 'tuner') {
      await this.startTunerMicrophone();
    } else if (screenId === 'notes' || screenId === 'chords') {
      await this.startGameplayMicrophone();
    }
  }

  private async grantMicAndAttach(): Promise<void> {
    const errEl = document.getElementById('tuner-mic-error');
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = '';
    }
    const started = await guitarAudio.startMicrophonePitchTracking();
    if (!started) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
      }
      return;
    }
    this.rememberMicGranted();
    const micOverlay = document.getElementById('tuner-mic-overlay');
    if (micOverlay) micOverlay.classList.add('hidden');
    await this.attachMicForScreen(this.currentScreenId);
  }

  public async startTunerMicrophone(): Promise<boolean> {
    this.tunerMicCandidate = null;
    this.tunerMicStableFrames = 0;
    this.tunerMicInTuneMs = 0;
    this.tunerMicLastFrameAt = 0;
    this.tunerSmoothedCents = null;
    this.tunerLastPitchTime = 0;

    const started = await guitarAudio.startMicrophonePitchTracking(this.onTunerPitch);

    if (started) {
      this.isMicActive = true;
      this.startTunerDebug();
      this.rememberMicGranted();
      const micOverlay = document.getElementById('tuner-mic-overlay');
      if (micOverlay) micOverlay.classList.add('hidden');
      const tunerPromptText = document.getElementById('tuner-prompt-text');
      if (tunerPromptText && this.tunedStrings.size < 6) {
        tunerPromptText.textContent = 'Toca una cuerda para afinar';
      }
      return true;
    }

    const errEl = document.getElementById('tuner-mic-error');
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = 'El navegador bloqueó el micrófono. Permitilo en la barra de dirección y reintentá.';
    }
    return false;
  }

  private tunerDebugFrame: Float32Array | null = null;
  private tunerDebugRms = 0;
  private tunerDebugFreq: number | null = null;
  private tunerDebugRaf = 0;

  private tunerDebugCapture: { sampleRate: number; samples: Float32Array } | null = null;
  private tunerDebugReadings: string[] = [];
  private tunerDebugTag = 'ruido';

  private startTunerDebug(): void {
    guitarAudio.setWaveformListener((samples) => {
      this.tunerDebugFrame = samples;
    });
    this.bindTunerDebugPanel();
    if (this.tunerDebugRaf) cancelAnimationFrame(this.tunerDebugRaf);
    const draw = () => {
      this.drawTunerDebug();
      this.tunerDebugRaf = requestAnimationFrame(draw);
    };
    this.tunerDebugRaf = requestAnimationFrame(draw);
  }

  private stopTunerDebug(): void {
    if (this.tunerDebugRaf) cancelAnimationFrame(this.tunerDebugRaf);
    this.tunerDebugRaf = 0;
    this.tunerDebugFrame = null;
  }

  private bindTunerDebugPanel(): void {
    const orb = document.getElementById('tuner-debug-orb');
    const panel = document.getElementById('tuner-debug-panel');
    const recordBtn = document.getElementById('tuner-debug-record') as HTMLButtonElement | null;
    const downloadBtn = document.getElementById('tuner-debug-download') as HTMLButtonElement | null;
    const closeBtn = document.getElementById('tuner-debug-close');
    if (!orb || !panel || orb.dataset.bound === '1') return;
    orb.dataset.bound = '1';
    orb.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
    });
    closeBtn?.addEventListener('click', () => {
      panel.hidden = true;
    });
    recordBtn?.addEventListener('click', () => {
      this.tunerDebugReadings = [];
      this.tunerDebugCapture = null;
      if (downloadBtn) downloadBtn.disabled = true;
      guitarAudio.beginCapture(6);
      if (recordBtn) recordBtn.disabled = true;
    });
    downloadBtn?.addEventListener('click', () => {
      if (!this.tunerDebugCapture) return;
      this.downloadCapture(this.tunerDebugCapture, this.tunerDebugReadings);
    });
    document.getElementById('tuner-debug-tags')?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button');
      const tag = button?.getAttribute('data-tag');
      if (!tag) return;
      this.tunerDebugTag = tag;
      document.querySelectorAll('#tuner-debug-tags button').forEach(el => {
        el.classList.toggle('is-active', el === button);
      });
    });
  }

  private downloadCapture(
    capture: { sampleRate: number; samples: Float32Array },
    readings: string[]
  ): void {
    const wav = encodeWav(capture.samples, capture.sampleRate);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(wav, `microfono-${stamp}.wav`);
    const report = {
      sampleRate: capture.sampleRate,
      samples: capture.samples.length,
      readings
    };
    triggerDownload(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `microfono-${stamp}.json`);
  }

  private drawTunerDebug(): void {
    const hz = this.tunerDebugFreq;
    const live = document.getElementById('tuner-debug-live');
    const log = document.getElementById('tuner-debug-log');
    const recordBtn = document.getElementById('tuner-debug-record') as HTMLButtonElement | null;
    const downloadBtn = document.getElementById('tuner-debug-download') as HTMLButtonElement | null;
    if (guitarAudio.capturing && recordBtn) {
      recordBtn.textContent = `Grabando ${Math.round(guitarAudio.captureProgress() * 100)}%`;
    }
    if (!guitarAudio.capturing && recordBtn?.disabled && this.tunerDebugCapture === null) {
      const done = guitarAudio.finishCapture();
      if (done) {
        this.tunerDebugCapture = done;
        if (downloadBtn) downloadBtn.disabled = false;
        if (recordBtn) {
          recordBtn.disabled = false;
          recordBtn.textContent = 'Grabar 6 s';
        }
      }
    }
    if (live) {
      live.textContent = hz
        ? `${hz.toFixed(1)} Hz · rms ${this.tunerDebugRms.toFixed(4)}`
        : `sin nota · rms ${this.tunerDebugRms.toFixed(4)}`;
    }
    if (log) log.textContent = this.tunerDebugReadings.slice(-12).join('\n');
  }

  private onTunerPitch = (data: PitchMatchResult): void => {
    this.tunerDebugRms = data.rms;
    this.tunerDebugFreq = data.freq;
    publishLiveFrame({
      tag: this.tunerDebugTag,
      rms: data.rms,
      freq: data.freq,
      note: data.stringMatch?.name ?? null,
      cents: data.stringMatch?.cents ?? null,
      wave: this.tunerDebugFrame ? Array.from(this.tunerDebugFrame).slice(0, 128) : []
    });
    if (guitarAudio.capturing) {
      const note = data.stringMatch ? `${data.stringMatch.name} ${data.stringMatch.cents}c` : '—';
      this.tunerDebugReadings.push(`${data.rms.toFixed(4)} ${data.freq ? data.freq.toFixed(1) : '—'}Hz ${note}`);
      if (this.tunerDebugReadings.length > 400) this.tunerDebugReadings.shift();
    }
    if (!data) return;
    const now = performance.now();

    if (data.freq && data.stringMatch) {
      const match = data.stringMatch;

      if (this.tunerMicCandidate === match.string) {
        const dt = this.tunerMicLastFrameAt ? now - this.tunerMicLastFrameAt : 16;
        this.tunerMicStableFrames += dt;
      } else {
        this.tunerMicCandidate = match.string;
        this.tunerMicStableFrames = 0;
        this.tunerMicInTuneMs = 0;
        this.tunerSmoothedCents = match.cents;
      }

      if (this.tunerMicStableFrames < 120) {
        this.tunerMicLastFrameAt = now;
        return;
      }

      if (this.tunerSmoothedCents === null || this.activePeg !== match.string) {
        this.tunerSmoothedCents = match.cents;
      } else {
        this.tunerSmoothedCents = this.tunerSmoothedCents * 0.72 + match.cents * 0.28;
      }

      const rounded = Math.round(this.tunerSmoothedCents);
      const inTune = Math.abs(rounded) <= 15;
      const dt = this.tunerMicLastFrameAt ? now - this.tunerMicLastFrameAt : 16;
      this.tunerMicLastFrameAt = now;
      this.tunerMicInTuneMs = inTune ? this.tunerMicInTuneMs + dt : 0;

      if (now - this.tunerLastPitchTime > 80) {
        this.tunerLastPitchTime = now;
        const commitTune = inTune && this.tunerMicInTuneMs >= 280;
        this.activatePeg(match.string, rounded, false, true, commitTune);
      }
    } else if (data.freq) {
      this.tunerMicCandidate = null;
      this.tunerMicStableFrames = 0;
      this.tunerMicInTuneMs = 0;
    } else if (!this.tunerMicLastFrameAt || now - this.tunerMicLastFrameAt > 400) {
      this.tunerSmoothedCents = null;
      this.tunerMicCandidate = null;
      this.tunerMicStableFrames = 0;
      this.tunerMicInTuneMs = 0;
      this.tunerMicLastFrameAt = 0;
      tunerMotion.release();
    }
  };

  public stopTunerMicrophone(): void {
    guitarAudio.detachPitchListener(this.onTunerPitch);
    this.isMicActive = false;
  }

  // ================= GAMEPLAY CONTROLS =================
  private setupGameplay(): void {
    const playPauseBtns = document.querySelectorAll<HTMLElement>('.play-pause-btn');
    playPauseBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        gameplayEngine.togglePlay();
      });
    });

    document.querySelectorAll<HTMLElement>('.finger-legend-icon').forEach(hand => {
      hand.addEventListener('click', () => {
        const tooltip = document.getElementById('hand-legend-modal');
        if (tooltip) tooltip.classList.toggle('visible');
      });
    });

    document.addEventListener('click', (e) => {
      const modal = document.getElementById('hand-legend-modal');
      const target = e.target as HTMLElement;
      if (modal && modal.classList.contains('visible') && !target.closest('.finger-legend-icon') && !target.closest('#hand-legend-modal')) {
        modal.classList.remove('visible');
      }
    });

    window.addEventListener('resize', () => this.resizeCanvases());
    setTimeout(() => this.resizeCanvases(), 100);
  }

  public resizeCanvases(): void {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.trajectory-canvas');
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
    gameplayEngine.renderFrame();
  }

  public async startGameplayMicrophone(): Promise<void> {
    this.isGameplayMicActive = true;
    await guitarAudio.startMicrophonePitchTracking(this.onGameplayPitch);
  }

  private onGameplayPitch = (data: PitchMatchResult): void => {
    if (!this.isGameplayMicActive || !data) return;
    if (sessionCalibrator.isActive) {
      sessionCalibrator.feed(data);
      return;
    }
    publishLiveFrame({
      tag: gameplayEngine.expectedLiveLabel(),
      rms: data.rms,
      freq: data.freq,
      note: data.stringMatch?.name ?? (data.fretMatch ? `s${data.fretMatch.string}f${data.fretMatch.fret}` : null),
      cents: data.stringMatch?.cents ?? data.fretMatch?.cents ?? null,
      wave: []
    });
    if (!data.freq) return;
    if (!gameplayEngine.isPlaying) return;

    if (gameplayEngine.mode === 'notes') {
      gameplayEngine.handleMicNoteDetected(data.freq, data.fretMatch, data.isOnset);
    } else if (gameplayEngine.mode === 'chords') {
      gameplayEngine.handleMicChordDetected(data.freq, data.chroma, data.isOnset);
    }
  };

  public stopGameplayMicrophone(): void {
    this.isGameplayMicActive = false;
    guitarAudio.detachPitchListener(this.onGameplayPitch);
  }

  private setupHotkeys(): void {
    window.addEventListener('keydown', (e) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (typing) return;

      if (e.key === '1' && e.altKey) this.switchScreen('tuner');
      if (e.key === '2' && e.altKey) this.switchScreen('songs');
      if (e.key === '3' && e.altKey) this.switchScreen('chords');
      if (e.key === '4' && e.altKey) this.switchScreen('editor');

      const onGameplay = this.currentScreenId === 'notes' || this.currentScreenId === 'chords';
      if (onGameplay && (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.key === ' ')) {
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
}

export const guitarApp = new GuitarApp();

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
