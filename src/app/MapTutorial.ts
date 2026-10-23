import { TRANSPORT_MISSION } from '../content/challenges';
import { SCORE_WEIGHTS } from '../domain/mission/scoring';
import { MODULES } from '../content/modules';

const SEEN_KEY = 'robot_lab_map_tutorial_v1';
const mission = TRANSPORT_MISSION;
const section = (id: string) => mission.environment!.sections.find(s => s.id === id)!;
const cargo = mission.layout.find(item => item.kind === 'cargo')!;
const delivery = mission.layout.find(item => item.kind === 'deliveryZone')!;
const finish = mission.objectives.find(item => item.kind === 'reach')!;
const finishM = finish.kind === 'reach' ? finish.xM : 100;
const steps = [
  { name: '组装出发', x: mission.spawnXM, title: '先选底盘，再决定路线', text: `在 ${mission.challenge!.budget} 点预算内组装机器人。先选底盘，再搭配电机、电池和搬运工具；查看性能与配置提示后出发。`, tip: '轮式适合平地；履带擅长沙地；四足可以直接翻桥。', action: '点选下方底盘，看看它适合哪条路线。' },
  { name: '必经沙地', x: section('sand').startM, title: '沙地没有旁路，稳稳穿过去', text: '所有底盘进入沙地都会减速。履带减速最小；四足轻微减速，比轮式更快。', tip: '不用寻找绕行按钮，保持前进即可。给后半程留足时间和电量。', action: '图中为减速程度示意，不代表实际速度比例。' },
  { name: '装载货物', x: cargo.xM, title: '在货物旁停稳，点击交互装载', text: '靠近货物后，界面会出现装载提示。先刹车停稳，再点击“交互·装载”；搬运工具需要能够承载货物。', tip: `运输是可选目标，但成功交付可获得 ${SCORE_WEIGHTS.cargo} 分。载货后注意稳定，避免急停急转。`, action: '停稳 → 点击“交互·装载”（电脑按 E）→ 等待装载完成。' },
  { name: '中途充能', x: section('charger').startM, title: '到充能点，按需补充电量', text: '关注能源条。进入充能区后停稳，点击“交互·充能”（电脑按 E）开始充能；补充电量也会消耗任务时间。', tip: '电量会影响续航和最终得分，按需停靠一次，充能过程持续 5 秒。', action: '靠近充能桩 → 刹车停稳 → 交互充能 → 等待完成。' },
  { name: '桥与旁路', x: section('bridge').startM, title: '四足走拱桥，轮式和履带走旁路', text: '到分岔提示处选择路线。四足搭配任意电机都能高效翻桥；轮式和履带应选择平地旁路。', tip: '错过路口可以倒车回来，前进和后退进入检测区都会出现选路提示。', action: '切换底盘，观察高亮路线。旁路更长，但没有桥面起伏。' },
  { name: '清理大箱', x: section('debris').startM, title: '路上只有一个大箱，需要清开', text: '靠近大碎料箱后停稳，点击“交互·清障”（电脑按 E），等待作业完成，再继续前进。这里无法绕行。', tip: '提前装上前铲可以更快清障，但也会占用预算和增加重量。', action: '停在大箱前 → 交互清障 → 等待大箱移出路线。' },
  { name: '交付与终点', x: delivery.xM, title: '卸货之后，还要继续到终点', text: `在卸货区停稳，点击“交互·卸货”交付货物，再前进至 ${finishM} m 终点。必须在 ${mission.hardLimits.maxTimeSeconds} 秒内成功抵达，才会计算正式分数。`, tip: `剩余时间 ${SCORE_WEIGHTS.time} 分 · 剩余电量 ${SCORE_WEIGHTS.energy} 分 · 货物交付 ${SCORE_WEIGHTS.cargo} 分 · 剩余预算 ${SCORE_WEIGHTS.budget} 分。`, action: '电脑：A / D 或方向键行驶，空格刹车、E 交互；手机：使用前进、后退、刹车与交互按钮。' },
];
const robot = (x: number, y: number, legs = false) => `<g transform="translate(${x} ${y})"><rect x="-27" y="-29" width="54" height="25" rx="6" fill="#173e51" stroke="#79e3ea" stroke-width="3"/><path d="M-12-30v-10h24v10" fill="none" stroke="#79e3ea" stroke-width="3"/>${legs ? '<path d="M-20-4l-14 15 8 9M20-4l14 15-8 9" fill="none" stroke="#79e3ea" stroke-width="5"/>' : '<circle cx="-18" cy="0" r="9" fill="#0b1927" stroke="#79e3ea" stroke-width="4"/><circle cx="18" cy="0" r="9" fill="#0b1927" stroke="#79e3ea" stroke-width="4"/>'}</g>`;
const box = (x: number, y: number, size = 36) => `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="3" fill="#765438" stroke="#ffcb8a" stroke-width="3"/><path d="M0 0l${size} ${size}M${size} 0L0 ${size}" stroke="#ffcb8a" stroke-width="2"/></g>`;
const label = (x: number, y: number, text: string) => `<text x="${x}" y="${y}" text-anchor="middle" fill="#cde4ee" font-size="17">${text}</text>`;

