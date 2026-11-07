import { describe, expect, it } from 'vitest';
import { furEliseSong } from '../songs/furElise';
import { sanitizeSongProject } from '../songSafety';

// Las cifras de SONGS en guitar-server/src/catalog.rs: si cambia una partitura hay que cambiar el servidor.
describe('catálogo de Versus', () => {
  it('Für Elise tiene las 130 notas que el servidor espera', () => {
    expect(furEliseSong.notes.length).toBe(130);
  });

  it('el checksum del cliente coincide con fnv1a_hex del servidor', () => {
    // Mismo vector que guitar-server/src/ws.rs (checksum_matches_client_formula).
    let hash = 0x811c9dc5;
    for (const ch of 'fur_elise:1000:10:95.5:20:130') {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    expect((hash >>> 0).toString(16).padStart(8, '0')).toBe('03784fe2');
  });

  it('una fila corrupta de la comunidad no llega al motor', () => {
    expect(sanitizeSongProject({ title: 'x', chords: null, notes: 'no es lista' })?.chords ?? []).toEqual([]);
    expect(sanitizeSongProject(null)).toBeNull();
    expect(sanitizeSongProject([1, 2])).toBeNull();
  });
});
