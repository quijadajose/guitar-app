import { createClient } from '@supabase/supabase-js';
import type { EditorChord, EditorNote, SongProject } from '../types/editor.types';
import { multiplayerOrigin } from './network/serverStatus';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { experimental: { passkey: true } }
});

export async function probeSupabase(): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
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

export type DifficultyLevel = 'all' | 'easy' | 'medium' | 'hard' | 'expert';

export interface CommunitySongRecord {
  id: string;
  user_id: string | null;
  creator_name: string;
  title: string;
  section: string;
  bpm: number;
  mode: 'notes' | 'chords';
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
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
}

export interface FetchSongsResult {
  songs: CommunitySongRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Obtener canciones de la comunidad con paginación y filtros
 */
export async function fetchCommunitySongs(params: FetchSongsParams = {}): Promise<FetchSongsResult> {
  const {
    page = 1,
    pageSize = 6,
    difficulty = 'all',
    searchQuery = ''
  } = params;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('community_songs')
    .select('*', { count: 'exact' })
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (difficulty !== 'all') {
    query = query.eq('difficulty', difficulty);
  }

  if (searchQuery.trim()) {
    query = query.ilike('title', `%${searchQuery.trim()}%`);
  }

  const { data, count, error } = await query.range(from, to);

  if (error) {
    console.error('Error fetching community songs:', error);
    return {
      songs: [],
      totalCount: 0,
      totalPages: 1,
      currentPage: page
    };
  }

  const totalCount = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    songs: (data as CommunitySongRecord[]) || [],
    totalCount,
    totalPages,
    currentPage: page
  };
}

/**
 * Publicar una nueva partitura en la comunidad
 */
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

async function accountDeletion(method: 'POST' | 'DELETE'): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Tenés que iniciar sesión.' };
  try {
    const res = await fetch(`${multiplayerOrigin()}/auth/account/deletion`, {
      method,
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error || 'No se pudo actualizar la cuenta.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'El servidor no está disponible.' };
  }
}

export async function cancelScheduledDeletion(): Promise<boolean> {
  const result = await accountDeletion('DELETE');
  if (result.ok) await supabase.auth.refreshSession();
  return result.ok;
}

export async function scheduleAccountDeletion(): Promise<{ ok: boolean; error?: string }> {
  const result = await accountDeletion('POST');
  if (!result.ok) return result;
  await supabase.auth.signOut();
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

async function postAuth(path: string, body: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${multiplayerOrigin()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, redirect_to: window.location.origin })
    });
    const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || 'No se pudo enviar el email.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'El servidor no está disponible.' };
  }
}

export async function requestMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  return postAuth('/auth/magic-link', { email });
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
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  isPublic: boolean;
  audioUrl?: string | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Tenés que crear una cuenta para cargar una canción.' };
    }

    const record = {
      user_id: userId,
      creator_name: payload.creatorName.trim() || 'Comunidad',
      title: payload.song.title.trim() || 'Sin título',
      section: payload.song.section || '',
      bpm: payload.song.bpm || 120,
      mode: payload.song.mode || 'notes',
      difficulty: payload.difficulty,
      measures: payload.song.measures || 8,
      notes: payload.song.notes || [],
      chords: payload.song.chords || [],
      audio_url: payload.audioUrl || null,
      is_public: payload.isPublic
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
  return {
    title: rec.title,
    section: rec.section || 'Comunidad',
    bpm: rec.bpm,
    mode: rec.mode,
    measures: rec.measures,
    notes: rec.notes || [],
    chords: rec.chords || []
  };
}
