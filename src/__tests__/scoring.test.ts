import { describe, expect, it } from 'vitest';
import { CHORD_RULES, MAX_MULTIPLIER, NOTE_RULES, Scoreboard } from '../game/scoring';

describe('Scoreboard · notas', () => {
  it('suma 150 por acierto con multiplicador ×1 al inicio', () => {
    const b = new Scoreboard(10000);
    const r = b.hit(NOTE_RULES);
    expect(r).toEqual({ points: 150, multiplierUp: false });
    expect(b.score).toBe(150);
    expect(b.combo).toBe(1);
  });

  it('sube a ×2 exactamente al 5.º acierto seguido', () => {
    const b = new Scoreboard(100000);
    for (let i = 0; i < 4; i++) b.hit(NOTE_RULES);
    expect(b.multiplier).toBe(1);
    const r = b.hit(NOTE_RULES);
    expect(r.multiplierUp).toBe(true);
    expect(b.multiplier).toBe(2);
    expect(r.points).toBe(150 * 2);
    expect(b.comboInTier).toBe(0);
  });

  it('el multiplicador nunca supera ×4', () => {
    const b = new Scoreboard(1e9);
    for (let i = 0; i < 5 * 10; i++) b.hit(NOTE_RULES);
    expect(b.multiplier).toBe(MAX_MULTIPLIER);
    const r = b.hit(NOTE_RULES);
    expect(r.multiplierUp).toBe(false);
    expect(r.points).toBe(150 * MAX_MULTIPLIER);
  });
});

describe('Scoreboard · acordes', () => {
  it('suma 300 por acierto y sube cada 3 aciertos', () => {
    const b = new Scoreboard(100000);
    expect(b.hit(CHORD_RULES).points).toBe(300);
    expect(b.hit(CHORD_RULES).points).toBe(300);
    const third = b.hit(CHORD_RULES);
    expect(third.multiplierUp).toBe(true);
    expect(b.multiplier).toBe(2);
    expect(third.points).toBe(600);
  });

  it('llega a ×4 con 9 aciertos y no sube más', () => {
    const b = new Scoreboard(1e9);
    for (let i = 0; i < 9; i++) b.hit(CHORD_RULES);
    expect(b.multiplier).toBe(MAX_MULTIPLIER);
    expect(b.hit(CHORD_RULES).points).toBe(300 * MAX_MULTIPLIER);
  });
});

describe('Scoreboard · fallos y combo', () => {
  it('un fallo reinicia combo, tramo y multiplicador', () => {
    const b = new Scoreboard(1e9);
    for (let i = 0; i < 7; i++) b.hit(NOTE_RULES);
    expect(b.multiplier).toBe(2);
    expect(b.comboInTier).toBe(2);
    b.miss();
    expect(b.combo).toBe(0);
    expect(b.comboInTier).toBe(0);
    expect(b.multiplier).toBe(1);
  });

  it('maxCombo guarda el mejor racha y sobrevive a los fallos', () => {
    const b = new Scoreboard(1e9);
    for (let i = 0; i < 4; i++) b.hit(NOTE_RULES);
    b.miss();
    for (let i = 0; i < 2; i++) b.hit(NOTE_RULES);
    expect(b.maxCombo).toBe(4);
    expect(b.combo).toBe(2);
  });
});

describe('Scoreboard · tope y reinicio', () => {
  it('el puntaje se corta en targetScore', () => {
    const b = new Scoreboard(400);
    b.hit(NOTE_RULES);
    b.hit(NOTE_RULES);
    b.hit(NOTE_RULES);
    expect(b.score).toBe(400);
  });

  it('reset deja todo en cero y acepta un nuevo objetivo', () => {
    const b = new Scoreboard(400);
    for (let i = 0; i < 6; i++) b.hit(NOTE_RULES);
    b.reset(1200);
    expect(b).toMatchObject({ score: 0, combo: 0, comboInTier: 0, multiplier: 1, maxCombo: 0, targetScore: 1200 });
  });
});
