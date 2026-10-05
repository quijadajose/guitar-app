import { AlphaTabApi } from '@coderline/alphatab';
import { gameplayEngine } from '../components/gameplay';
import type { SongProject } from '../types/editor.types';
import { songToAlphaTex } from './songToAlphaTex';

const STRING_COLORS: Record<number, string> = {
  1: '#f39c12',
  2: '#00b4d8',
  3: '#d81b60',
  4: '#8e44ad',
  5: '#12a36a',
  6: '#e07a3d'
};

let api: AlphaTabApi | null = null;

const NOTE_HEAD = 1;
const TAB_FRET = 4;

function sheetColor(hex: string): { rgba: string } {
  return { rgba: hex };
}

function paintNotes(score: {
  tracks: Array<{
    staves: Array<{
      bars: Array<{
        voices: Array<{
          beats: Array<{
            notes: Array<{ string: number; style: { colors: Map<number, { rgba: string }> } | null }>;
          }>;
        }>;
      }>;
    }>;
  }>;
}): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              const hex = STRING_COLORS[note.string];
              if (!hex) continue;
              if (!note.style) note.style = { colors: new Map() };
              const color = sheetColor(hex);
              note.style.colors.set(NOTE_HEAD, color);
              note.style.colors.set(TAB_FRET, color);
            }
          }
        }
      }
    }
  }
}

export function renderSheet(song: SongProject): void {
  const host = document.getElementById('sheet-host');
  if (!host) return;
  host.replaceChildren();
  api?.destroy();
  const fontDirectory = new URL(`${import.meta.env.BASE_URL}alphatab/font/`, window.location.href).href;
  api = new AlphaTabApi(host, {
    core: {
      tex: true,
      useWorkers: false,
      fontDirectory
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: false,
      scrollElement: '#sheet-stage',
      soundFont: new URL(`${import.meta.env.BASE_URL}alphatab/soundfont/sonivox.sf2`, window.location.href).href
    },
    display: {
      layoutMode: 'page',
      scale: window.innerWidth < 900 || window.innerHeight < 700 ? 0.8 : 1.15,
      stretchForce: 1,
      staveProfile: 'ScoreTab',
      resources: {
        staffLineColor: 'rgba(255,255,255,0.28)',
        barSeparatorColor: '#f4f7f2',
        barNumberColor: '#d5efe4',
        scoreInfoColor: '#f4f7f2',
        mainGlyphColor: '#f4f7f2',
        tablatureFont: '700 16px Instrument Sans, sans-serif'
      }
    }
  });
  api.scoreLoaded.on((score) => paintNotes(score as never));
  api.postRenderFinished.on(() => {
    fitSheet(host);
    sheetBeats = collectSheetBeats(api);
    lastCursorBeat = null;
    followGameplayClock(api);
  });
  bindTransport(api);
  gameplayEngine.sheetFrame = () => followGameplayClock(api);
  api.tex(songToAlphaTex(song));
}

const LEAD_IN_SECONDS = 1.5;

type PlacedBeat = { tick: number; beat: object };

let sheetBeats: PlacedBeat[] = [];
let lastCursorBeat: object | null = null;

/**
 * The gameplay clock drives the sheet. alphaTab's own cursor only moves while its
 * synth is playing, so seeking it from outside left it frozen on the first beat.
 * We place our own cursor from the beat bounds instead.
 */
function followGameplayClock(player: AlphaTabApi | null): void {
  if (!player) return;
  const songSeconds = Math.max(0, gameplayEngine.currentTime - LEAD_IN_SECONDS);
  const tempo = Math.max(40, Math.round(gameplayEngine.bpm || 90));
  const ticks = songSeconds * (tempo / 60) * 960;
  placeSheetCursor(player, ticks);
  paintTransport(songSeconds, Math.max(0, gameplayEngine.songDuration - LEAD_IN_SECONDS));
}

function collectSheetBeats(player: AlphaTabApi | null): PlacedBeat[] {
  const score = player?.score as {
    tracks?: Array<{
      staves?: Array<{
        bars?: Array<{
          voices?: Array<{ beats?: Array<{ absolutePlaybackStart: number; isEmpty?: boolean }> }>;
        }>;
      }>;
    }>;
  } | null;
  const bars = score?.tracks?.[0]?.staves?.[0]?.bars;
  if (!bars) return [];
  const placed: PlacedBeat[] = [];
  for (const bar of bars) {
    for (const voice of bar.voices ?? []) {
      for (const beat of voice.beats ?? []) {
        if (beat.isEmpty) continue;
        placed.push({ tick: beat.absolutePlaybackStart, beat });
      }
    }
  }
  placed.sort((a, b) => a.tick - b.tick);
  return placed;
}

