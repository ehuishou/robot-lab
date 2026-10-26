import { MapTutorial } from './MapTutorial';
import { NicknameScores } from './NicknameScores';
import { GameControlSelection } from '../input/GameControlSelection';
import { senseEnvironment, routePresentation, hasBypass, bypassBounds } from '../domain/simulation/environment';
import { TRANSPORT_MISSION } from '../content/challenges';
import { SCORE_WEIGHTS } from '../domain/mission/scoring';
import { readBestScore, saveChallengeResult } from './ChallengeRecords';
import { MODULE_CATEGORIES, validateConfiguration } from '../domain/config/validateConfiguration';
import type { Configuration, ModuleCategory } from '../domain/config/validateConfiguration';
import { MODULES as NORMAL_MODULES } from '../content/modules';
import type { MissionDefinition } from '../domain/mission/definition';
import { PREVIEW_ASSETS } from '../content/assets';
import { createMissionSession, createRenderSnapshot } from '../domain/mission/session';
import { findNearbyInteraction } from '../domain/mission/nearbyInteraction';
import { BrowserDrivingInput } from '../input/BrowserDrivingInput';
import { PreviewRenderer } from '../render/PreviewRenderer';
import { DrivingSessionController } from './DrivingSessionController';
import { readPreviewConfiguration, savePreviewConfiguration } from './PreviewSave';

import { TEST_MODE } from '../testing/TestMode';
import { sandboxCatalog, sandboxMission } from '../testing/SandboxPolicy';
const PREVIEW_MODULES = TEST_MODE ? sandboxCatalog(NORMAL_MODULES) : NORMAL_MODULES;
const MISSION = TEST_MODE ? sandboxMission(TRANSPORT_MISSION) : TRANSPORT_MISSION;

const CATEGORY_NAMES: Record<ModuleCategory, string> = { chassis: '底盘', motor: '电机', battery: '电池', sensor: '传感器', tool: '搬运', accessory: '前置附件' };
const DISPLAY_MODULES = NORMAL_MODULES;
type Page = 'configuration' | 'world' | 'result';

export class VisualPreviewApp {
  private configuration: Configuration = { ...MISSION.recommendedConfiguration };
  private category: ModuleCategory = 'chassis';
  private page: Page = 'configuration';
  private mission: MissionDefinition = MISSION;
  private recordMessage = '';
  private runNickname = '';
  private readonly nicknameScores: NicknameScores;
  private readonly tutorial: MapTutorial;
  private readonly renderer: PreviewRenderer;
  private readonly abort = new AbortController();
  private controller: DrivingSessionController | null = null;
  private browserInput: BrowserDrivingInput | null = null;
  private readonly controlSelection: GameControlSelection;
  private lastHudUpdate = 0;
  private disposed = false;
  private readonly buildId = document.querySelector<HTMLMetaElement>('meta[name="robot-build-id"]')?.content ?? 'unknown';

