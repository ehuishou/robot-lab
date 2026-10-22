import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {load} from './verification-loader.mjs';
const {TRANSPORT_MISSION:mission}=load('src/content/challenges.ts');
const {MODULES}=load('src/content/modules.ts');
const {validateConfiguration}=load('src/domain/config/validateConfiguration.ts');
const {scoreChallenge,createChallengeSnapshot}=load('src/domain/mission/scoring.ts');
const config=mission.recommendedConfiguration;
const summary=validateConfiguration(config,MODULES,mission.configurationRules).summary;
export function fixture(nickname='QA-player',elapsedSeconds=60) {
 const performance={elapsedSeconds,maxTimeSeconds:mission.hardLimits.maxTimeSeconds,energyRemainingUnits:summary.batteryCapacityUnits/2,batteryCapacityUnits:summary.batteryCapacityUnits,cargoDelivered:true};
 return {nickname,sessionId:randomUUID(),configuration:config,rulesVersion:mission.challenge.rulesVersion,testMode:false,outcome:'succeeded',performance,
 score:scoreChallenge(createChallengeSnapshot(mission.id,mission.challenge,summary.cost,false),'succeeded',performance).formalScore};
}
// Import fixture generation without starting tests (browser verification uses the same payload).
if (process.argv[1] && resolve(process.argv[1])===resolve('scripts/verify-leaderboard.mjs')) await verify();
async function verify(){
 const directory=mkdtempSync(join(tmpdir(),'robot-scores-')),password=randomBytes(24).toString('hex'),checks=[];
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base='http://127.0.0.1:'+port;let child,cookie='';
 const pass=name=>{checks.push(name);console.log('PASS',name);};
 async function start(){
  child=spawn(process.execPath,['dist-server/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ROBOT_DATA_DIR:directory,ROBOT_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let errors='';child.stderr.on('data',b=>errors+=b);const deadline=Date.now()+10000;
  while(Date.now()<deadline){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw new Error(errors);await new Promise(r=>setTimeout(r,50));}throw new Error('API startup timeout '+errors);
 }
 async function stop(){if(child && child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
 async function request(path,method='GET',data,expected=200,extra={}){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return {value,response};
 }
 const board=async()=>(await request('/api/leaderboard')).value;
 try{
  await start();assert.equal((await board()).entries.length,0);
  const first=fixture('  Alice   Lee  ');await request('/api/scores','POST',first);
  let entries=(await board()).entries;assert.equal(entries.length,1);assert.equal(entries[0].nickname,'Alice Lee');assert.equal(entries[0].score,first.score);const id=entries[0].id,time=entries[0].achievedAt;
  const lower=fixture('alice lee',100);assert.equal((await request('/api/scores','POST',lower)).value.status,'unchanged');
  const equal=fixture('ALICE LEE',60);await request('/api/scores','POST',equal);
  entries=(await board()).entries;assert.equal(entries.length,1);assert.equal(entries[0].id,id);assert.equal(entries[0].achievedAt,time);assert.equal(entries[0].nickname,'Alice Lee');
  const higher=fixture('Alice Lee',40);assert.equal((await request('/api/scores','POST',higher)).value.status,'saved');assert.equal((await board()).entries[0].score,higher.score);
  pass('one normalized nickname, highest only; lower/equal preserve prior record');
  const unicode=fixture('e\u0301');await request('/api/scores','POST',unicode);await request('/api/scores','POST',fixture('\u00e9',80));assert.equal((await board()).entries.length,2);pass('Unicode NFC identities merge');
  const revision=(await board()).revision;assert.equal((await request('/api/scores','POST',higher)).value.status,'duplicate');assert.equal((await board()).revision,revision);pass('idempotent repeated submission');
  for(const override of [{nickname:''},{nickname:'x'.repeat(21)},{nickname:'x\u0000'},{rulesVersion:'old'}, {testMode:true},{outcome:'failed'},{configuration:{...config,motor:'removed'}},{score:5000},{performance:{...first.performance,batteryCapacityUnits:999}},{performance:{...first.performance,elapsedSeconds:1}}])await request('/api/scores','POST',{...fixture(),...override},400);
  let res=await fetch(base+'/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(res.status,400);
  await request('/api/scores','POST',fixture(),403,{Origin:'https://other.invalid'});pass('invalid, old, test, forged and cross-origin payloads rejected');
  await request('/api/admin/entries','POST',{revision:(await board()).revision,nickname:'Manual',score:99999},401);
  await request('/api/admin/entries/'+id,'DELETE',{revision:(await board()).revision},401);await request('/api/admin/login','POST',{password:'wrong'},401);
  const login=await request('/api/admin/login','POST',{password});const set=login.response.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);cookie=set.split(';')[0];assert.equal((await request('/api/admin/session')).value.authenticated,true);pass('management authentication and protected mutations');
  await request('/api/admin/entries/'+id,'PATCH',{revision:(await board()).revision,nickname:'Renamed',score:4444});
  assert.equal((await board()).entries[0].score,4444);assert.equal((await board()).entries[0].manual,true);
  await request('/api/admin/entries/'+id,'PATCH',{revision:0,nickname:'Renamed',score:12},409);
  await request('/api/admin/entries/'+id,'PATCH',{revision:(await board()).revision,nickname:'\u00e9',score:12},409);pass('manual edit, duplicate-name and concurrent-edit safeguards');
  await request('/api/admin/entries/'+id,'DELETE',{revision:(await board()).revision});await request('/api/scores','POST',higher);assert.ok(!(await board()).entries.some(e=>e.id===id));pass('delete persists; old submission cannot resurrect deleted score');
  const manualInput={nickname:'  Manual   Entry  ',score:999999};
  await request('/api/admin/entries','POST',{...manualInput,revision:(await board()).revision});
  let manual=(await board()).entries.find(e=>e.nickname==='Manual Entry');
  assert.equal(manual.score,999999);assert.equal(manual.manual,true);assert.equal(manual.performance,null);assert.equal(manual.configuration,null);
  assert.equal((await board()).entries[0].id,manual.id);
  await request('/api/scores','POST',fixture('manual entry'));assert.equal((await board()).entries.find(e=>e.id===manual.id).score,999999);
  await request('/api/admin/entries','POST',{...manualInput,revision:(await board()).revision},409);
  await request('/api/admin/entries','POST',{nickname:'Concurrent',score:20,revision:0},409);
  for(const score of [null,'6000',1.5,Number.MAX_SAFE_INTEGER+1]){
    await request('/api/admin/entries','POST',{nickname:'Invalid',score,revision:(await board()).revision},400);
    await request('/api/admin/entries/'+manual.id,'PATCH',{nickname:'Manual Entry',score,revision:(await board()).revision},400);
  }
  await request('/api/admin/entries','POST',{nickname:'',score:6000,revision:(await board()).revision},400);
  await request('/api/admin/entries','POST',{nickname:'Cross origin',score:6000,revision:(await board()).revision},403,{Origin:'https://other.invalid'});
  await request('/api/admin/entries/'+manual.id,'PATCH',{nickname:'Manual Entry',score:-100,revision:(await board()).revision});
  assert.equal((await board()).entries.find(e=>e.id===manual.id).score,-100);
  await request('/api/admin/entries/'+manual.id,'PATCH',{nickname:'Manual Entry',score:Number.MAX_SAFE_INTEGER,revision:(await board()).revision});
  pass('manual add/edit bypass game range; duplicate, stale, malformed and unauthorized writes rejected');
  const before=await board();await stop();await start();cookie='';assert.deepEqual(await board(),before);assert.equal((await board()).entries[0].score,Number.MAX_SAFE_INTEGER);assert.ok(existsSync(join(directory,'leaderboard.json.bak')));assert.ok(!readFileSync(join(directory,'leaderboard.json'),'utf8').includes(password));pass('restart persistence, backup, no password in score data');
  mkdirSync('docs/evidence/single-map',{recursive:true});writeFileSync('docs/evidence/single-map/leaderboard-api.json',JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2));
 }finally{await stop();}
}
