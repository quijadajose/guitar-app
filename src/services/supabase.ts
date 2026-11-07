import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditorChord, EditorNote, SongProject } from '../types/editor.types';
import { multiplayerOrigin } from './network/serverStatus';
import { sanitizePlainText, sanitizeSongProject } from '../songSafety';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* ---- Carga diferida del cliente ----------------------------------------- */

let loadedClient: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient> | null = null;
const readyCallbacks: Array<(client: SupabaseClient) => void> = [];

/** Descarga el SDK la primera vez que hace falta y devuelve el cliente. */
export function loadSupabase(): Promise<SupabaseClient> {
  clientPromise ??= import('./supabaseCore').then((core) => {
    loadedClient = core.supabase;
    for (const callback of readyCallbacks.splice(0)) callback(core.supabase);
    return core.supabase;
  });
  return clientPromise;
}

/** Ejecuta `callback` con el cliente ahora (si ya cargó) o cuando cargue. */
export function onSupabaseReady(callback: (client: SupabaseClient) => void): void {
  if (loadedClient) callback(loadedClient);
  else readyCallbacks.push(callback);
}

/** Hay una sesión guardada por el SDK en este navegador (sin cargar el SDK). */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) return true;
    }
  } catch {
    // Almacenamiento bloqueado: se trata como sin sesión.
  }
  return false;
}

/** La URL trae un callback de auth (magic link / passkey) que el SDK debe procesar. */
export function hasAuthCallbackInUrl(): boolean {
  return /[#?&](access_token|code|token_hash)=/.test(window.location.href);
}

/** Cliente solo si hay algo que consultar; si no, null sin cargar el SDK. */
async function clientIfSession(): Promise<SupabaseClient | null> {
  if (!loadedClient && !hasStoredSession() && !hasAuthCallbackInUrl()) return null;
  return loadSupabase();
}

const REQUEST_TIMEOUT_MS = 10_000;
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
type Difficulty = typeof DIFFICULTIES[number];

export async function probeSupabase(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey },
      cache: 'no-store',
      signal: controller.signal
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export type DifficultyLevel = 'all' | Difficulty;

export interface CommunitySongRecord {
  id: string;
  user_id: string | null;
  creator_name: string;
  title: string;
  section: string;
  bpm: number;
  mode: 'notes' | 'chords';
  difficulty: Difficulty;
  measures: number;
  notes: EditorNote[];
  chords: EditorChord[];
  audio_url: string | null;
  is_public: boolean;
  likes_count: number;
  plays_count: number;
  created_at: string;
}

export interface FetchSongsParams {
  page?: number;
  pageSize?: number;
  difficulty?: DifficultyLevel;
  searchQuery?: string;
  /** Filtrar en el servidor; si se filtra en el cliente, la paginación queda con huecos. */
  mode?: 'notes' | 'chords';
}

export interface FetchSongsResult {
  songs: CommunitySongRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/** Escapa los comodines de LIKE para que «%» o «_» se busquen literalmente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Las filas vienen de otros usuarios y cualquiera puede escribir en la tabla
 * vía REST: se validan igual que un JSON importado antes de tocar el DOM o el motor.
 */
function sanitizeCommunityRecord(raw: unknown): CommunitySongRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const song = sanitizeSongProject({
    title: r.title,
    section: r.section,
    bpm: r.bpm,
    mode: r.mode,
    measures: r.measures,
    notes: Array.isArray(r.notes) ? r.notes : [],
    chords: Array.isArray(r.chords) ? r.chords : []
  });
  if (!song) return null;
  const difficulty = DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : 'medium';
  return {
    id: r.id,
    user_id: typeof r.user_id === 'string' ? r.user_id : null,
    creator_name: sanitizePlainText(r.creator_name, 30, 'Comunidad'),
    title: song.title,
    section: song.section,
    bpm: song.bpm,
    mode: song.mode,
    difficulty,
    measures: song.measures,
    notes: song.notes,
    chords: song.chords,
    audio_url: safeHttpsUrl(r.audio_url),
    is_public: r.is_public === true,
    likes_count: typeof r.likes_count === 'number' ? r.likes_count : 0,
    plays_count: typeof r.plays_count === 'number' ? r.plays_count : 0,
    created_at: typeof r.created_at === 'string' ? r.created_at : ''
  };
}

/**
 * Obtener canciones de la comunidad con paginación y filtros
 */
export async function fetchCommunitySongs(params: FetchSongsParams = {}): Promise<FetchSongsResult> {
  const sb = await loadSupabase();
  const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 6)));
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const difficulty = params.difficulty ?? 'all';
  const searchQuery = (params.searchQuery ?? '').trim().slice(0, 80);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from('community_songs')
    .select(
      'id,user_id,creator_name,title,section,bpm,mode,difficulty,measures,notes,chords,audio_url,is_public,likes_count,plays_count,created_at',
      { count: 'exact' }
    )
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (difficulty !== 'all' && DIFFICULTIES.includes(difficulty)) {
    query = query.eq('difficulty', difficulty);
  }
  if (params.mode === 'notes' || params.mode === 'chords') {
    query = query.eq('mode', params.mode);
  }
  if (searchQuery) {
    query = query.ilike('title', `%${escapeLike(searchQuery)}%`);
  }

  const { data, count, error } = await query.range(from, to).abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));

  if (error) {
    console.error('Error fetching community songs:', error.message);
    return {
      songs: [],
      totalCount: 0,
      totalPages: 1,
      currentPage: page
    };
  }

  const totalCount = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const songs = (Array.isArray(data) ? data : [])
    .map(sanitizeCommunityRecord)
    .filter((song): song is CommunitySongRecord => song !== null);

  return {
    songs,
    totalCount,
    totalPages,
    currentPage: page
  };
}

