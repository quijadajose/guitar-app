import type { SongProject } from '../../types/editor.types';

/** AlphaTab pesa ~1,2 MB: solo se carga cuando el usuario abre la partitura una vez. */
let sheetRequested = false;

/** Marca que el usuario pidió la partitura explícitamente (botón de la vista). */
export function markSheetRequested(): void {
  sheetRequested = true;
}

/** La partitura solo se pide si el usuario está en el editor y la vista está abierta (o la pidió). */
function sheetWanted(): boolean {
  if (sheetRequested) return true;
  const editorActive = document.getElementById('view-editor')?.classList.contains('view-active') ?? false;
  const panelOpen = document.getElementById('editor-sheet')?.classList.contains('is-open') ?? false;
  return editorActive && panelOpen;
}

export function scheduleEditorSheet(song: SongProject): void {
  if (!sheetWanted()) return;
  void import('../../notation/sheetView').then((sheet) => sheet.scheduleEditorSheet(song));
}

export function followEditorSheet(beat: number): void {
  if (!sheetWanted()) return;
  void import('../../notation/sheetView').then((sheet) => sheet.followEditorSheet(beat));
}
