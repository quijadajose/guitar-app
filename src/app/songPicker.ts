import { songEditor } from '../components/editor';
import { queueGameplaySong } from '../screens';
import { clearLibrary, listNotePickerItems, removeLibrarySong } from '../songLibrary';
import { soundProbeSong } from '../songs/soundProbe';
import { communityRecordToSongProject, fetchCommunitySongs, fetchMyLikes, recordSongPlay, setSongLike, type CommunitySongRecord, type DifficultyLevel } from '../services/supabase';
import { DIFFICULTY_LEVELS } from './helpers';
import type { GuitarApp } from '../app';

export function setupSongPickerTabs(eng: GuitarApp): void {
  document.querySelectorAll<HTMLButtonElement>('#play-kind-tabs .song-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#play-kind-tabs .song-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      eng.playKind = btn.dataset.kind === 'chords' ? 'chords' : 'notes';
      eng.communityPage = 1;
      void eng.renderSongPicker();
    });
  });

  const tabBtns = document.querySelectorAll<HTMLButtonElement>('#song-category-tabs .song-tab-btn');
  const filterBar = document.getElementById('community-filter-bar');
  const pagination = document.getElementById('community-pagination');
  const searchInput = document.getElementById('community-search-input') as HTMLInputElement | null;
  const diffChips = document.querySelectorAll<HTMLButtonElement>('.diff-chip');
  const prevBtn = document.getElementById('comm-prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('comm-next-page') as HTMLButtonElement | null;
  if (searchInput) searchInput.maxLength = 80;

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const raw = btn.dataset.tab;
      const tab = raw === 'yours' || raw === 'community' ? raw : 'lessons';
      eng.activeSongTab = tab;

      if (filterBar) filterBar.hidden = tab !== 'community';
      if (pagination) pagination.hidden = tab !== 'community';

      void eng.renderSongPicker();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      eng.communitySearch = (e.target as HTMLInputElement).value;
      eng.communityPage = 1;
      if (eng.communityDebounceTimer) clearTimeout(eng.communityDebounceTimer);
      eng.communityDebounceTimer = window.setTimeout(() => {
        void eng.renderSongPicker();
      }, 300);
    });
  }

  diffChips.forEach(chip => {
    chip.addEventListener('click', () => {
      diffChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const diff = chip.dataset.diff as DifficultyLevel;
      eng.communityDifficulty = DIFFICULTY_LEVELS.includes(diff) ? diff : 'all';
      eng.communityPage = 1;
      void eng.renderSongPicker();
    });
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (eng.communityPage > 1) {
        eng.communityPage--;
        void eng.renderSongPicker();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (eng.communityPage < eng.communityTotalPages) {
        eng.communityPage++;
        void eng.renderSongPicker();
      }
    });
  }
}

export async function renderSongPicker(eng: GuitarApp): Promise<void> {
  const list = document.getElementById('song-picker-list');
  if (!list) return;
  const generation = ++eng.songPickerGeneration;
  list.replaceChildren();

  if (eng.activeSongTab === 'community') {
    const loading = document.createElement('p');
    loading.className = 'song-picker-empty';
    loading.textContent = 'Cargando canciones de la comunidad…';
    list.appendChild(loading);

    const kind = eng.playKind;
    const res = await fetchCommunitySongs({
      page: eng.communityPage,
      pageSize: 6,
      difficulty: eng.communityDifficulty,
      searchQuery: eng.communitySearch,
      mode: kind
    });

    // Mientras esperábamos, el usuario cambió de pestaña, filtro o página.
    if (generation !== eng.songPickerGeneration) return;

    list.replaceChildren();

    eng.communityTotalPages = res.totalPages;
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

    const likes = await fetchMyLikes(res.songs.map(song => song.id));
    if (generation !== eng.songPickerGeneration) return;

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
      const diffEmoji = item.difficulty === 'easy' ? '🟢 Fácil' : item.difficulty === 'medium' ? '🟡 Media' : item.difficulty === 'hard' ? '🔴 Difícil' : '🟣 Experto';
      const count = kind === 'chords' ? `${item.chords.length} acordes` : `${item.notes.length} notas`;
      meta.textContent = `Por ${item.creator_name} · ${diffEmoji} · ${count}`;
      textWrap.append(title, meta);

      const bpm = document.createElement('span');
      bpm.className = 'song-picker-item-bpm';
      bpm.textContent = `${item.bpm} BPM`;

      btn.append(textWrap, bpm);
      btn.addEventListener('click', () => {
        const songProject = communityRecordToSongProject(item);
        void recordSongPlay(item.id);
        queueGameplaySong(songProject);
        eng.switchScreen(songProject.mode === 'chords' ? 'chords' : 'notes');
      });

      row.appendChild(btn);
      row.appendChild(buildLikeButton(item, likes));
      list.appendChild(row);
    });
    return;
  }

  const items = listNotePickerItems(songEditor.presets, eng.playKind);
  const lessons = eng.playKind === 'notes'
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
        // Borra todo sin poder deshacer: pedir confirmación.
        if (!window.confirm('¿Borrar todas tus canciones guardadas en este dispositivo?')) return;
        clearLibrary();
        void eng.renderSongPicker();
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
        eng.switchScreen(item.song.mode === 'chords' ? 'chords' : 'notes');
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
          void eng.renderSongPicker();
        });
        row.appendChild(del);
      }

      list.appendChild(row);
    });
  };

  if (eng.activeSongTab === 'lessons') {
    addGroup('Lecciones', lessons);
  } else if (eng.activeSongTab === 'yours') {
    addGroup('Tus canciones', yours, 'Todavía no hay nada del editor. Guardá una melodía ahí y aparece acá.', true);
  }
}

/** Botón de like con contador. Sin sesión de Supabase queda deshabilitado. */
function buildLikeButton(item: CommunitySongRecord, likes: { signedIn: boolean; likedIds: Set<string> }): HTMLButtonElement {
  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = 'song-picker-like';
  let liked = likes.likedIds.has(item.id);
  let count = item.likes_count;

  const paint = (): void => {
    likeBtn.setAttribute('aria-pressed', String(liked));
    likeBtn.textContent = `♥ ${count}`;
    likeBtn.title = liked ? 'Quitar like' : 'Dar like';
  };
  paint();

  if (!likes.signedIn) {
    likeBtn.disabled = true;
    likeBtn.title = 'Iniciá sesión para dar like';
    return likeBtn;
  }

  likeBtn.addEventListener('click', async () => {
    likeBtn.disabled = true;
    const result = await setSongLike(item.id, !liked);
    likeBtn.disabled = false;
    if (!result.ok) {
      likeBtn.title = result.error ?? 'No se pudo guardar el like.';
      return;
    }
    liked = !liked;
    count += liked ? 1 : -1;
    paint();
  });
  return likeBtn;
}

