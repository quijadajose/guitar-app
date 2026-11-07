# Canciones importables (desde los videos tutoriales)

Transcritas automáticamente de los videos en `archive/another/musics/*.mp4`
(se lee la tablatura de pantalla y el tiempo de cada nota con el cursor/resaltado).

Cómo cargarlas: Editor → Importar JSON → elegir el archivo → Tocar.

- Cada canción va completa en un solo archivo (límite de la app: 96 compases; la más larga, Megalovania, usa 80).
- La rejilla de la app es de semicorcheas (16 pasos por compás). Las canciones en 3/4, 6/8 o 3/8
  conservan el tiempo real pero sus barras de compás no coinciden con las de la app.
- Los tresillos (Enemy, Halo, Mario) se redondean a la semicorchea más cercana.
- BPM = el tempo del video tutorial (suele ser más lento que el original).
- Dedos (`finger`) son estimados.

Scripts para regenerar: `archive/tab-extractor/` (`final.py`).
Test: `npx vitest run src/__tests__/songsImport.test.ts`.
