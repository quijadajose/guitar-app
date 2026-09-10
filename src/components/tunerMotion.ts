class TunerMotion {
  private timer = 0;

  pluck(_stringNum: number, sustain = false): void {
    const photo = document.getElementById('tuner-headstock-photo');
    photo?.classList.add('vibrating');
    if (this.timer) window.clearTimeout(this.timer);
    if (!sustain) {
      this.timer = window.setTimeout(() => this.release(), 900);
    }
  }

  release(): void {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
    document.getElementById('tuner-headstock-photo')?.classList.remove('vibrating');
  }

  stop(): void {
    this.release();
  }
}

export const tunerMotion = new TunerMotion();
