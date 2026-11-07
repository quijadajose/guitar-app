import { bindAccount } from '../screens/account';
import { applyNoteNaming, readNotationView, readNoteNaming, type NotationView, type NoteNaming, writeNotationView, writeNoteNaming } from '../notation/notationPreference';

export function setupAccount(): void {
  bindAccount();
}

export function setupNotationSettings(): void {
  const dialog = document.getElementById('notation-settings') as HTMLDialogElement | null;
  const open = document.getElementById('btn-notation-settings');
  if (!dialog || !open) return;

  const viewLabel = dialog.querySelector<HTMLElement>('[data-cfg-value="view"]');
  const namingLabel = dialog.querySelector<HTMLElement>('[data-cfg-value="naming"]');
  const panels = dialog.querySelectorAll<HTMLElement>('[data-cfg-panel]');
  const viewNames: Record<NotationView, string> = { fretboard: 'Mástil', sheet: 'Partitura' };
  const namingNames: Record<NoteNaming, string> = { solfege: 'Europea', letters: 'Americana' };

  const showPanel = (id: string): void => {
    panels.forEach(panel => {
      panel.hidden = panel.dataset.cfgPanel !== id;
    });
  };

  const paint = (): void => {
    const view = readNotationView();
    const naming = readNoteNaming();
    if (viewLabel) viewLabel.textContent = viewNames[view];
    if (namingLabel) namingLabel.textContent = namingNames[naming];
    dialog.querySelectorAll<HTMLButtonElement>('[data-set-view]').forEach(btn => {
      btn.classList.toggle('is-on', btn.dataset.setView === view);
    });
    dialog.querySelectorAll<HTMLButtonElement>('[data-set-naming]').forEach(btn => {
      btn.classList.toggle('is-on', btn.dataset.setNaming === naming);
    });
  };

  applyNoteNaming();
  paint();

  open.addEventListener('click', () => {
    paint();
    showPanel('home');
    dialog.showModal();
  });
  dialog.querySelector('[data-cfg-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-cfg-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cfgOpen;
      if (id) showPanel(id);
    });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-set-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.setView;
      if (value === 'sheet' || value === 'fretboard') writeNotationView(value);
      paint();
      showPanel('home');
    });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-set-naming]').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.setNaming;
      if (value === 'solfege' || value === 'letters') {
        writeNoteNaming(value);
        applyNoteNaming(value);
      }
      paint();
      showPanel('home');
    });
  });
}
