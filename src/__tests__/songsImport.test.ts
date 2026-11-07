import { describe, expect, it } from 'vitest';
import { sanitizeSongProject, SONG_LIMITS } from '../songSafety';

// Canciones transcritas desde los videos tutoriales (archive/another/musics/*.mp4).
const modules = import.meta.glob('../songs/videos/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const files = Object.entries(modules);

describe('songs-import JSON', () => {
  it('hay canciones para importar', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const [path, text] of files) {
    const name = path.split('/').pop();
    it(`${name} pasa sanitizeSongProject sin perder datos`, () => {
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(SONG_LIMITS.jsonMaxBytes);
      const raw = JSON.parse(text);
      const song = sanitizeSongProject(raw);
      expect(song).not.toBeNull();
      expect(song!.notes.length).toBe(raw.notes.length);
      expect(song!.bpm).toBe(raw.bpm);
      expect(song!.measures).toBe(raw.measures);
      for (const n of song!.notes) expect(n.measure).toBeLessThanOrEqual(song!.measures);
      expect(song!.notes).toEqual(raw.notes);
    });
  }
});
