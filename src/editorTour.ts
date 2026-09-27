import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const SEEN_KEY = 'guitar.editorTourSeen';

export function startEditorTour(force = false): void {
  if (!force) {
    try {
      if (localStorage.getItem(SEEN_KEY) === '1') return;
    } catch {
      // Still show the tour if storage is blocked.
    }
  }

  const notes = document.querySelectorAll('#editor-matrix-grid .grid-note-chip').length;
  const gridDescription = notes === 0
    ? 'Todavía no hay notas. Hacé clic en un pulso de la grilla para colocar la primera. También podés elegir una plantilla o cargar un audio.'
    : 'Cada celda es una semicorchea. Clic para agregar o editar una nota. Las de la misma columna suenan juntas.';

  const tour = driver({
    showProgress: true,
    animate: true,
    overlayOpacity: 0.62,
    nextBtnText: 'Siguiente',
    prevBtnText: 'Atrás',
    doneBtnText: 'Listo',
    steps: [
      {
        element: '#editor-preset-select',
        popover: {
          title: 'Empezar con una plantilla',
          description: 'Si no tenés una pista, elegí una melodía de ejemplo. La grilla y la partitura se llenan solas.',
          side: 'bottom'
        }
      },
      {
        element: '#editor-audio-extract-btn',
        popover: {
          title: 'Cargar audio',
          description: 'MP3, WAV u OGG se analizan en este navegador: no se suben a ningún servidor. Detecta notas y tempo para armar la grilla.',
          side: 'bottom'
        }
      },
      {
        element: '#editor-matrix-grid',
        popover: {
          title: 'La grilla',
          description: gridDescription,
          side: 'top'
        }
      },
      {
        element: '#editor-play-seq-btn',
        popover: {
          title: 'Escuchar la pista',
          description: 'Reproduce solo las notas de la grilla. Si está vacía, no vas a oír melodía.',
          side: 'bottom'
        }
      },
      {
        element: '#editor-play-both-btn',
        popover: {
          title: 'Audio y guitarra',
          description: 'Si cargaste un audio de referencia, suena junto con las notas. Sin audio, este botón no tiene pista que acompañar.',
          side: 'bottom'
        }
      },
      {
        element: '#editor-play-game-btn',
        popover: {
          title: 'Probar',
          description: 'Abre la canción en el mástil para practicarla. Con la grilla vacía no hay notas que tocar.',
          side: 'bottom'
        }
      },
      {
        element: '.editor-more',
        popover: {
          title: 'Compartir',
          description: 'En Más: Exportar baja un archivo, Importar lo vuelve a abrir, y Publicar la sube a la comunidad si iniciaste sesión.',
          side: 'bottom',
          align: 'end'
        }
      }
    ]
  });

  tour.drive();
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Ignore.
  }
}
