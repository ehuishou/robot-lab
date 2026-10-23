import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
const delay = ms => new Promise(done => setTimeout(done, ms));
const evidence = resolve('docs/evidence/single-map', process.argv.some(arg => arg.startsWith('http')) ? 'browser-deployed' : 'browser');
mkdirSync(evidence, { recursive: true });
let browser, socket, server, seq = 0;
const pending = new Map();
const report = { cases: [], exceptions: [], base: '' };
async function until(fn, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('Condition timed out');
}
function send(method, params = {}) {
  return new Promise((done, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 20000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails)); return value.result.value;
}
const diagnostics = () => evaluate('window.robotLabPreview?.diagnostics');
const click = selector => evaluate('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');if(!el||el.disabled)throw new Error("Unavailable button");el.click();return true})()');
async function preview(url) {
  await send('Page.navigate', { url });
  await until(async () => {
    const state = await evaluate('document.documentElement.dataset.previewState');
    assert.notEqual(state, 'error', await evaluate('document.getElementById("preview-error")?.textContent'));
    return state === 'ready';
  });
  await evaluate(`(()=>{if(document.querySelector('.nickname-dialog')?.open){document.querySelector('#nickname-input').value='QA-browser';document.querySelector('#nickname-form').requestSubmit();}for(let i=0;i<7&&document.querySelector('#map-tutorial')?.open;i++)document.querySelector('#tutorial-next').click();return true})()`);
}
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
}
function pass(name) { console.log('PASS ' + name); report.cases.push(name); }
try {
  let base = process.argv.slice(2).find(arg => arg.startsWith('http')); 
  if (!base) {
    const root = resolve('dist');
    server = createServer((req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + sep) || !existsSync(path)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream' });
      res.end(readFileSync(path));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done)); base = 'http://127.0.0.1:' + server.address().port;
  }
  report.base = base.replace(/\/$/, '');
  const profile = mkdtempSync(resolve(tmpdir(), 'robot-test-mode-'));
  browser = spawn(process.env.ROBOT_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1366,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => report.browserError = error.message);
  await until(() => { assert.ok(!report.browserError, report.browserError); return existsSync(resolve(profile, 'DevToolsActivePort')); });
  const port = readFileSync(resolve(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id); pending.delete(message.id); clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.done(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails);
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });


  const key=(key,down)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code:key===' '?'Space':'Key'+key.toUpperCase()});
  let held=null;
  async function hold(action){if(action===held)return;if(held)await key(held,false);held=action;if(action)await key(action,true);}
  async function go(target){const deadline=Date.now()+90000;while(Date.now()<deadline){
    const s=(await diagnostics()).session;if(target===100&&s.phase==='succeeded'){await hold(null);return;}
    assert.equal(s.phase,'running',JSON.stringify(s.result));
    const d=target-s.xM,v=s.speedMps;
    if(target!==100&&Math.abs(d)<.35&&Math.abs(v)<.12){await hold(null);return;}
    const brake=target!==100&&(Math.abs(d)<v*v/7+.2 || d*v<-.1);
    await hold(brake?' ':d>=0?'d':'a');await delay(70);
  }throw Error('driving timeout '+target);}
  async function work(){await click('[data-action="work"]');await until(async()=>!(await diagnostics()).session.environment.work);}
  async function interact(){await key('e',true);await delay(80);await key('e',false);await until(async()=>!(await diagnostics()).session.environment.work);}
  async function shot(name){await hold(null);await delay(350);await screenshot(name);}
  await preview(report.base+'/');report.buildId=(await diagnostics()).buildId;
  assert.equal((await diagnostics()).missionId,'transport-yard');assert.equal((await diagnostics()).testMode,false);
  assert.equal(await evaluate('document.querySelectorAll("[data-mission]").length'),0);
  assert.equal(await evaluate('document.body.innerText.includes("\u96be\u5ea6\u9009\u62e9")'),false);
  await shot('desktop-configuration');pass('single map at root, normal by default, no difficulty picker');
  await preview(report.base+'/preview.html?sample=1');assert.equal((await diagnostics()).missionId,'transport-yard');pass('legacy sample query cannot open another map');
  await click('[data-module="chassis_quadruped"]');await click('[data-category="motor"]');await click('[data-module="motor_low"]');
  assert.equal((await diagnostics()).validation.valid,true);
  await click('[data-action="start"]');await go(24);await shot('desktop-sand');
  assert.equal(await evaluate('document.querySelector("[data-action=route-bypass]").hidden'),true);
  await go(38);await interact();assert.equal((await diagnostics()).session.cargo.carried.length,1);await shot('desktop-cargo');
  await go(47);await work();assert.equal((await diagnostics()).session.environment.stationUsed,true);await shot('desktop-charger');
  const sizes=[[1366,900],[390,844],[844,390]];
  async function routeBoxes(){const boxes=[];for(const [width,height] of sizes){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});await delay(150);
    boxes.push(await evaluate('(()=>{const r=document.getElementById("three-viewport").getBoundingClientRect();return {y:r.y,h:r.height}})()'));
    assert.ok(boxes.at(-1).h>=130,JSON.stringify({width,height,scene:boxes.at(-1)}));
  }await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});return boxes;}
  await go(51);const before=await routeBoxes();
  assert.ok((await evaluate('document.getElementById("interaction-prompt").textContent')).includes('分岔'));
  await go(54);const during=await routeBoxes();
  await click('[data-action="route-direct"]');await shot('desktop-junction');
  for(const [width,height] of sizes.slice(1)){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(150);
    await shot('junction-'+width+'x'+height);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await go(56);const after=await routeBoxes();
  assert.deepEqual(during,before);assert.deepEqual(after,before);report.routeBounds={before,during,after};
  pass('route junction and direct choice preserve scene bounds on desktop, portrait and landscape');
  await go(54);
  assert.ok((await evaluate('document.getElementById("interaction-prompt").textContent')).includes('\u524d\u8fdb\u6216\u5012\u8f66'));
  await click('[data-action="route-bypass"]');assert.equal((await diagnostics()).session.environment.choices.bridge,'bypass');
  await click('[data-action="route-direct"]');assert.deepEqual(await routeBoxes(),before);
  await shot('desktop-junction-reverse');
  pass('backtracking after missing the near junction restores route buttons without moving the scene');
  await go(66);await shot('desktop-bridge');
  assert.ok((await diagnostics()).session.heightM>.7);await go(78);await shot('desktop-bridge-exit');
  await go(76);await go(78);
  await click('[data-action="route-bypass"]');assert.equal((await diagnostics()).session.environment.choices.bridge,'bypass');
  await click('[data-action="route-direct"]');
  pass('far junction can be selected while driving forward after reversing past it');
  await go(84.15);await shot('desktop-large-box');await work();assert.equal((await diagnostics()).session.environment.removed.debris,1);await shot('desktop-cleared-box');
  await go(95);await interact();assert.equal((await diagnostics()).session.cargo.delivered.length,1);
  assert.ok((await evaluate('document.getElementById("interaction-prompt").textContent')).includes('终点'));
  await shot('desktop-finish-approach');
  await go(100);await shot('desktop-result');
  const s=(await diagnostics()).session;assert.equal(s.result.score.cargoBonus,2000);assert.ok(s.result.score.formalScore>2000);
  assert.equal(await evaluate('document.querySelectorAll("#challenge-result .result-row").length'),6);
  report.run={time:s.elapsedSeconds,energy:s.energyRemainingUnits,result:s.result};pass('low-power quadruped real keyboard drive across sand and arch, charge, clear, deliver, score');
  for(const [width,height] of [[1366,900],[390,844],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});await delay(250);
    const bounds=await evaluate(`(()=>{const panel=document.getElementById('result-demo'),button=panel.querySelector('.result-actions button');panel.scrollTop=panel.scrollHeight;const p=panel.getBoundingClientRect(),b=button.getBoundingClientRect();return{top:p.top,bottom:p.bottom,buttonTop:b.top,buttonBottom:b.bottom,visible:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}})()`);
    assert.ok(bounds.top>=0&&bounds.bottom<=height&&bounds.buttonTop>=bounds.top&&bounds.buttonBottom<=bounds.bottom&&bounds.visible,JSON.stringify(bounds));
    await shot('result-actions-'+width+'x'+height);
  }
  pass('desktop and mobile result actions remain visible and reachable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await preview(report.base+'/');assert.ok((await evaluate('document.getElementById(\"best-score\").textContent')).includes(String.fromCodePoint(26368,39640,20998)));pass('new score survives reload');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await preview(report.base+'/');await click('[data-action="recommended"]');await shot('mobile-configuration');
  async function swipe(selector){
    const start=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,scroll:scrollY,module:document.querySelector(".module-card[aria-pressed=true]")?.dataset.module,category:document.querySelector("[data-category][aria-pressed=true]")?.dataset.category}})()');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:2,radiusX:6,radiusY:6}]});
    for(let step=1;step<=8;step++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-step*18,id:2,radiusX:6,radiusY:6}]});await delay(25);}
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(350);
    const end=await evaluate('({scroll:scrollY,module:document.querySelector(".module-card[aria-pressed=true]")?.dataset.module,category:document.querySelector("[data-category][aria-pressed=true]")?.dataset.category})');
    assert.ok(end.scroll>start.scroll+30,JSON.stringify({selector,start,end}));assert.equal(end.module,start.module);assert.equal(end.category,start.category);
  }
  await swipe('[data-category="chassis"]');await swipe('[data-module="chassis_wheel"]');
  pass('native vertical swipes over category and component buttons scroll without selecting');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await click('[data-action="start"]');
  const box=await evaluate('(()=>{const r=document.querySelector("[data-drive=forward]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...box,id:1,radiusX:6,radiusY:6}]});await delay(1500);
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok((await diagnostics()).session.xM>.3);
  await shot('mobile-driving');
  for(const size of [[390,844],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:true});await delay(300);
    const boxes=await evaluate('[...document.querySelectorAll("[data-drive]")].map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}})');
    assert.ok(boxes.every(r=>r.w>=40&&r.h>=40&&r.x>=0&&r.y>=0&&r.right<=size[0]+1&&r.bottom<=size[1]+1),JSON.stringify(boxes));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);await shot('mobile-'+size.join('x'));
  }
  await click('[data-action="pause"]');assert.equal((await diagnostics()).session.phase,'paused');pass('mobile touch driving, portrait and landscape controls, pause');
  await preview(report.base+'/?test=1');assert.equal((await diagnostics()).testMode,true);assert.equal((await diagnostics()).missionId,'transport-yard');pass('test mode shares same map');
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));report.passed=true;

} catch (error) {
  report.error = error.stack ?? String(error); process.exitCode = 1; console.error(report.error);
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
  browser?.kill(); server?.close();
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Evidence: ' + evidence);
}


