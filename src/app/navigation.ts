import { gameplayEngine } from '../components/gameplay';
import type { GuitarApp } from '../app';

export function setupNavigation(eng: GuitarApp): void {
  eng.navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-target');
      if (target) eng.switchScreen(target);
    });
  });

  eng.menuCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const target = card.getAttribute('data-nav');
      if (target) eng.switchScreen(target);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const target = card.getAttribute('data-nav');
        if (target) eng.switchScreen(target);
      }
    });
  });

  const menu = document.getElementById('view-menu');
  const noteField = menu?.querySelector('.note-field');
  const noteShapes = ['#note-quarter', '#note-eighth', '#note-beamed'];
  menu?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !noteField) return;
    if (event.target.closest('button, a, input, select')) return;
    // Tope de notas flotantes: clics rápidos no deben llenar el DOM.
    if (noteField.querySelectorAll('.float-note.is-click').length > 40) return;
    const bounds = menu.getBoundingClientRect();
    const note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    note.setAttribute('class', 'float-note is-click');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', noteShapes[Math.floor(Math.random() * noteShapes.length)] || noteShapes[0]);
    note.appendChild(use);
    note.style.left = `${event.clientX - bounds.left - 18}px`;
    note.style.top = `${event.clientY - bounds.top - 28}px`;
    note.addEventListener('animationend', () => note.remove());
    noteField.appendChild(note);
  });

  if (menu && noteField && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let pointerX = -9999;
    let pointerY = -9999;
    menu.addEventListener('mousemove', (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    });
    menu.addEventListener('mouseleave', () => {
      pointerX = -9999;
      pointerY = -9999;
    });
    const nudgeNotes = (): void => {
      if (menu.classList.contains('view-active')) {
        noteField.querySelectorAll<SVGElement>('.float-note').forEach(note => {
          let ox = Number(note.dataset.pushX || 0);
          let oy = Number(note.dataset.pushY || 0);
          const rect = note.getBoundingClientRect();
          const cx = rect.left + rect.width / 2 - ox;
          const cy = rect.top + rect.height / 2 - oy;
          const dx = cx - pointerX;
          const dy = cy - pointerY;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 110) {
            const force = (110 - dist) / 110;
            ox += (dx / dist) * force * 14;
            oy += (dy / dist) * force * 14;
          }
          ox *= 0.9;
          oy *= 0.9;
          if (Math.hypot(ox, oy) < 0.4) {
            ox = 0;
            oy = 0;
          }
          note.dataset.pushX = String(ox);
          note.dataset.pushY = String(oy);
          note.style.translate = ox || oy ? `${ox}px ${oy}px` : '';
        });
      }
      window.requestAnimationFrame(nudgeNotes);
    };
    window.requestAnimationFrame(nudgeNotes);
  }

  const tetraPanels = document.querySelectorAll<HTMLElement>('[data-tetra-panel]');
  const openTetra = (id: string): void => {
    tetraPanels.forEach(panel => {
      panel.hidden = panel.dataset.tetraPanel !== id;
    });
  };
  document.querySelectorAll<HTMLButtonElement>('[data-tetra-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tetraOpen;
      if (id) openTetra(id);
    });
  });

  eng.backBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // The versus lobby handles its own back steps (leave room, back to "how").
      if (e.defaultPrevented) return;
      e.preventDefault();
      const inGameplay = eng.currentScreenId === 'notes' || eng.currentScreenId === 'chords';
      eng.switchScreen(inGameplay ? gameplayEngine.leaveGameplay() : 'menu');
    });
  });

  eng.skipBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentIndex = eng.flowOrder.indexOf(eng.currentScreenId);
      const nextIndex = (currentIndex + 1) % eng.flowOrder.length;
      eng.switchScreen(eng.flowOrder[nextIndex]);
    });
  });

  window.addEventListener('hashchange', () => eng.checkHash());
  eng.setupSongPickerTabs();
}
