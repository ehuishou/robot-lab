import type { DrivingIntent } from '../domain/simulation/driving';

export type DrivingAction = 'forward' | 'reverse' | 'brake' | 'interact';

const KEY_ACTIONS: Readonly<Record<string, DrivingAction>> = {
  d: 'forward', ArrowRight: 'forward', a: 'reverse', ArrowLeft: 'reverse', ' ': 'brake', e: 'interact',
};

export class DrivingInput {
  private readonly sources = new Map<string, Set<DrivingAction>>();
  private pendingInteraction = false;
  private enabled = true;

  setAction(sourceId: string, action: DrivingAction, pressed: boolean): void {
    if (!sourceId.trim() || !['forward', 'reverse', 'brake', 'interact'].includes(action)) throw new RangeError('输入源或动作无效。');
    if (!this.enabled) return;
    const actions = this.sources.get(sourceId) ?? new Set<DrivingAction>();
    if (pressed) {
      if (!actions.has(action) && action === 'interact') this.pendingInteraction = true;
      actions.add(action);
      this.sources.set(sourceId, actions);
    } else {
      actions.delete(action);
      if (!actions.size) this.sources.delete(sourceId);
    }
  }

  setKey(key: string, pressed: boolean): boolean {
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    if (!Object.hasOwnProperty.call(KEY_ACTIONS, normalized)) return false;
    this.setAction(`key:${normalized}`, KEY_ACTIONS[normalized], pressed);
    return true;
  }

  releaseSource(sourceId: string): void {
    this.sources.delete(sourceId);
  }

  clear(): void {
    this.sources.clear();
    this.pendingInteraction = false;
  }

  setEnabled(enabled: boolean): void {
    this.clear();
    this.enabled = enabled;
  }

  poll(): DrivingIntent & Readonly<{ interact: boolean }> {
    const active = (action: DrivingAction) => [...this.sources.values()].some(actions => actions.has(action));
    const intent = { throttle: (Number(active('forward')) - Number(active('reverse'))) as -1 | 0 | 1,
      brake: active('brake'), interact: this.pendingInteraction };
    this.pendingInteraction = false;
    return Object.freeze(intent);
  }
}