export async function getCurrentUserId(): Promise<string | null> {
    const sb = await clientIfSession();
    if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function currentAccountEmail(): Promise<string | null> {
    const sb = await clientIfSession();
    if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? null;
}

export interface AccountProfile {
  email: string;
  createdAt: string | null;
}

export async function currentAccountProfile(): Promise<AccountProfile | null> {
    const sb = await clientIfSession();
    if (!sb) return null;
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  return { email: user.email, createdAt: user.created_at ?? null };
}

export async function scheduledDeletionDue(): Promise<string | null> {
  const sb = await clientIfSession();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  // La fecha vive en la tabla account_deletion_requests (solo accesible al servidor).
  try {
    const res = await fetch(`${multiplayerOrigin()}/auth/account/deletion`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = (await res.json().catch(() => ({}))) as { due_at?: unknown };
    return res.ok && typeof body.due_at === 'string' && body.due_at ? body.due_at : null;
  } catch {
    return null;
  }
}

async function serverFetch(path: string, init: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${multiplayerOrigin()}${path}`, {
      ...init,
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
    if (!res.ok || body.ok === false) {
      const error = typeof body.error === 'string' ? body.error.slice(0, 200) : undefined;
      return { ok: false, error: error || 'No se pudo completar la operación.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'El servidor no está disponible.' };
  }
}

async function accountDeletion(method: 'POST' | 'DELETE'): Promise<{ ok: boolean; error?: string }> {
  const sb = await clientIfSession();
  if (!sb) return { ok: false, error: 'Tenés que iniciar sesión.' };
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Tenés que iniciar sesión.' };
  return serverFetch('/auth/account/deletion', {
    method,
    headers: { authorization: `Bearer ${token}` }
  });
}

export async function cancelScheduledDeletion(): Promise<boolean> {
    const sb = await loadSupabase();
  const result = await accountDeletion('DELETE');
  if (result.ok) await sb.auth.refreshSession();
  return result.ok;
}

export async function scheduleAccountDeletion(): Promise<{ ok: boolean; error?: string }> {
    const sb = await loadSupabase();
  const result = await accountDeletion('POST');
  if (!result.ok) return result;
  await sb.auth.signOut({ scope: 'local' });
  return { ok: true };
}

export async function signOut(): Promise<void> {
    const sb = await loadSupabase();
  await sb.auth.signOut();
}

export async function requestMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().slice(0, 254);
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(clean)) {
    return { ok: false, error: 'Email inválido.' };
  }
  return serverFetch('/auth/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: clean })
  });
}

export function passkeysAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined';
}

export async function signInWithPasskey(): Promise<{ ok: boolean; error?: string }> {
    const sb = await loadSupabase();
  if (!passkeysAvailable()) {
    return { ok: false, error: 'Este navegador no puede usar passkeys.' };
  }
  const { error } = await sb.auth.signInWithPasskey();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function registerPasskey(): Promise<{ ok: boolean; error?: string }> {
    const sb = await loadSupabase();
  if (!passkeysAvailable()) {
    return { ok: false, error: 'Este navegador no puede usar passkeys.' };
  }
  const { error } = await sb.auth.registerPasskey();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function publishCommunitySong(payload: {
  song: SongProject;
  creatorName: string;
  difficulty: Difficulty;
  isPublic: boolean;
  audioUrl?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const sb = await loadSupabase();
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Tenés que crear una cuenta para cargar una canción.' };
    }

    // Mismas reglas que al importar un JSON: nada de notas fuera de rango ni textos enormes.
    const song = sanitizeSongProject(payload.song);
    if (!song || (song.notes.length === 0 && song.chords.length === 0)) {
      return { success: false, error: 'La canción está vacía o no es válida.' };
    }
    if (payload.audioUrl && !safeHttpsUrl(payload.audioUrl)) {
      return { success: false, error: 'El enlace de audio tiene que ser https.' };
    }

    const record = {
      user_id: userId,
      creator_name: sanitizePlainText(payload.creatorName, 30, 'Comunidad'),
      title: song.title,
      section: song.section,
      bpm: song.bpm,
      mode: song.mode,
      difficulty: DIFFICULTIES.includes(payload.difficulty) ? payload.difficulty : 'medium',
      measures: song.measures,
      notes: song.notes,
      chords: song.chords,
      audio_url: safeHttpsUrl(payload.audioUrl),
      is_public: payload.isPublic === true
    };

    const { data, error } = await sb
      .from('community_songs')
      .insert([record])
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado al publicar';
    return { success: false, error: message };
  }
}

/**
 * Convertir registro de Supabase a SongProject jugable en el cliente
 */
export function communityRecordToSongProject(rec: CommunitySongRecord): SongProject {
  const safe = sanitizeSongProject({
    title: rec.title,
    section: rec.section || 'Comunidad',
    bpm: rec.bpm,
    mode: rec.mode,
    measures: rec.measures,
    notes: rec.notes || [],
    chords: rec.chords || []
  });
  return safe ?? {
    title: 'Canción',
    section: 'Comunidad',
    bpm: 85,
    mode: 'notes',
    measures: 1,
    notes: [],
    chords: []
  };
}

/* ---- Likes y reproducciones ---------------------------------------------- */

/** Qué canciones de la lista le gustan al usuario actual (y si hay sesión). */
export async function fetchMyLikes(songIds: string[]): Promise<{ signedIn: boolean; likedIds: Set<string> }> {
  const sb = await clientIfSession();
  if (!sb) return { signedIn: false, likedIds: new Set() };
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { signedIn: false, likedIds: new Set() };
  if (!songIds.length) return { signedIn: true, likedIds: new Set() };
  const { data, error } = await sb
    .from('song_likes')
    .select('song_id')
    .eq('user_id', uid)
    .in('song_id', songIds)
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  if (error || !data) return { signedIn: true, likedIds: new Set() };
  return { signedIn: true, likedIds: new Set(data.map((row: { song_id: string }) => row.song_id)) };
}

/** Da o quita el like. El contador lo actualiza el trigger del servidor. */
export async function setSongLike(songId: string, like: boolean): Promise<{ ok: boolean; error?: string }> {
  const sb = await loadSupabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { ok: false, error: 'Iniciá sesión para dar like.' };
  const result = like
    ? await sb.from('song_likes').insert({ user_id: uid, song_id: songId })
    : await sb.from('song_likes').delete().eq('user_id', uid).eq('song_id', songId);
  // 23505 = ya tenía like (doble clic): no es un error para el usuario.
  if (result.error && result.error.code !== '23505') {
    return { ok: false, error: 'No se pudo guardar el like. Probá de nuevo.' };
  }
  return { ok: true };
}

/** Suma una reproducción. Un fallo aquí nunca debe frenar la canción. */
export async function recordSongPlay(songId: string): Promise<void> {
  try {
    const sb = await loadSupabase();
    await sb.rpc('register_song_play', { p_song_id: songId });
  } catch {
    // Contar no es crítico.
  }
}
