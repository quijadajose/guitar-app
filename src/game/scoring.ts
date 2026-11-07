/**
 * Puntaje del juego, sin DOM. Reglas:
 * - Cada acierto suma `basePoints × multiplicador` y sube el combo.
 * - Cada `tierSize` aciertos seguidos sube el multiplicador (máximo ×4).
 * - Un fallo corta el combo y vuelve el multiplicador a ×1.
 * - El puntaje nunca pasa de `targetScore`.
 */

export const MAX_MULTIPLIER = 4;

export interface HitRules {
  /** Aciertos seguidos necesarios para subir el multiplicador. */
  tierSize: number;
  /** Puntos base de un acierto antes de multiplicar. */
  basePoints: number;
}

/** Notas sueltas: sube cada 5 aciertos, 150 puntos base. */
export const NOTE_RULES: HitRules = { tierSize: 5, basePoints: 150 };
/** Acordes: sube cada 3 aciertos, 300 puntos base. */
export const CHORD_RULES: HitRules = { tierSize: 3, basePoints: 300 };

export interface HitResult {
  /** Puntos sumados en este acierto (ya multiplicados). */
  points: number;
  /** true si el multiplicador subió con este acierto (para mostrar el aviso). */
  multiplierUp: boolean;
}

export class Scoreboard {
  public score = 0;
  public combo = 0;
  public comboInTier = 0;
  public multiplier = 1;
  public maxCombo = 0;

  public targetScore: number;

  constructor(targetScore: number) {
    this.targetScore = targetScore;
  }

  /** Vuelve a empezar; `targetScore` cambia si la canción lo pide. */
  reset(targetScore: number = this.targetScore): void {
    this.targetScore = targetScore;
    this.score = 0;
    this.combo = 0;
    this.comboInTier = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
  }

  hit(rules: HitRules): HitResult {
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboInTier++;

    let multiplierUp = false;
    if (this.comboInTier >= rules.tierSize) {
      this.comboInTier = 0;
      if (this.multiplier < MAX_MULTIPLIER) {
        this.multiplier++;
        multiplierUp = true;
      }
    }

    const points = rules.basePoints * this.multiplier;
    this.score = Math.min(this.score + points, this.targetScore);
    return { points, multiplierUp };
  }

  miss(): void {
    this.combo = 0;
    this.comboInTier = 0;
    this.multiplier = 1;
  }
}
