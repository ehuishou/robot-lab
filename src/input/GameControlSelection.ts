/** Keep native touch selection out of game controls without disabling page inputs. */
export class GameControlSelection {
  private readonly abort = new AbortController();
  private readonly touches = new Map<number, { target: HTMLElement | null; x: number; y: number; moved: boolean }>();
  constructor(private readonly root: HTMLElement) {
    const options = { signal: this.abort.signal };
    root.addEventListener('contextmenu', this.preventSelection, options);
    root.addEventListener('selectstart', this.preventSelection, options);
    root.addEventListener('dragstart', this.preventSelection, options);
    root.addEventListener('pointerdown', this.clearOnControl, options);
    root.addEventListener('touchstart', this.touchStart, { ...options, passive: false });
    root.addEventListener('touchmove', this.touchMove, { ...options, passive: false });
    root.addEventListener('touchend', this.touchEnd, { ...options, passive: false });
    root.addEventListener('touchcancel', this.touchCancel, options);
    window.addEventListener('blur', this.reset, options);
    document.addEventListener('visibilitychange', this.reset, options);
  }
  private inControls(target: EventTarget | null): target is HTMLElement {
    return target instanceof HTMLElement && !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),a')
      && !!target.closest('button,summary,.driving-panel,.session-toolbar');
  }
  private clearSelection(): void {
    const selection = window.getSelection();
    if (selection && [selection.anchorNode, selection.focusNode].some(node => node && this.root.contains(node))) selection.removeAllRanges();
  }
  private preventSelection = (event: Event): void => {
    if (this.inControls(event.target)) { event.preventDefault(); this.clearSelection(); }
  };
  private clearOnControl = (event: PointerEvent): void => { if (this.inControls(event.target)) this.clearSelection(); };
  private touchStart = (event: TouchEvent): void => {
    if (!this.inControls(event.target)) return;
    // WebKit can create selection handles without firing selectstart. Stop the
    // initiating touch default, then dispatch one ordinary tap for non-drive controls.
    if (event.cancelable) event.preventDefault();
    this.clearSelection();
    const target = event.target.closest<HTMLElement>('button,summary');
    for (const touch of Array.from(event.changedTouches)) this.touches.set(touch.identifier, {
      target: target?.matches(':disabled,[data-drive]') ? null : target, x: touch.clientX, y: touch.clientY, moved: false,
    });
  };
  private touchMove = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      const tracked = this.touches.get(touch.identifier);
      if (!tracked) continue;
      if (event.cancelable) event.preventDefault();
      if (Math.hypot(touch.clientX-tracked.x,touch.clientY-tracked.y)>12) tracked.moved=true;
      this.clearSelection();
    }
  };
  private touchEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      const tracked = this.touches.get(touch.identifier);
      if (!tracked) continue;
      this.touches.delete(touch.identifier);
      if (event.cancelable) event.preventDefault();
      this.clearSelection();
      const target=tracked.target, hit=document.elementFromPoint(touch.clientX,touch.clientY);
      if (target?.isConnected && !tracked.moved && !target.matches(':disabled') && hit && target.contains(hit)) target.click();
    }
  };
  private touchCancel = (): void => { this.reset(); this.clearSelection(); };
  private reset = (): void => { this.touches.clear(); };
  dispose(): void { this.reset(); this.abort.abort(); }
}
