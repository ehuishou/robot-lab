// Test policy is fixed for each page load; query parameters survive navigation.
export const TEST_MODE = typeof document !== 'undefined' &&
  (new URLSearchParams(location.search).get('test') ??
    document.querySelector<HTMLMetaElement>('meta[name="robot-test-mode"]')?.content) === '1';

export function installTestModeControl(): void {
  const panel = document.createElement('aside');
  panel.id = 'test-mode-control';
  panel.style.cssText = 'position:fixed;left:8px;bottom:4px;z-index:10000;max-width:calc(100vw - 16px);padding:4px 8px;border:1px solid #58d6b5;border-radius:8px;background:#102023ed;color:#fff;font:11px sans-serif;box-sizing:border-box';
  const placePanel = () => {
    const narrow = window.matchMedia('(max-width:900px), (max-height:500px) and (max-width:1100px)').matches;
    panel.style.top = narrow ? '4px' : 'auto';
    panel.style.bottom = narrow ? 'auto' : '4px';
    panel.style.right = narrow ? '8px' : 'auto';
    panel.style.maxWidth = narrow ? 'none' : 'calc(100vw - 16px)';
  };
  placePanel();
  window.addEventListener('resize', placePanel);
  const label = document.createElement('span');
  label.textContent = TEST_MODE ? '测试模式 ' : '正常模式 ';
  label.title = '零成本、全工具能力、无限能源与时限；测试存档独立保存';
  const button = document.createElement('button');
  button.textContent = TEST_MODE ? '切回正常' : '开启测试';
  button.style.cssText = 'cursor:pointer;margin-left:4px;padding:4px 8px;font:inherit';
  button.onclick = () => {
    const url = new URL(location.href);
    url.searchParams.set('test', TEST_MODE ? '0' : '1');
    location.href = url.href;
  };
  panel.append(label, button);
  document.body.append(panel);
  const style = document.createElement('style');
  style.textContent = '@media(max-width:900px),(max-height:500px) and (max-width:1100px){#preview-app{padding-top:var(--test-panel-height,62px)}#preview-app[data-playing=true]{top:var(--test-panel-height,62px);padding-top:0}}';
  document.head.append(style);
  const reserveSpace = () => document.documentElement.style.setProperty('--test-panel-height', (panel.getBoundingClientRect().height + 8) + 'px');
  new ResizeObserver(reserveSpace).observe(panel);
  reserveSpace();
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.origin !== location.origin) return;
    const url = new URL(link.href);
    url.searchParams.set('test', TEST_MODE ? '1' : '0');
    link.href = url.href;
  }, true);
}
