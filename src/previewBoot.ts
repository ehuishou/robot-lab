import './ui/preview.css';
import { VisualPreviewApp } from './app/VisualPreviewApp';

declare global {
  interface Window {
    previewStartupFailure: (error: unknown) => void;
    robotLabPreview: Readonly<{ diagnostics: Readonly<Record<string, unknown>> }>;
  }
}

let app: VisualPreviewApp | null = null;
const fail = (error: unknown) => {
  app?.dispose();
  window.previewStartupFailure(error);
};
window.addEventListener('error', event => fail(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
try {
  const root = document.getElementById('preview-app');
  if (!root) throw new Error('缺少游戏容器。');
  app = new VisualPreviewApp(root, fail);
  Object.defineProperty(window, 'robotLabPreview', { value: Object.freeze({ get diagnostics() { return app?.diagnostics ?? {}; } }) });
  document.documentElement.dataset.previewState = 'ready';
  document.getElementById('preview-startup')!.hidden = true;
  window.addEventListener('pagehide', () => app?.dispose());
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
} catch (error) {
  fail(error);
}