function placeSheetCursor(player: AlphaTabApi, ticks: number): void {
  if (sheetBeats.length === 0) return;
  let chosen = sheetBeats[0];
  for (const item of sheetBeats) {
    if (item.tick <= ticks + 1) chosen = item;
    else break;
  }
  if (chosen.beat === lastCursorBeat) return;
  const bounds = player.boundsLookup?.findBeat(chosen.beat as never);
  if (!bounds) return;
  lastCursorBeat = chosen.beat;

  const host = document.getElementById('sheet-host');
  const surface = host?.querySelector<HTMLElement>('.at-surface') ?? host;
  if (!surface) return;

  let bar = surface.querySelector<HTMLElement>('#sheet-cursor-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sheet-cursor-bar';
    surface.appendChild(bar);
  }
  let cursor = surface.querySelector<HTMLElement>('#sheet-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'sheet-cursor';
    surface.appendChild(cursor);
  }

  const barBox = bounds.barBounds?.masterBarBounds?.visualBounds ?? bounds.visualBounds;
  bar.style.left = `${barBox.x}px`;
  bar.style.top = `${barBox.y}px`;
  bar.style.width = `${barBox.w}px`;
  bar.style.height = `${barBox.h}px`;
  cursor.style.left = `${bounds.onNotesX}px`;
  cursor.style.top = `${barBox.y}px`;
  cursor.style.height = `${Math.max(24, barBox.h)}px`;

  const stage = document.getElementById('sheet-stage');
  if (!stage) return;
  const stageBox = stage.getBoundingClientRect();
  const lineBox = bar.getBoundingClientRect();
  if (lineBox.bottom > stageBox.bottom - 16 || lineBox.top < stageBox.top + 8) {
    stage.scrollBy({ top: lineBox.top - stageBox.top - 24, behavior: 'smooth' });
  }
}

function paintTransport(currentSeconds: number, totalSeconds: number): void {
  const time = document.getElementById('sheet-time');
  const duration = document.getElementById('sheet-duration');
  const progress = document.getElementById('sheet-progress') as HTMLInputElement | null;
  const play = document.getElementById('sheet-play');
  if (time) time.textContent = formatClock(currentSeconds * 1000);
  if (duration) duration.textContent = formatClock(totalSeconds * 1000);
  if (play) play.textContent = gameplayEngine.isPlaying ? 'Pausa' : 'Reproducir';
  if (progress && totalSeconds > 0 && document.activeElement !== progress) {
    progress.value = String(Math.round((currentSeconds / totalSeconds) * 1000));
  }
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function bindTransport(player: AlphaTabApi): void {
  const play = document.getElementById('sheet-play');
  const progress = document.getElementById('sheet-progress') as HTMLInputElement | null;
  if (!play || !progress) return;

  play.textContent = 'Reproducir';
  progress.value = '0';

  play.onclick = () => gameplayEngine.togglePlay();
  progress.oninput = () => {
    const total = Math.max(0.01, gameplayEngine.songDuration - LEAD_IN_SECONDS);
    const songSeconds = (Number(progress.value) / 1000) * total;
    gameplayEngine.seekTo((songSeconds + LEAD_IN_SECONDS) / gameplayEngine.songDuration);
    followGameplayClock(player);
  };

  gameplayEngine.sheetClock = null;
  followGameplayClock(player);
}

function fitSheet(host: HTMLElement): void {
  const surface = host.querySelector<HTMLElement>('.at-surface');
  const svg = host.querySelector('svg');
  if (!surface || !svg) return;
  surface.style.transform = '';
  const compact = window.innerWidth < 900 || window.innerHeight < 700;
  const available = Math.max(160, host.clientWidth - (compact ? 12 : 32));
  const used = svg.getBoundingClientRect().width;
  if (used <= 0) return;
  const ceiling = compact ? 1 : 1.2;
  const factor = Math.min(ceiling, Math.max(0.45, available / used));
  surface.style.transformOrigin = 'top left';
  surface.style.transform = Math.abs(factor - 1) > 0.04 ? `scale(${factor})` : '';
  surface.style.marginBottom = Math.abs(factor - 1) > 0.04 ? `${surface.offsetHeight * (factor - 1)}px` : '';
}

let previewApi: AlphaTabApi | null = null;
let previewTimer = 0;
let previewStep = 0;
let previewBeats: Array<{ tick: number; beat: object }> = [];

const TICKS_PER_QUARTER = 960;
const TICKS_PER_BAR = TICKS_PER_QUARTER * 4;

export function scheduleEditorSheet(song: SongProject): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => renderEditorSheet(song), 200);
}

