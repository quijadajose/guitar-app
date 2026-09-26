export type NotationView = 'fretboard' | 'sheet';
export type NoteNaming = 'solfege' | 'letters';

const STORAGE_KEY = 'guitar.notationView';
const NAMING_KEY = 'guitar.noteNaming';

const SOLFEGE = ['Mi', 'Si', 'Sol', 'Re', 'La', 'Mi'];
const LETTERS = ['E', 'B', 'G', 'D', 'A', 'E'];

export function noteNameForString(stringNumber: number, naming: NoteNaming = readNoteNaming()): string {
  const names = naming === 'letters' ? LETTERS : SOLFEGE;
  return names[stringNumber - 1] ?? '';
}

export function readNotationView(): NotationView {
  return localStorage.getItem(STORAGE_KEY) === 'sheet' ? 'sheet' : 'fretboard';
}

export function writeNotationView(view: NotationView): void {
  localStorage.setItem(STORAGE_KEY, view);
}

export function readNoteNaming(): NoteNaming {
  return localStorage.getItem(NAMING_KEY) === 'letters' ? 'letters' : 'solfege';
}

export function writeNoteNaming(naming: NoteNaming): void {
  localStorage.setItem(NAMING_KEY, naming);
}

export function applyNoteNaming(naming: NoteNaming = readNoteNaming()): void {
  document.querySelectorAll<HTMLElement>('[data-string-name]').forEach(el => {
    const stringNumber = Number(el.dataset.stringName);
    el.textContent = noteNameForString(stringNumber, naming);
  });
}
