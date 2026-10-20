import type { DrivingAction } from './DrivingInput';
import { DrivingInput } from './DrivingInput';

export class BrowserDrivingInput {
  private readonly abort = new AbortController();
  private readonly heldKeys = new Set<string>();
  private readonly pointers = new Map<number, HTMLButtonElement>();

  constructor(private readonly root: HTMLElement, private readonly input: DrivingInput,
    private readonly isRunning: () => boolean, private readonly onPause: () => void) {
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', this.keyUp, options);
    window.addEventListener('blur', this.deactivate, options);
    document.addEventListener('visibilitychange', this.visibility, options);
    window.screen.orientation?.addEventListener('change', this.deactivate, options);
    root.addEventListener('pointerdown', this.pointerDown, options);
    root.addEventListener('pointerup', this.pointerUp, options);
    root.addEventListener('pointercancel', this.pointerUp, options);
    root.addEventListener('lostpointercapture', this.pointerUp, options);
  }

  clear(): void {
    this.heldKeys.clear();
    this.input.clear();
    for (const [pointerId, button] of this.pointers) {
      button.setAttribute('aria-pressed', 'false');
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    }
    this.pointers.clear();
    for (const button of this.root.querySelectorAll('[data-drive]')) button.setAttribute('aria-pressed', 'false');
  }

  dispose(): void { this.clear(); this.abort.abort(); }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (!event.repeat) this.onPause();
      event.preventDefault();
      return;
    }
    if (!['d', 'arrowright', 'a', 'arrowleft', ' ', 'e'].includes(key)) return;
    if (!this.isRunning()) return;
    event.preventDefault();
    if (event.repeat || this.heldKeys.has(key)) return;
    this.heldKeys.add(key);
    this.input.setKey(event.key, true);
    this.refreshPressed();
  };

  private keyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.key.toLowerCase());
    this.input.setKey(event.key, false);
    this.refreshPressed();
  };

  private pointerDown = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-drive],[data-action="pause"]') : null;
    if (!button || button.disabled || !this.isRunning() || event.button !== 0) return;
    if (button.dataset.action === 'pause') return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, button);
    this.input.setAction(`pointer:${event.pointerId}`, button.dataset.drive as DrivingAction, true);
    this.refreshPressed();
  };

  private pointerUp = (event: PointerEvent): void => {
    const button = this.pointers.get(event.pointerId);
    if (!button) return;
    this.pointers.delete(event.pointerId);
    this.input.releaseSource(`pointer:${event.pointerId}`);
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    this.refreshPressed();
  };

  private refreshPressed(): void {
    const keys: Record<DrivingAction, readonly string[]> = { forward: ['d', 'arrowright'], reverse: ['a', 'arrowleft'], brake: [' '], interact: ['e'] };
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
      const action = button.dataset.drive as DrivingAction;
      const pressed = this.isRunning() && (keys[action].some(key => this.heldKeys.has(key))
        || [...this.pointers.values()].some(pointer => pointer.dataset.drive === action));
      button.setAttribute('aria-pressed', String(pressed));
    }
  }

  private deactivate = (): void => { this.clear(); this.onPause(); };
  private visibility = (): void => { if (document.hidden) this.deactivate(); };
}
