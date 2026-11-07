import type { SongProject } from '../types/editor.types';

/**
 * Canciones transcritas de los videos tutoriales (archive/another/musics/*.mp4).
 * Ver src/songs/videos/README.md. Se muestran como lecciones en el selector.
 * fur.json queda fuera: ya existe la lección Für Elise (furElise.ts), que usa el modo versus.
 */
const files = import.meta.glob<SongProject>(['./videos/*.json', '!./videos/fur.json'], { eager: true, import: 'default' });

function song(file: string): SongProject {
  const s = files[`./videos/${file}.json`];
  if (!s) throw new Error(`Falta la canción ${file}.json`);
  return s;
}

/** Orden en que aparecen en el selector: de más simple a más larga/difícil. */
export const videoSongs: Record<string, SongProject> = {
  video_birthday: song('birthday'),
  video_jurassic: song('jurassic'),
  video_pirates: song('pirates'),
  video_genshin: song('genshin'),
  video_mario: song('mario'),
  video_badhabits: song('badhabits'),
  video_enemy: song('enemy'),
  video_halo: song('halo'),
  video_badapple: song('badapple'),
  video_megalovania: song('megalovania')
};

/** Versión del video de «Recuérdame»: reemplaza al boceto de 30 notas. */
export const cocoVideoSong: SongProject = song('coco');
