import { normalizeNickname } from '../domain/identity/nickname';
import { challengePerformance, type SessionState } from '../domain/mission/session';
import type { ConfigurationStorage } from './PreviewSave';
const NAME_KEY = 'robot_lab_nickname_v1', QUEUE_KEY = 'robot_lab_pending_scores_v1';
interface Submission { nickname: string; sessionId: string; rulesVersion: string; testMode: false; outcome: 'succeeded'; score: number; configuration: SessionState['configuration']; performance: ReturnType<typeof challengePerformance> }
export class NicknameScores {
  nickname = '';
  private queue: Submission[] = [];
  private flushing: Promise<string> | null = null;
  private readonly dialog = document.createElement('dialog');
  private readonly button: HTMLButtonElement;
  private readonly abort = new AbortController();
  constructor(root: HTMLElement) {
    try { this.nickname = normalizeNickname(localStorage.getItem(NAME_KEY)).nickname; } catch { /* First visit. */ }
    try {
      const pending: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
      if (Array.isArray(pending)) this.queue = pending.filter(p => p && typeof p.sessionId === 'string' && typeof p.nickname === 'string').slice(-100);
    } catch { /* Ignore invalid local drafts. */ }
    this.button = root.querySelector<HTMLButtonElement>('#nickname-button')!;
    this.dialog.className = 'nickname-dialog';
    this.dialog.innerHTML = `<form id="nickname-form"><div class="nickname-body"><p class="eyebrow">ROBOT LAB / PLAYER</p><h2 id="nickname-title">输入你的昵称</h2><p class="muted">成绩以昵称保存，同一昵称只保留最高分。</p><label for="nickname-input">昵称（1–20 个字）</label><input id="nickname-input" name="nickname" autocomplete="nickname" enterkeyhint="go" aria-describedby="nickname-error" maxlength="40" required><p class="muted">不需要账号或密码。昵称不是独占的，请避免和别人重名。</p><p id="nickname-error" role="alert"></p></div><div class="nickname-actions"><button type="submit" class="primary">进入实验室</button></div></form>`;
    this.dialog.setAttribute('aria-labelledby', 'nickname-title');
    root.append(this.dialog);
    const input = this.dialog.querySelector<HTMLInputElement>('input')!;
    const submit = this.dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    // Keep the keyboard open until click submits: blur can move the button before release.
    const keepInputFocus = (event: MouseEvent | PointerEvent) => {
      if (event.button === 0 && document.activeElement === input) event.preventDefault();
    };
    submit.addEventListener('pointerdown', keepInputFocus, { signal: this.abort.signal });
    submit.addEventListener('mousedown', keepInputFocus, { signal: this.abort.signal });
    window.addEventListener('resize', () => this.updateViewport(), { signal: this.abort.signal });
    window.visualViewport?.addEventListener('resize', () => this.updateViewport(), { signal: this.abort.signal });
    window.visualViewport?.addEventListener('scroll', () => this.updateViewport(), { signal: this.abort.signal });
    this.button.addEventListener('click', () => this.open(), {signal:this.abort.signal});
    this.dialog.addEventListener('cancel', e => { if (!this.nickname) e.preventDefault(); });
    this.dialog.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      try {
        this.nickname = normalizeNickname(this.dialog.querySelector<HTMLInputElement>('input')!.value).nickname;
        try { localStorage.setItem(NAME_KEY, this.nickname); } catch { /* Works for current page even without storage. */ }
        this.update(false); this.dialog.close();
        root.dispatchEvent(new CustomEvent('nicknamechange'));
      } catch (error) { this.dialog.querySelector('#nickname-error')!.textContent=(error as Error).message; }
    });
    this.update(false);
    if (!this.nickname) this.open();
    window.addEventListener('online', () => { void this.flush(); }, {signal:this.abort.signal});
    void this.flush();
  }
  open() { this.dialog.querySelector<HTMLInputElement>('input')!.value=this.nickname; this.dialog.querySelector('#nickname-error')!.textContent=''; if (!this.dialog.open) { this.updateViewport(); this.dialog.showModal(); this.updateViewport(); } }
  private updateViewport() {
    const viewport = window.visualViewport;
    this.dialog.style.setProperty('--nickname-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    this.dialog.style.setProperty('--nickname-viewport-top', `${viewport?.offsetTop ?? 0}px`);
  }
  update(running: boolean) { this.button.textContent=this.nickname ? this.nickname+' · 更换' : '输入昵称'; this.button.disabled=running; }
  storage(): ConfigurationStorage {
    const prefix='nickname:'+normalizeNickname(this.nickname).key+':';
    return {getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value)};
  }
  async submit(state: SessionState, nickname: string): Promise<string> {
    if (state.phase!=='succeeded' || state.challenge?.testMode || state.result?.score?.formalScore==null) return '';
    const run: Submission={nickname,sessionId:state.sessionId,rulesVersion:state.challenge!.rulesVersion,testMode:false,outcome:'succeeded',
      score:state.result.score.formalScore,configuration:state.configuration,performance:challengePerformance(state)};
    if (!this.queue.some(p=>p.sessionId===run.sessionId)) this.queue.push(run);
    const durable=this.saveQueue();
    const message=await this.flush();
    if (this.queue.some(p=>p.sessionId===run.sessionId)) return durable ? '成绩已暂存在本机，网络恢复后自动重试。也可点击重试保存。' : '成绩尚未上传，请保持页面打开并重试保存。';
    return message;
  }
  private saveQueue() { try {localStorage.setItem(QUEUE_KEY,JSON.stringify(this.queue));return true;}catch{return false;} }
  flush(): Promise<string> {
    if (this.flushing) return this.flushing;
    this.flushing=this.sendQueue().finally(()=>{this.flushing=null;}); return this.flushing;
  }
  private async sendQueue(): Promise<string> {
    let message='成绩已保存，同一昵称仅保留最高分。';
    while(this.queue.length) {
      const run=this.queue[0];
      try {
        const response=await fetch('/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(run),signal:AbortSignal.timeout(10000)});
        const result=await response.json();
        if(!response.ok) { if([400,409,413,415].includes(response.status)){this.queue.shift();this.saveQueue();message='成绩未通过校验：'+(result.error??'请重新挑战');continue;}return '保存暂不可用，请重试保存。'; }
        message=result.status==='unchanged' ? '本次未超过该昵称最高分（'+result.bestScore+'）。' : '成绩已保存，同一昵称仅保留最高分。';
        this.queue.shift();this.saveQueue();
      } catch { return '成绩待上传，请重试保存。'; }
    }
    return message;
  }
  dispose() {this.abort.abort();this.dialog.remove();}
}
