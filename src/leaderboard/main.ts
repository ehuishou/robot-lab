import '../ui/preview.css';
import './style.css';
interface Entry {id:string;rank:number;nickname:string;score:number;manual:boolean;achievedAt:string;performance:{elapsedSeconds:number;energyRemainingUnits:number;cargoDelivered:boolean};}
interface Board {revision:number;rulesVersion:string;entries:Entry[];}
const root=document.querySelector<HTMLDivElement>('#leaderboard-app')!;
root.innerHTML=`<header class="topbar"><div class="brand"><span class="brand-mark">RL</span><span>ROBOT LAB</span></div><span class="muted">SCORE ARCHIVE</span></header><main><section class="board-intro"><div><p class="eyebrow">TRANSPORT CHALLENGE</p><h1>成绩排行</h1><p class="muted">每个昵称，只留下最高分。</p></div><div class="board-actions"><button id="refresh">刷新</button><button id="manage">成绩管理</button><button id="logout" hidden>退出管理</button></div></section><p id="board-status" role="status" class="muted">正在读取成绩…</p><section class="panel board-panel"><div class="board-head"><span>排名 / 昵称</span><span>最高得分</span><span>挑战记录</span></div><div id="entries"></div></section><p class="muted board-note">总分 5000 · 时间 1000 / 能量 1000 / 运货 2000 / 预算 1000<br>同分时，较早获得该成绩者排在前面。</p></main><footer class="preview-footer"><span class="muted">ROBOT LAB / 运输与能效</span><span id="board-version" class="muted"></span></footer><dialog id="admin-dialog" class="board-dialog"><form id="admin-form"><p class="eyebrow">ADMIN ACCESS</p><h2>成绩管理</h2><label for="admin-password">管理密码</label><input id="admin-password" type="password" autocomplete="current-password" required><p id="admin-error" role="alert"></p><div class="dialog-actions"><button type="button" data-close>取消</button><button class="primary" type="submit">登录</button></div></form></dialog><dialog id="edit-dialog" class="board-dialog"><form id="edit-form"><h2>修改成绩</h2><label for="edit-nickname">昵称</label><input id="edit-nickname" maxlength="40" required><label for="edit-score">分数（0–5000）</label><input id="edit-score" type="number" min="0" max="5000" step="1" required><p id="edit-error" role="alert"></p><div class="dialog-actions"><button type="button" data-close>取消</button><button class="primary" type="submit">保存修改</button></div></form></dialog><dialog id="delete-dialog" class="board-dialog"><form id="delete-form"><h2>删除成绩</h2><p id="delete-description"></p><p id="delete-error" role="alert"></p><div class="dialog-actions"><button type="button" data-close>取消</button><button class="danger" type="submit">确认删除</button></div></form></dialog>`;
let board:Board={revision:0,rulesVersion:'',entries:[]},authenticated=false,editing:Entry|null=null,editRevision=0,loading=false;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
class ApiError extends Error {constructor(readonly status:number,message:string){super(message);}}
async function api(path:string,method='GET',data?:unknown){
 const response=await fetch('/api/'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
 const value=await response.json();if(!response.ok)throw new ApiError(response.status,value.error??'请求失败');return value;
}
function status(message:string){el('board-status').textContent=message;}
function render(){
 el('manage').hidden=authenticated;el('logout').hidden=!authenticated;
 el('board-version').textContent=board.rulesVersion;
 const list=el('entries');list.replaceChildren();
 if(!board.entries.length){const empty=document.createElement('p');empty.className='empty-board';empty.textContent='等待第一份挑战成绩';list.append(empty);}
 for(const entry of board.entries){
  const row=document.createElement('article');row.className='board-row';row.dataset.id=entry.id;
  const identity=document.createElement('div');identity.className='board-identity';
  const rank=document.createElement('span');rank.className='rank';rank.textContent=String(entry.rank).padStart(2,'0');
  const name=document.createElement('strong');name.textContent=entry.nickname;identity.append(rank,name);
  const score=document.createElement('strong');score.className='board-score';score.textContent=String(entry.score);
  const metrics=document.createElement('div');metrics.className='board-metrics';
  const text=document.createElement('span');text.textContent=entry.manual?'管理员修订成绩':`${entry.performance.elapsedSeconds.toFixed(1)} s · 余能 ${entry.performance.energyRemainingUnits.toFixed(1)} · ${entry.performance.cargoDelivered?'已运货':'未运货'}`;
  const time=document.createElement('small');time.textContent=new Date(entry.achievedAt).toLocaleString('zh-CN',{hour12:false});metrics.append(text,time);
  row.append(identity,score,metrics);
  if(authenticated){const actions=document.createElement('div');actions.className='row-actions';for(const [action,label] of [['edit','修改'],['delete','删除']]){const button=document.createElement('button');button.textContent=label;button.dataset.action=action;button.dataset.id=entry.id;actions.append(button);}row.append(actions);}
  list.append(row);
 }
}
async function refresh(){
 if(loading)return;loading=true;el<HTMLButtonElement>('refresh').disabled=true;
 try{const [next,session]=await Promise.all([api('leaderboard'),api('admin/session')]);board=next;authenticated=session.authenticated;render();status(`${board.entries.length} 个昵称的最高成绩${authenticated?' · 管理模式':''}`);}
 catch(error){status('读取失败，点击刷新重试。'+(error as Error).message);}
 finally{loading=false;el<HTMLButtonElement>('refresh').disabled=false;document.documentElement.dataset.leaderboardState='ready';}
}
el('refresh').onclick=()=>void refresh();
el('manage').onclick=()=>{el('admin-error').textContent='';el<HTMLInputElement>('admin-password').value='';el<HTMLDialogElement>('admin-dialog').showModal();};
el('logout').onclick=()=>void api('admin/logout','POST',{}).then(()=>{authenticated=false;render();status('已退出管理');}).catch(error=>status(error.message));
root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog')!.close());
function bindForm(id:string,action:()=>Promise<void>,errorId:string){el<HTMLFormElement>(id).onsubmit=event=>{event.preventDefault();const button=el(id).querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;el(errorId).textContent='';void action().catch(async error=>{el(errorId).textContent=error.message;if(error instanceof ApiError && error.status===409){await refresh();}if(error instanceof ApiError && error.status===401){authenticated=false;render();}}).finally(()=>button.disabled=false);};}
bindForm('admin-form',async()=>{await api('admin/login','POST',{password:el<HTMLInputElement>('admin-password').value});el<HTMLInputElement>('admin-password').value='';el<HTMLDialogElement>('admin-dialog').close();await refresh();},'admin-error');
el('entries').onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');if(!button)return;editing=board.entries.find(e=>e.id===button.dataset.id)??null;if(!editing)return;editRevision=board.revision;
 if(button.dataset.action==='edit'){el<HTMLInputElement>('edit-nickname').value=editing.nickname;el<HTMLInputElement>('edit-score').value=String(editing.score);el('edit-error').textContent='';el<HTMLDialogElement>('edit-dialog').showModal();}
 else{el('delete-description').textContent='确定删除“'+editing.nickname+'”的成绩？此操作不可撤销。';el('delete-error').textContent='';el<HTMLDialogElement>('delete-dialog').showModal();}
};
bindForm('edit-form',async()=>{if(!editing)return;await api('admin/entries/'+editing.id,'PATCH',{revision:editRevision,nickname:el<HTMLInputElement>('edit-nickname').value,score:Number(el<HTMLInputElement>('edit-score').value)});el<HTMLDialogElement>('edit-dialog').close();await refresh();},'edit-error');
bindForm('delete-form',async()=>{if(!editing)return;await api('admin/entries/'+editing.id,'DELETE',{revision:editRevision});el<HTMLDialogElement>('delete-dialog').close();await refresh();},'delete-error');
void refresh();