  constructor(private readonly root: HTMLElement, onFailure: (error: unknown) => void) {
    let storageMessage = '';
    try {
      const saved = readPreviewConfiguration(localStorage, PREVIEW_MODULES);
      if (saved.status === 'loaded') this.configuration = saved.configuration;
      if (saved.status === 'rejected') storageMessage = `未载入草稿：${saved.reason}`;
    } catch { storageMessage = '浏览器存储不可用，仍可开始任务。'; }
    root.innerHTML = `
      <header class="topbar"><a class="brand" href="./preview.html"><span class="brand-mark">RL</span><span>ROBOT LAB</span></a><div class="player-actions"><button id="tutorial-button" type="button">地图教学</button><button id="nickname-button" type="button"></button></div></header>
      <nav class="page-tabs" aria-label="任务页面"><button data-page="configuration">组装</button><button data-page="world">驾驶</button><button data-page="result" disabled>结算</button><span id="mission-mode"></span></nav>
      <main class="workbench">
        <aside class="module-panel panel"><div class="panel-heading"><h1>选择组件</h1></div><div class="category-tabs" role="group" aria-label="模块类别">${MODULE_CATEGORIES.map(category => `<button data-category="${category}">${CATEGORY_NAMES[category]}</button>`).join('')}</div><div id="module-cards"></div><div class="storage-actions"><button data-action="recommended">推荐配置</button><button data-action="save">保存配置</button></div><p id="storage-message" class="muted" role="status"></p></aside>
        <section class="viewport-panel panel" aria-label="三维场景">
          <div class="viewport-heading"><div><h2 id="view-title">机器人装配预览</h2></div></div><div id="three-viewport"></div>
          <div id="session-toolbar" class="session-toolbar" hidden><button data-action="pause" aria-label="暂停任务">Ⅱ <span>暂停</span><kbd>Esc</kbd></button></div>
          <div class="viewport-caption"><span id="view-caption">灯光、材质与模块轮廓实时渲染</span><span id="terrain-caption"></span></div>
          <div class="camera-controls" role="group" aria-label="镜头控制"><button data-action="orbit-left" aria-label="向左旋转镜头">↶</button><button data-action="orbit-right" aria-label="向右旋转镜头">↷</button><button data-action="zoom-in" aria-label="拉近镜头">＋</button><button data-action="zoom-out" aria-label="拉远镜头">−</button><button data-action="loading">装载区</button><button data-action="delivery">交付区</button></div>
          <div id="hud-demo" class="hud-demo" hidden><div><span>任务时间 / 位置</span><strong id="hud-time"></strong></div><div><span>能源 / 速度</span><strong id="hud-energy"></strong><div class="energy-track"><i id="energy-fill"></i></div></div><div><span>运输目标</span><strong id="hud-objective"></strong></div><details id="physics-test" hidden><summary>物理测试</summary><button data-action="physics-push">轻推</button><button data-action="physics-topple">强推</button><button data-action="physics-reset">扶正</button><button data-action="physics-overlay" aria-pressed="false">显示受力</button><span id="physics-legend" hidden>橙：重心 · 青：支撑力 · 红：打滑</span></details><div id="interaction-prompt" class="control-legend" role="status" aria-live="polite"></div></div>
          <div id="driving-panel" class="driving-panel" hidden><div class="driving-buttons" role="group" aria-label="驾驶操作"><div class="drive-cluster" role="group" aria-label="方向"><button data-drive="reverse" aria-label="按住倒退" aria-pressed="false"><span class="drive-symbol" aria-hidden="true">←</span><span>倒退</span><kbd>A / ←</kbd></button><button data-drive="forward" aria-label="按住前进" aria-pressed="false"><span class="drive-symbol" aria-hidden="true">→</span><span>前进</span><kbd>D / →</kbd></button></div><div class="drive-cluster drive-actions" role="group" aria-label="制动与交互"><button data-drive="brake" aria-label="按住刹车" aria-pressed="false"><span class="drive-symbol" aria-hidden="true">▣</span><span>刹车</span><kbd>Space</kbd></button><button data-drive="interact" aria-pressed="false"><span class="drive-symbol" aria-hidden="true">◇</span><span id="interaction-label">交互</span><kbd>E</kbd></button></div></div><div id="environment-controls" class="environment-controls" hidden><span id="route-status"></span></div><p><span>按住方向行驶 · 松开滑行</span><span>停稳后交互 · 装卸 / 充能 / 清障</span></p></div>
          <dialog id="bridge-route-dialog" class="bridge-route-dialog" aria-labelledby="bridge-route-title" aria-describedby="bridge-route-description">
            <span class="bridge-route-eyebrow">路线选择 · 游戏已暂停</span>
            <h2 id="bridge-route-title">拱桥还是旁路？</h2>
            <p id="bridge-route-description">请选择接下来的路线。选择期间不计时、不耗电，车辆不会移动。</p>
            <div class="bridge-route-options">
              <button type="button" data-action="route-direct"><span class="bridge-route-icon" aria-hidden="true">↥</span><span><strong>走拱桥</strong><small>需要四足底盘</small><small id="bridge-route-requirement"></small></span></button>
              <button type="button" data-action="route-bypass"><span class="bridge-route-icon" aria-hidden="true">↗</span><span><strong>走旁路</strong><small>路程更长 · 所有底盘可通行</small><small id="bypass-distance"></small></span></button>
            </div>
            <p class="bridge-route-footnote">选好后恢复游戏 · 按住方向继续行驶</p>
          </dialog>
          <div id="pause-overlay" class="pause-overlay" hidden><h2>任务已暂停</h2><button class="primary" data-action="resume">继续驾驶</button><button data-action="retry">重新开始</button><button data-page="configuration">返回配置</button></div>
          <div id="result-demo" class="result-demo" hidden><h2 id="result-title">任务结算</h2><p id="result-reason"></p><div class="result-row"><span>货物交付</span><strong id="result-delivery"></strong></div><div class="result-row"><span>到达终点</span><strong id="result-finish"></strong></div><div class="result-row"><span>耗时 / 剩余能源</span><strong id="result-metrics"></strong></div><div id="challenge-result" class="challenge-result" hidden></div><p id="record-status" class="muted" role="status"></p><button data-action="retry-score">重试保存</button><div class="result-actions"><button class="primary" data-action="retry">重新挑战</button><button data-page="configuration">返回配置</button></div></div>
        </section>
        <aside class="inspection-panel panel"><h2 id="mission-title"></h2><div id="mission-route" class="mission-route"></div><div id="budget-summary" class="budget-summary" role="status"></div><p id="best-score" class="muted"></p><details class="mission-help"><summary>评分规则</summary><p class="muted">时间 ${SCORE_WEIGHTS.time} · 电量 ${SCORE_WEIGHTS.energy} · 交付 ${SCORE_WEIGHTS.cargo} · 预算 ${SCORE_WEIGHTS.budget}。时间、电量和预算按剩余比例计分；货物交付后获得运输分。</p></details><div class="section-label">性能</div><div id="metrics" class="metrics"></div><div id="validation" role="status"></div><button id="start-session" class="primary" data-action="start">开始运输任务 →</button><details class="mission-help"><summary>操作与任务说明</summary><p class="muted" id="mission-description"></p><p class="muted demo-note" id="mission-note"></p></details></aside>
      </main><footer class="preview-footer"><div id="selected-summary" hidden></div><a class="github-link" href="https://github.com/ehuishou/robot-lab" target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开 GitHub 仓库" title="GitHub 仓库"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/></svg><span>GitHub</span></a><details><summary>版本信息</summary><code id="build-identity"></code></details></footer>`;
    this.element('storage-message').textContent = storageMessage;
    this.element('build-identity').textContent = this.buildId;
    this.renderer = new PreviewRenderer(this.element('three-viewport'), this.configuration, this.mission, onFailure);
    this.renderer.onFrame = timestampMs => this.advanceFrame(timestampMs);
    root.addEventListener('click', event => this.handleClick(event), { signal: this.abort.signal });
    this.controlSelection = new GameControlSelection(root);
    this.nicknameScores = new NicknameScores(root);
    this.tutorial = new MapTutorial(root);
    root.addEventListener('nicknamechange',()=>{this.refresh();this.tutorial.openIfNeeded();},{signal:this.abort.signal});
    this.element('tutorial-button').addEventListener('click',()=>{if (!this.nicknameScores.nickname) this.nicknameScores.open(); else this.tutorial.open();},{signal:this.abort.signal});
    if (this.nicknameScores.nickname) this.tutorial.openIfNeeded();
    this.element('bridge-route-dialog').addEventListener('cancel', event => event.preventDefault(), { signal: this.abort.signal });
    this.refresh();
  }

