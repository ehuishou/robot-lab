import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
const delay = ms => new Promise(done => setTimeout(done, ms));
const evidence = resolve('docs/evidence/single-map', process.argv.some(arg => arg.startsWith('http')) ? 'tutorial-deployed' : 'tutorial-browser');
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



  async function navigate(path='') {
    await send('Page.navigate',{url:report.base+'/'+path});
    await until(()=>evaluate("document.documentElement.dataset.previewState==='ready'"));
  }
  await navigate();
  assert.equal(await evaluate("document.querySelector('.nickname-dialog').open && !document.querySelector('#map-tutorial').open"),true);
  await evaluate("document.querySelector('#nickname-input').value='QA Tutorial';document.querySelector('#nickname-form').requestSubmit()");
  assert.equal(await evaluate("!document.querySelector('.nickname-dialog').open && document.querySelector('#map-tutorial').open"),true);
  assert.equal((await diagnostics()).session,null);
  pass('nickname login precedes visual tutorial; no timed run starts');
  assert.equal(await evaluate("document.querySelectorAll('#map-tutorial svg[role=img]').length"),2);
  await screenshot('tutorial-desktop');
  for(let index=0;index<7;index++){
    assert.equal(await evaluate("Number(document.querySelector('#map-tutorial').dataset.step)"),index);
    assert.equal(await evaluate("document.querySelectorAll('.tutorial-stops [aria-current=step]').length"),1);
    assert.equal(await evaluate("document.activeElement.id"),'tutorial-heading');
    if([2,3,5].includes(index)){
      const before=await evaluate("document.querySelector('.tutorial-figure svg').innerHTML");
      await click('#tutorial-demo');assert.notEqual(await evaluate("document.querySelector('.tutorial-figure svg').innerHTML"),before);
      assert.equal(await evaluate("document.querySelector('#tutorial-demo').getAttribute('aria-pressed')"),'true');
    }
    if(index===4){
      await click('#tutorial-chassis_wheel');
      assert.ok((await evaluate("document.querySelector('.tutorial-feedback').textContent")).includes('绕行'));
      const wheel=await evaluate("document.querySelector('.tutorial-figure svg').innerHTML");
      await click('#tutorial-chassis_quadruped');
      assert.notEqual(await evaluate("document.querySelector('.tutorial-figure svg').innerHTML"),wheel);
      assert.ok((await evaluate("document.querySelector('.tutorial-feedback').textContent")).includes('任意电机'));
      await screenshot('tutorial-bridge-desktop');
    }
    if(index===6){assert.ok((await evaluate("document.querySelector('.tutorial-tip').textContent")).includes('2000'));await screenshot('tutorial-finish');}
    await click('#tutorial-next');
  }
  assert.equal(await evaluate("document.querySelector('#map-tutorial').open"),false);
  assert.equal(await evaluate("document.activeElement.dataset.category"),'chassis');
  pass('seven illustrated steps, map progress, route choices and operation demos; finish returns to assembly');
  await navigate();assert.equal(await evaluate("document.querySelector('#map-tutorial').open"),false);
  await click('#tutorial-button');assert.equal(await evaluate("document.querySelector('#map-tutorial').open"),true);
  await click('[data-tutorial-step="4"]');await click('#tutorial-prev');assert.equal(await evaluate("document.querySelector('#map-tutorial').dataset.step"),'3');
  pass('completion survives reload; tutorial can be replayed and navigated backwards');
  for(const [width,height] of [[390,844],[844,390],[320,568]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await click('[data-tutorial-step="4"]');await delay(150);
    const bounds=await evaluate("(()=>{const d=document.querySelector('#map-tutorial'),b=document.querySelector('#tutorial-next'),r=b.getBoundingClientRect();return {left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,scroll:d.scrollWidth,client:d.clientWidth,x:r.x+r.width/2,y:r.y+r.height/2,bottom:r.bottom}})()");
    assert.ok(bounds.left>=0&&bounds.right<=width+1&&bounds.scroll<=bounds.client+1&&bounds.bottom<=height,JSON.stringify(bounds));
    await screenshot('tutorial-mobile-'+width);
    if(height<600){
      const scroll=await evaluate("(()=>{const b=document.querySelector('.tutorial-body'),r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.bottom-25,top:b.scrollTop}})()");
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:scroll.x,y:scroll.y,id:2,radiusX:6,radiusY:6}]});
      for(let move=1;move<=8;move++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:scroll.x,y:scroll.y-move*18,id:2,radiusX:6,radiusY:6}]});await delay(25);}
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await delay(150);assert.ok(await evaluate("document.querySelector('.tutorial-body').scrollTop>0"));
      await screenshot('tutorial-mobile-scrolled-'+width);
    }
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x,y:bounds.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(()=>evaluate("document.querySelector('#map-tutorial').dataset.step==='5'"));
  }
  pass('mobile portrait, landscape and 320px: no overflow; fixed next button accepts real touches');
  await click('[data-tutorial-step="6"]');await click('#tutorial-next');
  await navigate('?test=1');assert.equal((await diagnostics()).testMode,true);
  assert.equal(await evaluate("document.querySelector('#test-mode-control')===null"),true);
  await navigate();assert.equal((await diagnostics()).testMode,false);
  assert.equal(await evaluate("[...document.querySelectorAll('a,button')].some(e=>/开启测试|切回正常/.test(e.textContent)||e.getAttribute('href')?.includes('test='))"),false);
  await evaluate("localStorage.removeItem('robot_lab_map_tutorial_v1')");await navigate();
  assert.equal(await evaluate("document.querySelector('#map-tutorial').open && !document.querySelector('.nickname-dialog').open"),true);
  pass('URL-only test mode; existing nickname without tutorial completion receives onboarding');
  const blocked=await send('Page.addScriptToEvaluateOnNewDocument',{source:"Storage.prototype.getItem=function(){throw new Error('Storage blocked')};Storage.prototype.setItem=function(){throw new Error('Storage blocked')}"});
  await navigate();assert.equal(await evaluate("document.querySelector('.nickname-dialog').open"),true);
  await evaluate("document.querySelector('#nickname-input').value='QA NoStorage';document.querySelector('#nickname-form').requestSubmit()");
  assert.equal(await evaluate("document.querySelector('#map-tutorial').open"),true);
  for(let i=0;i<7;i++)await click('#tutorial-next');
  await click('#nickname-button');await evaluate("document.querySelector('#nickname-input').value='QA NoStorage2';document.querySelector('#nickname-form').requestSubmit()");
  assert.equal(await evaluate("document.querySelector('#map-tutorial').open"),false);
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:blocked.identifier});
  pass('blocked local storage still permits login and tutorial completion for the current page');
  assert.deepEqual(report.exceptions,[]);pass('no uncaught browser exceptions');report.passed=true;
} catch (error) {
  report.error = error.stack ?? String(error); process.exitCode = 1; console.error(report.error);
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await send('Browser.close').catch(() => {}); socket.close(); }
  browser?.kill(); server?.close();
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Evidence: ' + evidence);
}