export function renderEditorSheet(song: SongProject): void {
  const panel = document.getElementById('editor-sheet');
  const host = document.getElementById('editor-sheet-host');
  if (!panel || !host || !panel.classList.contains('is-open')) return;
  host.replaceChildren();
  previewApi?.destroy();
  const fontDirectory = new URL(`${import.meta.env.BASE_URL}alphatab/font/`, window.location.href).href;
  previewApi = new AlphaTabApi(host, {
    core: {
      tex: true,
      useWorkers: false,
      fontDirectory
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: false,
      scrollElement: '#editor-sheet',
      soundFont: new URL(`${import.meta.env.BASE_URL}alphatab/soundfont/sonivox.sf2`, window.location.href).href
    },
    display: {
      layoutMode: 'page',
      scale: 0.85,
      stretchForce: 1,
      staveProfile: 'ScoreTab',
      resources: {
        staffLineColor: 'rgba(255,255,255,0.28)',
        barSeparatorColor: '#f4f7f2',
        barNumberColor: '#d5efe4',
        scoreInfoColor: '#f4f7f2',
        mainGlyphColor: '#f4f7f2',
        tablatureFont: '700 15px Instrument Sans, sans-serif'
      }
    }
  });
  previewApi.scoreLoaded.on((score) => paintNotes(score as never));
  previewApi.playerReady.on(() => {
    if (previewApi) previewApi.masterVolume = 0;
  });
  previewApi.renderFinished.on(() => {
    previewBeats = collectPreviewBeats(previewApi);
    applyPreviewCursor();
  });
  previewApi.tex(songToAlphaTex(song));
}

function collectPreviewBeats(player: AlphaTabApi | null): Array<{ tick: number; beat: object }> {
  const score = player?.score as {
    tracks?: Array<{
      staves?: Array<{
        bars?: Array<{
          voices?: Array<{ beats?: Array<{ playbackStart: number; isEmpty?: boolean }> }>;
        }>;
      }>;
    }>;
  } | null;
  const bars = score?.tracks?.[0]?.staves?.[0]?.bars;
  if (!bars) return [];
  const placed: Array<{ tick: number; beat: object }> = [];
  bars.forEach((bar, index) => {
    const barStart = index * TICKS_PER_BAR;
    for (const voice of bar.voices ?? []) {
      for (const beat of voice.beats ?? []) {
        if (beat.isEmpty) continue;
        placed.push({ tick: barStart + beat.playbackStart, beat });
      }
    }
  });
  placed.sort((a, b) => a.tick - b.tick);
  return placed;
}

function applyPreviewCursor(): void {
  if (!previewApi) return;
  const target = Math.max(0, previewStep) * (TICKS_PER_QUARTER / 4);
  let chosen = previewBeats[0];
  for (const item of previewBeats) {
    if (item.tick <= target) chosen = item;
    else break;
  }
  const bounds = chosen
    ? previewApi.boundsLookup?.findBeat(chosen.beat as never)
    : null;
  if (!bounds) return;

  const host = document.getElementById('editor-sheet-host');
  const surface = host?.querySelector<HTMLElement>('.at-surface') ?? host;
  if (!surface) return;
  let cursor = surface.querySelector<HTMLElement>('#editor-sheet-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'editor-sheet-cursor';
    surface.appendChild(cursor);
  }
  cursor.style.left = `${bounds.onNotesX}px`;
  cursor.style.top = `${bounds.visualBounds.y}px`;
  cursor.style.height = `${Math.max(24, bounds.visualBounds.h)}px`;

  const panel = document.getElementById('editor-sheet');
  if (!panel) return;
  const panelBox = panel.getBoundingClientRect();
  const beatBox = cursor.getBoundingClientRect();
  if (beatBox.right > panelBox.right - 24 || beatBox.left < panelBox.left + 8) {
    panel.scrollBy({ left: beatBox.left - panelBox.left - 32, top: beatBox.top - panelBox.top - 12 });
  }
}

/** A step is a sixteenth note, the same unit as the editor playhead. */
export function followEditorSheet(stepIndex: number): void {
  previewStep = Math.max(0, stepIndex);
  applyPreviewCursor();
}

export function clearSheet(): void {
  sheetBeats = [];
  lastCursorBeat = null;
  gameplayEngine.sheetClock = null;
  gameplayEngine.sheetFrame = null;
  api?.destroy();
  api = null;
  document.getElementById('sheet-host')?.replaceChildren();
}
