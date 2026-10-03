import { createClient } from '@supabase/supabase-js';
import type { EditorChord, EditorNote, SongProject } from '../types/editor.types';
import { multiplayerOrigin } from './network/serverStatus';
import { sanitizePlainText, sanitizeSongProject } from '../songSafety';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { experimental: { passkey: true } }
});

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
  const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 6)));
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const difficulty = params.difficulty ?? 'all';
  const searchQuery = (params.searchQuery ?? '').trim().slice(0, 80);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
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
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function currentAccountEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

export interface AccountProfile {
  email: string;
  createdAt: string | null;
}

export async function currentAccountProfile(): Promise<AccountProfile | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  return { email: user.email, createdAt: user.created_at ?? null };
}

export async function scheduledDeletionDue(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const due = (data.user?.app_metadata as { deletion_due?: unknown } | undefined)?.deletion_due;
  return typeof due === 'string' && due ? due : null;
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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Tenés que iniciar sesión.' };
  return serverFetch('/auth/account/deletion', {
    method,
    headers: { authorization: `Bearer ${token}` }
  });
}

export async function cancelScheduledDeletion(): Promise<boolean> {
  const result = await accountDeletion('DELETE');
  if (result.ok) await supabase.auth.refreshSession();
  return result.ok;
}

export async function scheduleAccountDeletion(): Promise<{ ok: boolean; error?: string }> {
  const result = await accountDeletion('POST');
  if (!result.ok) return result;
  await supabase.auth.signOut({ scope: 'local' });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
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
  if (!passkeysAvailable()) {
    return { ok: false, error: 'Este navegador no puede usar passkeys.' };
  }
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function registerPasskey(): Promise<{ ok: boolean; error?: string }> {
  if (!passkeysAvailable()) {
    return { ok: false, error: 'Este navegador no puede usar passkeys.' };
  }
  const { error } = await supabase.auth.registerPasskey();
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

    const { data, error } = await supabase
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
