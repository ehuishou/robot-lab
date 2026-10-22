import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as proxyRequest } from 'node:http';
import {randomBytes} from 'node:crypto';
import {fixture} from './verify-leaderboard.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
const delay = ms => new Promise(done => setTimeout(done, ms));
const evidence = resolve('docs/evidence/single-map', 'leaderboard-browser');
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
  await evaluate(`(()=>{if(document.querySelector('.nickname-dialog')?.open){document.querySelector('#nickname-input').value='QA-browser';document.querySelector('#nickname-form').requestSubmit();}return true})()`);
}
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
}
function pass(name) { console.log('PASS ' + name); report.cases.push(name); }
let apiChild;
try {
 const guard=createServer();await new Promise(r=>guard.listen(0,'127.0.0.1',r));const apiPort=guard.address().port;await new Promise(r=>guard.close(r));
 const password=randomBytes(24).toString('hex'),data=mkdtempSync(resolve(tmpdir(),'robot-board-browser-'));
 apiChild=spawn(process.execPath,['dist-server/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(apiPort),ROBOT_DATA_DIR:data,ROBOT_ADMIN_PASSWORD:password},stdio:'ignore',windowsHide:true});
 await until(async()=>{try{return (await fetch('http://127.0.0.1:'+apiPort+'/api/health')).ok;}catch{return false;}});
 let available=true;
 const root=resolve('dist');
 server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){
   if(!available){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"offline test"}');return;}
   const upstream=proxyRequest({hostname:'127.0.0.1',port:apiPort,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);return;
  }
  const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root+sep)||!existsSync(path)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[extname(path)]??'application/octet-stream'});res.end(readFileSync(path));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;report.base=base;
 const profile=mkdtempSync(resolve(tmpdir(),'robot-board-ui-'));
 browser=spawn(process.env.ROBOT_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1366,900','about:blank'],{windowsHide:true,stdio:'ignore'});
 browser.on('error',e=>report.browserError=e.message);await until(()=>{assert.ok(!report.browserError,report.browserError);return existsSync(resolve(profile,'DevToolsActivePort'));});
 const port=readFileSync(resolve(profile,'DevToolsActivePort'),'utf8').split('\n')[0];const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const waiter=pending.get(m.id);pending.delete(m.id);clearTimeout(waiter.timer);if(m.error)waiter.reject(new Error(JSON.stringify(m.error)));else waiter.done(m.result);}else if(m.method==='Runtime.exceptionThrown')report.exceptions.push(m.params.exceptionDetails);});
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:base});await until(()=>evaluate("document.documentElement.dataset.previewState==='ready'"));
 assert.equal(await evaluate("document.querySelector('.nickname-dialog').open"),true);await screenshot('nickname-desktop');
 await evaluate("document.querySelector('#nickname-input').value='  QA   Player  ';document.querySelector('#nickname-form').requestSubmit()");
 assert.equal(await evaluate("localStorage.getItem('robot_lab_nickname_v1')"),'QA Player');
 assert.equal(await evaluate("[...document.querySelectorAll('a')].some(a=>/leaderboard/i.test(a.href)) || document.body.innerText.includes('\u6392\u884c')"),false);pass('nickname-only entry; game has no leaderboard entrance');
 await click('#nickname-button');assert.equal(await evaluate("document.querySelector('.nickname-dialog').open"),true);await evaluate("document.querySelector('#nickname-input').value='QA Other';document.querySelector('#nickname-form').requestSubmit()");
 assert.equal(await evaluate("localStorage.getItem('robot_lab_nickname_v1')"),'QA Other');pass('nickname can be changed before a run');
 available=false;const high=fixture('QA Player',40);
 await evaluate('localStorage.setItem("robot_lab_pending_scores_v1",'+JSON.stringify(JSON.stringify([high]))+')');
 await send('Page.navigate',{url:base});await until(()=>evaluate("document.documentElement.dataset.previewState==='ready'"));await delay(500);assert.equal(await evaluate("JSON.parse(localStorage.getItem('robot_lab_pending_scores_v1')).length"),1);
 available=true;await evaluate("window.dispatchEvent(new Event('online'))");await until(()=>evaluate("JSON.parse(localStorage.getItem('robot_lab_pending_scores_v1')).length===0"));
 let board=await(await fetch(base+'/api/leaderboard')).json();assert.equal(board.entries[0].score,high.score);
 const low=fixture('qa player',90);await evaluate('localStorage.setItem("robot_lab_pending_scores_v1",'+JSON.stringify(JSON.stringify([low]))+')');
 await send('Page.navigate',{url:base});await until(()=>evaluate("document.documentElement.dataset.previewState==='ready' && JSON.parse(localStorage.getItem('robot_lab_pending_scores_v1')).length===0"));
 board=await(await fetch(base+'/api/leaderboard')).json();assert.equal(board.entries.length,1);assert.equal(board.entries[0].score,high.score);pass('offline queue retries online and after reload; lower retry preserves best');
 await send('Page.navigate',{url:base+'/leaderboard.html'});await until(()=>evaluate("document.documentElement.dataset.leaderboardState==='ready'"));
 assert.equal(await evaluate("document.querySelectorAll('.board-row').length"),1);assert.equal(await evaluate("document.querySelectorAll('[data-action=edit]').length"),0);
 assert.equal(await evaluate("document.querySelectorAll('canvas').length"),0);await screenshot('board-desktop');pass('independent leaderboard; public view is read only');
 await click('#manage');await evaluate('document.getElementById("admin-password").value='+JSON.stringify(password)+';document.getElementById("admin-form").requestSubmit()');
 await until(()=>evaluate("!document.getElementById('logout').hidden && document.querySelectorAll('[data-action=edit]').length===1"));
 await click('[data-action=edit]');await evaluate("document.getElementById('edit-nickname').value='QA Edited';document.getElementById('edit-score').value='4321';document.getElementById('edit-form').requestSubmit()");await until(()=>evaluate("document.querySelector('.board-score')?.textContent==='4321'"));
 assert.equal(await evaluate("document.querySelector('.board-identity strong').textContent"),'QA Edited');await screenshot('board-admin');pass('admin login and edit through UI');
 for(const [width,height]of[[390,844],[844,390]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await click('[data-action=edit]');
  const bounds=await evaluate("(()=>{const d=document.getElementById('edit-dialog').getBoundingClientRect();return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,width:innerWidth,height:innerHeight}})()");assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.top>=0&&bounds.bottom<=height,JSON.stringify(bounds));
  await screenshot('board-mobile-'+width);await evaluate("document.getElementById('edit-dialog').close()");
 }pass('mobile portrait and landscape: no horizontal overflow, usable dialogs');
 await click('[data-action=delete]');await evaluate("document.getElementById('delete-form').requestSubmit()");await until(()=>evaluate("document.querySelectorAll('.board-row').length===0"));
 await click('#logout');await until(()=>evaluate("document.getElementById('logout').hidden"));pass('UI delete and logout');
 assert.deepEqual(report.exceptions,[]);pass('no uncaught browser exceptions');
} finally {
 writeFileSync(resolve(evidence,'report.json'),JSON.stringify(report,null,2));
 if(socket){try{await send('Browser.close');}catch{}socket.close();}if(browser)browser.kill();
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(apiChild)apiChild.kill();
}