/** A visual route briefing after nickname entry; never starts or mutates a run. */
export class MapTutorial {
  private readonly dialog = document.createElement('dialog');
  private readonly abort = new AbortController();
  private index = 0;
  private chassis = 'chassis_quadruped';
  private completed = false;
  constructor(private readonly root: HTMLElement) {
    try { this.completed = localStorage.getItem(SEEN_KEY) === 'done'; } catch { /* Session-only completion still works. */ }
    this.dialog.id = 'map-tutorial';
    this.dialog.className = 'tutorial-dialog';
    this.dialog.setAttribute('aria-labelledby', 'tutorial-heading');
    root.append(this.dialog);
    this.dialog.addEventListener('cancel', event => { if (!this.completed) event.preventDefault(); });
    this.dialog.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.tutorialStep !== undefined) this.show(Number(button.dataset.tutorialStep));
      if (button.dataset.tutorialChassis) { this.chassis = button.dataset.tutorialChassis; this.render(); }
      if (button.id === 'tutorial-prev') this.show(this.index - 1);
      if (button.id === 'tutorial-next') {
        if (this.index < steps.length - 1) this.show(this.index + 1);
        else {
          this.completed = true;
          try { localStorage.setItem(SEEN_KEY, 'done'); } catch { /* Do not block entry if storage is disabled. */ }
          this.dialog.close();
          const target = this.root.querySelector<HTMLButtonElement>('[data-category="chassis"]');
          target?.focus(); target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }, { signal: this.abort.signal });
    window.addEventListener('resize', () => this.viewport(), { signal: this.abort.signal });
    window.visualViewport?.addEventListener('resize', () => this.viewport(), { signal: this.abort.signal });
    window.visualViewport?.addEventListener('scroll', () => this.viewport(), { signal: this.abort.signal });
  }
  openIfNeeded() { if (!this.completed) this.open(); }
  open() { if (this.dialog.open) return; this.index = 0; this.render(); this.viewport(); this.dialog.showModal(); this.focusHeading(); }
  dispose() { this.abort.abort(); this.dialog.remove(); }
  private viewport() {
    const v = window.visualViewport;
    this.dialog.style.setProperty('--tutorial-height', `${v?.height ?? innerHeight}px`);
    this.dialog.style.setProperty('--tutorial-top', `${v?.offsetTop ?? 0}px`);
  }
  private focusHeading() { this.dialog.querySelector<HTMLElement>('#tutorial-heading')?.focus({ preventScroll: true }); }
  private show(index: number) { this.index = Math.max(0, Math.min(steps.length - 1, index)); this.render(); this.focusHeading(); }
  private routeMap() {
    const x = (m: number) => 28 + (m - mission.spawnXM) / (finishM - mission.spawnXM) * 504;
    const sand = section('sand'), bridge = section('bridge');
    return `<svg viewBox="0 0 560 74" role="img" aria-label="地图流程，当前步骤：${steps[this.index].name}"><path d="M28 34H532" stroke="#34566c" stroke-width="9" fill="none"/><path d="M${x(sand.startM)} 34H${x(sand.endM)}" stroke="#d6ad71" stroke-width="13"/><path d="M${x(bridge.startM)} 34Q${x((bridge.startM + bridge.endM) / 2)} 0 ${x(bridge.endM)} 34" fill="none" stroke="#79e3ea" stroke-width="5"/>${steps.map((step, i) => `<circle cx="${x(step.x)}" cy="34" r="${i === this.index ? 12 : 7}" fill="${i === this.index ? '#79e3ea' : '#142d40'}" stroke="#79e3ea" stroke-width="2"/>`).join('')}${label(28, 68, '起点')}${label(532, 68, '终点')}</svg>`;
  }
  private illustration() {
    const active = '#79e3ea', muted = '#34566c', legs = this.chassis === 'chassis_quadruped';
    let content = '';
    switch (this.index) {
      case 0: content = `${robot(100, 100)}${robot(280, 100)}<rect x="243" y="92" width="74" height="22" rx="11" fill="none" stroke="${active}" stroke-width="4"/>${robot(460, 95, true)}${label(100, 160, '轮式 · 平地快')}${label(280, 160, '履带 · 善走沙地')}${label(460, 160, '四足 · 可翻桥')}`; break;
      case 1: content = `<rect x="20" y="55" width="520" height="88" rx="16" fill="#564735"/>${Array.from({ length: 26 }, (_, i) => `<circle cx="${30 + i * 20}" cy="${70 + (i % 3) * 23}" r="2" fill="#d6ad71"/>`).join('')}${robot(100, 100)}${robot(280, 100)}<rect x="243" y="92" width="74" height="22" rx="11" fill="none" stroke="${active}" stroke-width="4"/>${robot(460, 95, true)}${label(100, 180, '减速明显')}${label(280, 180, '减速最小')}${label(460, 180, '轻微减速')}`; break;
      case 2: content = `<path d="M30 142H530" stroke="${muted}" stroke-width="4"/>${robot(340, 130)}${box(125, 104)}<path d="M180 90Q250 20 310 55" stroke="${active}" stroke-width="3" stroke-dasharray="8 6" fill="none"/>${label(280, 185, '停稳 → 交互装载 → 继续运输')}`; break;
      case 3: content = `<rect x="95" y="45" width="60" height="105" rx="10" fill="#173e51" stroke="${active}" stroke-width="3"/><path d="M131 60l-18 29h20l-18 29" stroke="#f4d681" fill="none" stroke-width="5"/><path d="M155 100Q210 80 230 130" stroke="${active}" stroke-width="4" fill="none"/>${robot(258, 132)}<rect x="352" y="62" width="145" height="52" rx="8" fill="none" stroke="${active}" stroke-width="3"/><rect x="359" y="69" width="88" height="38" rx="3" fill="${active}"/>${label(280, 184, '停稳 → 交互充能 → 等待 5 秒')}`; break;
      case 4: content = `<path d="M28 125H118Q280 -35 442 125H532" fill="none" stroke="${legs ? active : muted}" stroke-width="8"/><path d="M118 125Q150 176 215 176H350Q415 176 442 125" fill="none" stroke="${legs ? muted : active}" stroke-width="8"/>${robot(legs ? 280 : 285, legs ? 53 : 164, legs)}${label(110, 25, '四足直行拱桥')}${label(280, 219, '轮式 / 履带走平地旁路')}`; break;
      case 5: content = `<path d="M30 150H530" stroke="${muted}" stroke-width="4"/>${robot(190, 138)}<path d="M220 125l32 17v-34" fill="none" stroke="${active}" stroke-width="5"/>${box(310, 91, 56)}${label(280, 192, '交互清障 · 选装前铲可以加快清理')}`; break;
      case 6: content = `<path d="M25 145H535" stroke="${muted}" stroke-width="5"/><rect x="52" y="146" width="170" height="18" rx="4" fill="${active}"/>${box(70, 108)}${robot(320, 131)}<path d="M420 145V38h68v45h-68" fill="#173e51" stroke="${active}" stroke-width="4"/><path d="M430 47h20v14h20v14h-20V61h-20" fill="${active}"/>${label(137, 198, `${delivery.xM} m 卸货`)}${label(454, 198, `${finishM} m 终点`)}<path d="M250 69h100m-18-12 18 12-18 12" stroke="${active}" stroke-width="4" fill="none"/>`; break;
    }
    return `<svg viewBox="0 0 560 240" role="img" aria-label="${steps[this.index].title}">${content}</svg>`;
  }
  private render() {
    const step = steps[this.index];
    const oldFocus = (document.activeElement as HTMLElement | null)?.id;
    this.dialog.dataset.step = String(this.index);
    const choices = [0, 4].includes(this.index) ? `<div class="tutorial-choices" role="group" aria-label="选择底盘查看路线">${MODULES.filter(m => m.category === 'chassis').map(m => `<button id="tutorial-${m.id}" data-tutorial-chassis="${m.id}" aria-pressed="${m.id === this.chassis}">${m.name}</button>`).join('')}</div><p class="tutorial-feedback" role="status">${MODULES.find(m => m.id === this.chassis)!.description}</p>` : '';
    this.dialog.innerHTML = `<header class="tutorial-header"><p class="eyebrow">ROBOT LAB / 新手路线引导</p><span aria-label="第${this.index + 1}步，共${steps.length}步">${String(this.index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}</span></header>
      <div class="tutorial-body"><nav class="tutorial-stops" aria-label="教学步骤">${steps.map((s, i) => `<button data-tutorial-step="${i}" ${i === this.index ? 'aria-current="step"' : ''}>${i + 1}. ${s.name}</button>`).join('')}</nav><div class="tutorial-map">${this.routeMap()}</div><h2 id="tutorial-heading" tabindex="-1">${step.title}</h2><p class="tutorial-description">${step.text}</p><figure class="tutorial-figure">${this.illustration()}<figcaption>${step.action}</figcaption></figure>${choices}<p class="tutorial-tip"><strong>应对方法</strong>${step.tip}</p></div>
      <footer class="tutorial-footer"><button id="tutorial-prev" ${this.index === 0 ? 'disabled' : ''}>上一步</button><span>图文引导 · 不计时</span><button id="tutorial-next" class="primary">${this.index === steps.length - 1 ? '完成教学，去组装' : '下一步 →'}</button></footer>`;
    if (oldFocus) this.dialog.querySelector<HTMLElement>(`#${oldFocus}`)?.focus({ preventScroll: true });
  }
}
