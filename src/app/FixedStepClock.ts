import { DRIVING_STEP_SECONDS } from '../domain/simulation/driving';

export class FixedStepClock {
  private previousMs: number | null = null;
  private remainderSeconds = 0;

  reset(): void {
    this.previousMs = null;
    this.remainderSeconds = 0;
  }

  advance(timestampMs: number, active: boolean): Readonly<{ steps: number; discardedSeconds: number }> {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new RangeError('帧时刻必须为有限的非负数。');
    if (!active) {
      this.reset();
      return { steps: 0, discardedSeconds: 0 };
    }
    if (this.previousMs === null) {
      this.previousMs = timestampMs;
      return { steps: 0, discardedSeconds: 0 };
    }
    if (timestampMs < this.previousMs) throw new RangeError('帧时刻不能倒退。');
    const gapSeconds = (timestampMs - this.previousMs) / 1000;
    this.previousMs = timestampMs;
    const accumulated = this.remainderSeconds + gapSeconds;
    const available = Math.floor((accumulated + 1e-10) / DRIVING_STEP_SECONDS);
    const steps = Math.min(5, available);
    this.remainderSeconds = Math.max(0, accumulated - available * DRIVING_STEP_SECONDS);
    return { steps, discardedSeconds: (available - steps) * DRIVING_STEP_SECONDS };
  }
}