  get diagnostics(): Readonly<Record<string, unknown>> {
    const state = this.controller?.state;
    return { buildId: this.buildId, testMode: TEST_MODE, page: this.page, category: this.category, configuration: { ...this.configuration },
      missionId: this.mission.id, validation: validateConfiguration(this.configuration, PREVIEW_MODULES, this.mission.configurationRules),
      pendingBridgeSectionId: this.controller?.pendingBridgeSectionId ?? null,
      renderer: this.renderer.diagnostics, disposed: this.disposed, staticDemo: false,
      session: state ? { environment: state.environment, challenge: state.challenge, sessionId: state.sessionId, missionId: state.mission.id, phase: state.phase, xM: state.xM, speedMps: state.speedMps,
        heightM: state.heightM, slopeDegrees: state.slopeDegrees, quadruped: state.quadruped,
        elapsedSeconds: state.elapsedSeconds, energyRemainingUnits: state.energyRemainingUnits,
        energyRestoredUnits: state.energyRestoredUnits, cargo: state.cargo,
        completedObjectiveIds: state.completedObjectiveIds, result: state.result } : null };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.tutorial.dispose();
    this.nicknameScores.dispose();
    this.controlSelection.dispose();
    this.endSession();
    this.renderer.dispose();
  }

  private element(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`界面元素缺失：${id}`);
    return element;
  }

  private get loadingItem() {
    const item = this.mission.layout.find(candidate => candidate.kind === 'cargo');
    if (!item || item.kind !== 'cargo') throw new Error('运输样板缺少装载货物。');
    return item;
  }

  private get deliveryZone() {
    const item = this.mission.layout.find(candidate => candidate.kind === 'deliveryZone');
    if (!item || item.kind !== 'deliveryZone') throw new Error('运输样板缺少交付平台。');
    return item;
  }

  private get finishObjective() {
    const objective = this.mission.objectives.find(candidate => candidate.kind === 'reach');
    if (!objective || objective.kind !== 'reach') throw new Error('运输样板缺少终点。');
    return objective;
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.root.contains(button) || button.disabled) return;
    if (button.dataset.category) this.category = button.dataset.category as ModuleCategory;
    if (button.dataset.module && !this.controller) {
      this.configuration = { ...this.configuration, [this.category]: button.dataset.module === 'none' ? null : button.dataset.module };
      this.renderer.setConfiguration(this.configuration);
    }
    if (button.dataset.page) {
      const page = button.dataset.page as Page;
      if (page === 'result' && !this.controller?.state.result) return;
      if (page === 'configuration') this.endSession();
      this.page = page;
      if (!this.controller) this.renderer.setView(page === 'configuration' ? 'configuration' : 'world', this.loadingItem.xM);
    }
    switch (button.dataset.action) {
      case 'route-direct': case 'route-bypass': {
        const state=this.controller?.state;
        const section=state?.mission.environment && state.environment && routePresentation(state.mission.environment,state.environment,state.xM).junction;
        if(section) this.controller?.action({kind:'route',sectionId:section.id,route:button.dataset.action==='route-direct'?'direct':'bypass'});
        break;
      }
      case 'retry-score': this.submitScore(); break;
      case 'start': case 'retry': this.startSession(); break;
      case 'pause': this.pauseSession(); break;
      case 'physics-overlay': {
        const visible = this.renderer.togglePhysicsOverlay();
        button.textContent = visible ? '隐藏受力' : '显示受力';
        button.setAttribute('aria-pressed', String(visible));
        this.element('physics-legend').hidden = !visible;
        break;
      }
      case 'physics-push': case 'physics-topple': case 'physics-reset':
        this.controller?.physicsTest(button.dataset.action.slice(8) as 'push' | 'topple' | 'reset');
        if(this.controller) this.renderer.setSnapshot(createRenderSnapshot(this.controller.state));
        break;
      case 'resume': this.browserInput?.clear(); this.controller?.resume(); break;
      case 'recommended':
        if (!this.controller) { this.configuration = { ...this.mission.recommendedConfiguration }; this.renderer.setConfiguration(this.configuration); }
        break;
      case 'save': this.withStorage(() => { const result = savePreviewConfiguration(localStorage, this.configuration, PREVIEW_MODULES); return result.saved ? '配置草稿已保存。' : `保存失败：${result.reason}`; }); break;
      case 'orbit-left': this.renderer.orbit(-0.2); break;
      case 'orbit-right': this.renderer.orbit(0.2); break;
      case 'zoom-in': this.renderer.adjustZoom(-0.12); break;
      case 'zoom-out': this.renderer.adjustZoom(0.12); break;
      case 'loading': case 'delivery':
        if (!this.controller) this.renderer.setView(this.page === 'configuration' ? 'configuration' : 'world', button.dataset.action === 'delivery' ? this.deliveryZone.xM : this.loadingItem.xM);
        break;
    }
    this.refresh();
    if (!button.isConnected) this.root.querySelector<HTMLButtonElement>(`[data-module="${this.configuration[this.category]}"]`)?.focus({ preventScroll: true });
  }

  private withStorage(action: () => string): void {
    try { this.element('storage-message').textContent = action(); }
    catch { this.element('storage-message').textContent = '浏览器存储不可用；配置仍保留在当前页面。'; }
  }

  private startSession(): void {
    if (!this.nicknameScores.nickname) {this.nicknameScores.open();return;}
    if (!validateConfiguration(this.configuration, PREVIEW_MODULES, this.mission.configurationRules).valid) return;
    this.endSession();
    this.recordMessage = '';
    this.runNickname = this.nicknameScores.nickname;
    const { state } = createMissionSession((globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`), this.mission, this.configuration, PREVIEW_MODULES, PREVIEW_ASSETS);
    this.controller = new DrivingSessionController(state);
    this.browserInput = new BrowserDrivingInput(this.root, this.controller.input,
      () => this.controller?.state.phase === 'running', () => this.pauseSession());
    this.page = 'world';
    this.lastHudUpdate = 0;
    this.renderer.setConfiguration(this.configuration);
    this.renderer.setView('world', this.mission.spawnXM);
    this.renderer.setSnapshot(createRenderSnapshot(state));
    this.refresh();
    this.element('driving-panel').scrollIntoView({ block: 'nearest' });
  }

  private endSession(): void {
    this.browserInput?.dispose();
    this.browserInput = null;
    this.controller?.pause();
    this.controller = null;
    this.root.dataset.playing = 'false';
    this.renderer.setSnapshot(null);
    (this.element('bridge-route-dialog') as HTMLDialogElement).close();
    this.element('pause-overlay').hidden = true;
    this.element('session-toolbar').hidden = true;
  }

  private pauseSession(): void {
    if (this.controller?.state.phase !== 'running') return;
    this.controller.pause();
    this.browserInput?.clear();
    this.refreshSession();
    this.root.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus({ preventScroll: true });
  }

  private advanceFrame(timestampMs: number): void {
    if (!this.controller || this.controller.state.phase !== 'running') return;
    const frame = this.controller.advanceFrame(timestampMs);
    if (frame.steps) this.renderer.setSnapshot(createRenderSnapshot(this.controller.state));
    if (this.controller.pendingBridgeSectionId) { this.browserInput?.clear(); this.refreshSession(); return; }
    if (this.controller.state.result) {
      let saved: ReturnType<typeof saveChallengeResult> = 'unavailable';
      try { saved = saveChallengeResult(this.nicknameScores.storage(), this.controller.state); } catch { /* Storage may be disabled. */ }
      this.recordMessage = saved === 'excluded' ? '' : '正在保存成绩…';
      this.submitScore();
      this.page = 'result';
      this.browserInput?.clear();
      this.refresh();
      this.root.querySelector<HTMLButtonElement>('#result-demo [data-action="retry"]')?.focus({ preventScroll: true });
    } else if (timestampMs - this.lastHudUpdate >= 100 || frame.events.some(event => event.kind !== 'advanced')) {
      this.lastHudUpdate = timestampMs;
      this.refreshSession();
    }
  }

  private submitScore(): void {
    const state=this.controller?.state;
    if (!state?.result || state.phase!=='succeeded' || state.challenge?.testMode) return;
    this.recordMessage='正在保存成绩…';
    void this.nicknameScores.submit(state,this.runNickname).then(message=>{if(!this.disposed && this.controller?.state.sessionId===state.sessionId){this.recordMessage=message;this.refreshSession();}});
  }

  private refreshBridgeRouteDialog(): void {
    const dialog = this.element('bridge-route-dialog') as HTMLDialogElement;
    const state = this.controller?.state;
    const section = state?.mission.environment?.sections.find(s => s.id === this.controller?.pendingBridgeSectionId);
    if (!section || state?.phase !== 'paused') {
      if (dialog.open) {
        dialog.close();
        this.root.querySelector<HTMLButtonElement>('[data-drive="forward"]')?.focus({ preventScroll: true });
      }
      return;
    }
    const quadruped = state.configuration.chassis === 'chassis_quadruped';
    this.root.querySelector<HTMLButtonElement>('[data-action="route-direct"]')!.disabled = !quadruped;
    this.root.querySelector<HTMLButtonElement>('[data-action="route-bypass"]')!.disabled = false;
    this.element('bridge-route-requirement').textContent = quadruped ? '当前底盘可高效翻桥' : '当前底盘不支持，请走旁路';
    this.element('bypass-distance').textContent = '比拱桥多 ' + section.extraM + ' 米';
    if (!dialog.open) {
      this.browserInput?.clear();
      dialog.showModal();
      this.root.querySelector<HTMLButtonElement>('[data-action="' + (quadruped ? 'route-direct' : 'route-bypass') + '"]')?.focus({ preventScroll: true });
    }
  }

  private refreshSession(): void {
    this.nicknameScores.update(this.controller?.state.phase==='running' || this.controller?.state.phase==='paused');
    this.root.querySelector<HTMLButtonElement>('#tutorial-button')!.disabled=!!this.controller;
    const state = this.controller?.state;
    this.element('hud-demo').hidden = !state || this.page !== 'world';
    this.element('driving-panel').hidden = !state || this.page !== 'world' || !!state.result;
    this.element('session-toolbar').hidden = !state || this.page !== 'world' || !!state.result;
    this.element('pause-overlay').hidden = state?.phase !== 'paused' || !!this.controller?.pendingBridgeSectionId;
    this.refreshBridgeRouteDialog();
    this.element('result-demo').hidden = !state?.result || this.page !== 'result';
    this.element('physics-test').hidden = !TEST_MODE || !state?.quadruped;
    this.element('environment-controls').hidden = !state?.environment;
    if (!state) return;
    if(state.environment && state.mission.environment) {
      const env=state.environment, presentation=routePresentation(state.mission.environment,env,state.xM), junction=presentation.junction;
      const work=env.work, sensed=senseEnvironment(state.mission.environment,env,state.xM,state.speedMps<-.1?-1:1);
      const choice=presentation.choice==='bypass'?'旁路':'直行';
      const status=work ? (work.kind==='charge'?'充电中':work.kind==='clear'?'清障中':work.kind==='load'?'装载中':'卸货中')
        :junction ? junction.label+' · '+(this.controller?.pendingBridgeSectionId?'暂停选路':'已选'+choice)
        :presentation.active ? presentation.active.label+' · 已选'+choice
        :presentation.section ? (presentation.merged?'已汇入主路 · ':'')+presentation.section.label+' '+presentation.distanceM.toFixed(0)+'m · '+(hasBypass(presentation.section)?'旁路 +'+presentation.section.extraM+'m':'必经路段')
        :presentation.merged ? '已汇入主路'
        :env.blocked || (sensed?sensed.section.label+' '+sensed.distanceM.toFixed(0)+'m':'行程 '+env.distanceM.toFixed(0)+'m');
      this.element('route-status').textContent=status;
      this.element('environment-controls').dataset.routeState=junction?'junction':presentation.active?'active':presentation.section?'approach':'idle';
      this.element('environment-controls').dataset.choice=presentation.choice??'direct';
    }
    if(state.quadruped) {
      for(const b of this.root.querySelectorAll<HTMLButtonElement>('#physics-test button')) b.disabled = state.phase !== 'running';
    }
    this.element('hud-time').textContent = `${state.elapsedSeconds.toFixed(1)} / ${TEST_MODE ? '不限' : state.mission.hardLimits.maxTimeSeconds} s · ${state.xM.toFixed(1)} m`;
    this.element('hud-energy').textContent = `${TEST_MODE ? '无限能源' : `${state.energyRemainingUnits.toFixed(1)} / ${state.parameters.batteryCapacityUnits}`} · ${state.speedMps.toFixed(1)} m/s`;
    this.element('energy-fill').style.width = `${100 * state.energyRemainingUnits / state.parameters.batteryCapacityUnits}%`;
    const delivered = state.mission.objectives.filter(objective => objective.kind === 'deliver')
      .every(objective => state.completedObjectiveIds.includes(objective.id));
    const targets = state.mission.layout.filter(item=>item.kind==='cargo');
    const cargoMassKg = targets.reduce((sum,item)=>sum+item.cargo.massKg,0);
    const deliveredCount = targets.filter(item=>state.cargo.delivered.some(c=>c.id===item.id)).length;
    const nextCargo = targets.find(item=>!state.cargo.delivered.some(c=>c.id===item.id)&&!state.cargo.carried.some(c=>c.id===item.id));
    const carriedKg = state.cargo.carried.reduce((sum,c)=>sum+c.massKg,0);
    this.element('hud-objective').textContent = delivered ? '已交齐 · 驶至 '+this.finishObjective.xM+' m'
      : state.cargo.carried.length ? '已交 '+deliveredCount+'/'+targets.length+' · 携带 '+carriedKg+' kg · 前往 '+this.deliveryZone.xM+' m卸货'
      : '已交 '+deliveredCount+'/'+targets.length+' · 前往 '+(nextCargo?.xM ?? this.loadingItem.xM)+' m装载（可选运输加分）';
    const interaction = findNearbyInteraction(state);
    const work = state.environment?.work;
    const workLabel = work ? ({ charge: '充能中', clear: '清障中', load: '装载中', unload: '卸货中' }[work.kind]) : null;
    const actionLabel = interaction?.kind === 'deliver' ? '卸货' : interaction?.kind === 'pickup' ? '装载'
      : interaction?.kind === 'work' ? (interaction.workKind === 'charge' ? '充能' : '清障')
      : interaction?.kind === 'stage' ? '暂存' : null;
    this.element('interaction-label').textContent = workLabel ?? (actionLabel ? '交互·' + actionLabel : '交互');
    const interactionButton = this.root.querySelector<HTMLButtonElement>('[data-drive="interact"]')!;
    interactionButton.dataset.ready = String(!!interaction);
    interactionButton.setAttribute('aria-label', workLabel ?? (actionLabel ? '交互：' + actionLabel : '交互：请靠近目标并停稳'));
    const interactionCargo = interaction?.kind === 'pickup' ? targets.find(item=>item.id===interaction.objectId) : undefined;
    const canLoadNext = nextCargo && carriedKg + nextCargo.cargo.massKg <= state.cargo.capacityKg;
    if (!delivered && state.cargo.carried.length && canLoadNext) this.element('hud-objective').textContent = '已交 '+deliveredCount+'/'+targets.length+' · 前往 '+nextCargo.xM+' m装载';
    const bridge = state.mission.environment?.sections.find(s=>s.kind==='bridge');
    const bridgeBounds = bridge ? bypassBounds(bridge) : null;
    const approachingBridge = bridgeBounds && (
      (state.xM>=bridgeBounds.startM-8 && state.xM<=bridgeBounds.startM)
      || (state.xM>=bridgeBounds.endM && state.xM<=bridgeBounds.endM+8));
    const atBridgeJunction = bridge && state.environment && routePresentation(state.mission.environment!,state.environment,state.xM).junction?.id===bridge.id;
    const routeHint = atBridgeJunction ? '分岔检测点：前进或倒车均可选路，到达后暂停并弹窗选择' : approachingBridge ? (state.configuration.chassis==='chassis_quadruped' ? '前方分岔：四足可直行翻桥，或选平地旁路' : '前方分岔：到达后弹窗选路，拱桥仅限四足') : null;
    const finishHint = state.xM>=this.mission.layout.find(item=>item.kind==='deliveryZone')!.startM ? '终点 '+this.finishObjective.xM+' m · 继续前进，驶过终点结算' : null;
    const prompt = interaction?.kind === 'deliver' ? 'E / 交互：卸货到交付平台' : interaction?.kind === 'pickup' ? `E / 交互：装载 ${interactionCargo?.cargo.massKg ?? ''} kg 货箱`
      : state.phase === 'paused' ? '任务已暂停'
      : work ? workLabel + ' · 剩余 ' + Math.max(0, work.duration - work.seconds).toFixed(1) + ' s'
      : interaction?.kind === 'work' ? 'E / 交互：' + actionLabel + ' · ' + interaction.duration.toFixed(0) + ' s'
      : interaction?.kind === 'stage' ? 'E / 交互：暂存货物（此处不计交付分，可回来装载）'
      : routeHint ?? finishHint ?? '停稳后 E / 交互：装卸、充能、清障';
    if (this.element('interaction-prompt').textContent !== prompt) this.element('interaction-prompt').textContent = prompt;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-drive],[data-action="pause"]')) button.disabled = state.phase !== 'running' || (button.dataset.drive === 'interact' && !interaction);
    if (!state.result) return;
    this.element('result-title').textContent = state.result.outcome === 'succeeded' ? '行程完成' : '运输任务失败';
    const reasons = { overturned: '机器人已翻倒。请调整配置、降低速度，或重新挑战。', timeExceeded: `超过 ${state.mission.hardLimits.maxTimeSeconds} 秒。建议使用刹车停靠，装卸后及时驶向终点。`, energyExhausted: `能源耗尽。可调整电池、选择适配路线，或在47m充能站停靠补能。` };
    this.element('result-reason').textContent = state.result.failure ? reasons[state.result.failure] : (delivered ? '货物已交付，机器人已到达终点。' : '已到达终点；未交付货物，本局运输分为0。');
    this.element('result-delivery').textContent = delivered ? `${cargoMassKg} kg 已交付` : `${deliveredCount}/${targets.length} 件已交付`;
    this.element('result-finish').textContent = state.completedObjectiveIds.includes(this.finishObjective.id) ? `已到达 ${this.finishObjective.xM} m` : '尚未到达';
    this.element('result-metrics').textContent = `${state.elapsedSeconds.toFixed(1)} s / ${state.energyRemainingUnits.toFixed(1)}`;
    this.element('challenge-result').hidden = !state.challenge;
    this.element('record-status').textContent = this.recordMessage;
    this.root.querySelector<HTMLButtonElement>('[data-action="retry-score"]')!.hidden=state?.phase!=='succeeded' || !!state.challenge?.testMode;
    if (state.challenge && state.result.score) {
      const c = state.challenge, score = state.result.score;
      this.element('challenge-result').innerHTML = '<div class="result-row"><span>预算 / 配置成本 / 剩余</span><strong>'+c.budget+' / '+c.configurationCost+' / '+c.remainingBudget+'</strong></div>'
        +(c.testMode ? '<p>测试模式，不计正式成绩</p>' : [
          ['时间分',score.timeBonus,SCORE_WEIGHTS.time], ['电量分',score.energyBonus,SCORE_WEIGHTS.energy],
          ['运输分',score.cargoBonus,SCORE_WEIGHTS.cargo], ['预算分',score.budgetBonus,SCORE_WEIGHTS.budget]
        ].map(([label,value,max])=>'<div class="result-row"><span>'+label+'</span><strong>'+value+' / '+max+'</strong></div>').join('')
        +'<div class="result-row score-total"><span>总分</span><strong>'+score.formalScore+'</strong></div>');
    }
  }

  private refresh(): void {
    const finish = this.finishObjective;
    const rules = this.mission.configurationRules;
    
    this.element('mission-mode').textContent = '时间 · 电量 · 运输 · 预算';
    this.element('mission-title').textContent = this.mission.name;
    this.element('mission-description').textContent = `${TEST_MODE ? '不限时。' : `${this.mission.hardLimits.maxTimeSeconds} 秒内完成。`}${this.mission.description}`;
    const stops = [
      ...this.mission.environment!.sections.map(s=>({ position:s.kind==='charger'?(s.startM+s.endM)/2:s.startM, label:s.label })),
      ...this.mission.layout.map(i=>({ position:i.xM, label:i.kind==='cargo'?i.cargo.massKg+'kg货物':'交付' })),
      { position:finish.xM, label:'终点' }
    ].sort((a,b)=>a.position-b.position);
    this.element('mission-route').innerHTML = stops.map(s=>'<div><b>'+s.position+' m</b><span>'+s.label+'</span></div>').join('');
    this.element('mission-note').textContent = '沙地不可绕行，履带减速最小。拱桥仅四足可直行；岔路停稳选择旁路。货物与充能站均在中途，碎料箱停稳清理。完成交付可得运输分，空载也可抵达终点。';
    this.element('terrain-caption').textContent = `${finish.xM} m / TRANSPORT YARD`;
    const selection = this.configuration[this.category];
    this.element('module-cards').innerHTML = (this.category === 'accessory' ? '<button class="module-card" data-module="none">不安装附件</button>' : '') + DISPLAY_MODULES.filter(module => module.category === this.category).map(module => `<button class="module-card" data-module="${module.id}" aria-pressed="${selection === module.id}" ${this.controller ? 'disabled' : ''}><span class="module-card-top"><strong>${module.name}</strong><span>${selection === module.id ? '已装配' : '装配'}</span></span><span class="module-description">${module.description}</span><span class="module-card-stats">${module.massKg} kg <i>·</i> ${TEST_MODE ? '免费测试' : `${module.cost} 点`}</span></button>`).join('');
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-category]')) button.setAttribute('aria-pressed', String(button.dataset.category === this.category));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('nav [data-page]')) {
      button.setAttribute('aria-current', button.dataset.page === this.page ? 'page' : 'false');
      button.disabled = button.dataset.page === 'result' && !this.controller?.state.result;
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action="recommended"],[data-action="import"],.camera-controls button')) button.disabled = !!this.controller;
    const validation = validateConfiguration(this.configuration, PREVIEW_MODULES, rules);
    const summary = validation.summary;
    const challenge = this.mission.challenge;
    this.element('budget-summary').hidden = !challenge;
    this.element('best-score').hidden = !challenge || TEST_MODE;
    if (challenge) {
      const cost = MODULE_CATEGORIES.reduce((sum,c)=>sum+(NORMAL_MODULES.find(m=>m.id===this.configuration[c])?.cost ?? 0),0);
      this.element('budget-summary').textContent = TEST_MODE ? '测试模式 · 预算 '+challenge.budget+' · 配置原价 '+cost+' · 不计正式成绩'
        : '预算 '+challenge.budget+' · 已用 '+cost+' · 剩余 '+(challenge.budget-cost);
      this.element('budget-summary').dataset.over = String(!TEST_MODE && cost>challenge.budget);
      try { const best=readBestScore(this.nicknameScores.storage(),this.mission.id,challenge);this.element('best-score').textContent=best===null?'尚无正式成绩':'最高分 '+best; }
      catch {this.element('best-score').textContent='本地成绩不可读取';}
    }

    (this.element('start-session') as HTMLButtonElement).disabled = !validation.valid || !!this.controller;
    this.element('start-session').textContent = this.controller ? '驾驶中' : '开始驾驶 →';
    this.element('metrics').innerHTML = [['总质量', summary?.massKg, TEST_MODE ? 'kg' : `/ ${rules.maxMassKg} kg`], ...(!challenge ? [['预算', summary?.cost, TEST_MODE ? '无限额' : `/ ${rules.maxCost ?? '不限'}`]] : []), ['能源容量', summary?.batteryCapacityUnits, '单位'], ['有效载重', TEST_MODE ? '不限' : summary?.payloadKg, TEST_MODE ? '' : 'kg']].map(([name, value, unit]) => `<div><span>${name}</span><strong>${value ?? '—'} <small>${unit}</small></strong></div>`).join('');
    this.element('validation').className = validation.valid ? 'validation valid' : 'validation invalid';
    this.element('validation').innerHTML = validation.valid ? (TEST_MODE ? '<strong>可出发</strong>' : '<strong>可出发</strong>') : `<strong>配置需要调整</strong>${validation.issues.map(issue => `<span>${issue.message}</span>`).join('')}`;
    this.element('selected-summary').innerHTML = MODULE_CATEGORIES.map(category => `<span><small>${CATEGORY_NAMES[category]}</small>${DISPLAY_MODULES.find(module => module.id === this.configuration[category])?.name ?? (category === 'accessory' ? '无' : '未装配')}</span>`).join('');
    this.element('view-title').textContent = this.page === 'configuration' ? '机器人' : this.page === 'result' ? `${this.mission.name} · 结算` : this.controller ? this.mission.name : `${this.mission.name} · 场景预览`;
    this.element('view-caption').textContent = '';
    this.root.dataset.page = this.page;
    this.root.dataset.playing = String(!!this.controller);
    this.refreshSession();
  }
}
