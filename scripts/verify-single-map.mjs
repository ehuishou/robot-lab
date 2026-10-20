import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {load} from './verification-loader.mjs';
const {TRANSPORT_MISSION:mission}=load('src/content/challenges.ts');
const {MODULES:catalog}=load('src/content/modules.ts');
const {PREVIEW_ASSETS:assets}=load('src/content/assets.ts');
const {createMissionSession,transitionSession,challengePerformance}=load('src/domain/mission/session.ts');
const {validateMission}=load('src/domain/mission/validateMission.ts');
const E=load('src/domain/simulation/environment.ts');
const {createTerrainSampler}=load('src/domain/simulation/terrain.ts');
const {scoreChallenge,createChallengeSnapshot}=load('src/domain/mission/scoring.ts');
const {saveChallengeResult,readBestScore,CHALLENGE_RECORDS_KEY}=load('src/app/ChallengeRecords.ts');
const {sandboxMission,sandboxCatalog}=load('src/testing/SandboxPolicy.ts');
const terrain=createTerrainSampler(mission.terrain),checks=[],runs=[];let seq=0;
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS',name)};
function create(c={},test=false){return createMissionSession('single-'+ ++seq,test?sandboxMission(mission):mission,{...mission.recommendedConfiguration,...c},test?sandboxCatalog(catalog):catalog,assets).state;}
function command(s,c){return transitionSession(s,{sessionId:s.sessionId,commandId:'c'+ ++seq,...c});}
function send(s,c){const r=command(s,c);assert.ok(r.accepted,JSON.stringify({command:c,reason:r.reason,x:s.xM,phase:s.phase}));return r.state;}
function tick(s,throttle=0,brake=true){return send(s,{kind:'drive',deltaSeconds:1/30,intent:{throttle,brake}});}
function wait(s){for(let i=0;i<400&&s.environment.work&&!s.result;i++)s=tick(s);assert.equal(s.environment.work,null);return s;}
function go(s,target){
 for(let i=0;i<6000&&!s.result;i++){
  const dx=target-s.xM,v=s.speedMps;
  if(target===100){s=tick(s,1,false);continue;}
  if(Math.abs(dx)<.23&&Math.abs(v)<.16)return s;
  const brake=Math.abs(dx)<Math.abs(v*v)/7+.15 || v*Math.sign(dx)<-.1;
  s=tick(s,brake?0:Math.sign(dx),brake);
 }
 assert.ok(s.result?.outcome==='succeeded'&&target===100,JSON.stringify({target,x:s.xM,result:s.result,blocked:s.environment.blocked,energy:s.energyRemainingUnits}));return s;
}
check('current configuration storage roundtrip and corrupt-save rejection',()=>{
 const {PREVIEW_SAVE_KEY,readPreviewConfiguration,savePreviewConfiguration}=load('src/app/PreviewSave.ts');
 const memory=new Map(), storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 assert.equal(readPreviewConfiguration(storage,catalog).status,'empty');
 assert.equal(savePreviewConfiguration(storage,mission.recommendedConfiguration,catalog).saved,true);
 assert.deepEqual(readPreviewConfiguration(storage,catalog).configuration,{...mission.recommendedConfiguration,accessory:null});
 for(const value of ['{',JSON.stringify({version:2,configuration:mission.recommendedConfiguration}),JSON.stringify({version:1,configuration:{...mission.recommendedConfiguration,chassis:'removed-module'}})]) {
  memory.set(PREVIEW_SAVE_KEY,value);assert.equal(readPreviewConfiguration(storage,catalog).status,'rejected');
 }
 const unavailable={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
 assert.equal(readPreviewConfiguration(unavailable,catalog).reason,'storageUnavailable');
 assert.equal(savePreviewConfiguration(unavailable,mission.recommendedConfiguration,catalog).saved,false);
});
check('one map, valid layout, real branch clearances',()=>{
assert.equal('difficulty' in mission.challenge,false);
 assert.deepEqual(validateMission(mission,catalog,assets),{valid:true,issues:[]});
 for(const s of mission.environment.sections){assert.equal(E.hasBypass(s),s.kind==='bridge');}
 const bad=structuredClone(mission);bad.environment.sections[3].startM=78;
 assert.equal(validateMission(bad,catalog,assets).valid,false);
 assert.equal(mission.environment.sections.find(s=>s.kind==='debris').pieces,1);
});
check('sand cannot be selected as a bypass; bridge is exclusive in both directions',()=>{
 const sand=mission.environment.sections[0];assert.equal(E.nearestJunction([sand],15),undefined);
 assert.equal(command({...create(),xM:15},{kind:'route',sectionId:'sand',route:'bypass'}).accepted,false);
 for(const chassis of ['chassis_wheel','chassis_track','chassis_quadruped']){
  const env=E.createEnvironmentState({...mission.recommendedConfiguration,chassis});
  assert.equal(E.constrainEnvironmentMotion(mission.environment,env,58,61),chassis==='chassis_quadruped'?61:59.2);
  assert.equal(E.constrainEnvironmentMotion(mission.environment,env,74,71),chassis==='chassis_quadruped'?71:72.8);
  assert.equal(E.constrainEnvironmentMotion(mission.environment,{...env,choices:{bridge:'bypass'}},58,61),61);
 }
});
check('shared arch rises and falls; bypass remains flat',()=>{
 const pose=x=>E.routePose(mission.environment.sections,{},terrain,x);
 assert.ok(Math.abs(pose(66).heightM-.9)<1e-9);
 assert.equal(pose(60).heightM,0);assert.ok(pose(72).heightM<1e-12);
 assert.ok(pose(63).slope>0&&pose(69).slope<0);
 assert.equal(E.routePose(mission.environment.sections,{bridge:'bypass'},terrain,66).heightM,0);
});
check('every chassis slows in sand, tracks lose the smallest speed fraction',()=>{
 const ratios=[];
 for(const chassis of ['chassis_wheel','chassis_track','chassis_quadruped']){
  function segment(sand){let env={...E.createEnvironmentState({...mission.recommendedConfiguration,chassis,motor:'motor_standard'}),assist:false},x=19,v=0;let max=0;
   for(let i=0;i<120;i++){const r=E.simulateEnvironmentStep(sand?mission.environment:{...mission.environment,sections:[]},env,{xM:x,speedMps:v,massKg:80,energy:100,capacity:100,testMode:false},{throttle:1,brake:false},terrain,1/30);env=r.environment;x=r.xM;v=r.speedMps;max=Math.max(max,v);}return max;}
  const ratio=segment(true)/segment(false);assert.ok(ratio<.95);ratios.push(ratio);
 }
 assert.ok(ratios[1]>ratios[0]&&ratios[1]>ratios[2]);
});
check('all four score components, failed and test exclusions',()=>{
 const snap=createChallengeSnapshot(mission.id,mission.challenge,250,false);
 const p={elapsedSeconds:45,maxTimeSeconds:180,energyRemainingUnits:35,batteryCapacityUnits:70,cargoDelivered:true};
 assert.deepEqual(scoreChallenge(snap,'succeeded',p),{formalScore:3750,timeBonus:750,energyBonus:500,cargoBonus:2000,budgetBonus:500});
 assert.equal(scoreChallenge(snap,'succeeded',{...p,cargoDelivered:false}).formalScore,1750);
 assert.equal(scoreChallenge(snap,'failed').formalScore,0);
 assert.equal(scoreChallenge({...snap,testMode:true},'succeeded').formalScore,null);
 assert.throws(()=>scoreChallenge(snap,'succeeded',{...p,energyRemainingUnits:Infinity}));
});
function complete(chassis,carry=true,bridge='bypass',blade=false){
 let s=create({chassis,motor:chassis==='chassis_quadruped'?'motor_high':'motor_standard',...(blade?{accessory:'tool_blade'}:{})});
 if(carry){s=go(s,38);s=send(s,{kind:'pickup',objectId:'cargo'});s=wait(s);assert.equal(s.cargo.carried.length,1);}
 s=go(s,47);s=send(s,{kind:'work'});s=wait(s);assert.equal(s.environment.stationUsed,true);assert.ok(s.energyRestoredUnits>0);
 s=go(s,54);s=send(s,{kind:'route',sectionId:'bridge',route:bridge});
 s=go(s,84.1);s=send(s,{kind:'work'});s=wait(s);assert.equal(s.environment.removed.debris,1);
 if(carry){s=go(s,95);s=send(s,{kind:'deliver',zoneId:'delivery',cargoIds:['cargo']});s=wait(s);}
 s=go(s,100);assert.equal(s.phase,'succeeded');assert.equal(s.result.score.cargoBonus,carry?2000:0);
 assert.ok(Math.abs(s.energyRemainingUnits+s.energyConsumedUnits-s.energyRestoredUnits-70)<1e-6);
 assert.deepEqual(s.result.score,scoreChallenge(s.challenge,'succeeded',challengePerformance(s)));
 runs.push({chassis,carry,bridge,blade,time:s.elapsedSeconds,energy:s.energyRemainingUnits,score:s.result.score});
 return s;
}
let completed;
for(const chassis of ['chassis_wheel','chassis_track','chassis_quadruped'])check(chassis+' complete real drive, cargo, charging, clearing',()=>{completed=complete(chassis,true,chassis==='chassis_quadruped'?'direct':'bypass');});
check('empty arrival scores without transport bonus; blade clears one box',()=>complete('chassis_wheel',false,'bypass',true));
check('scores survive reload, isolate rule versions and exclude test mode',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 assert.equal(saveChallengeResult(storage,completed),'saved');assert.equal(readBestScore(storage,mission.id,mission.challenge),completed.result.score.formalScore);
 assert.equal(saveChallengeResult(storage,completed),'unchanged');assert.equal(readBestScore(storage,mission.id,{...mission.challenge,rulesVersion:'other'}),null);
 const r=JSON.parse(memory.get(CHALLENGE_RECORDS_KEY));r.records[0].performance.energyRemainingUnits=-1;memory.set(CHALLENGE_RECORDS_KEY,JSON.stringify(r));assert.equal(readBestScore(storage,mission.id,mission.challenge),null);
 assert.equal(saveChallengeResult(storage,{...completed,challenge:{...completed.challenge,testMode:true}}),'excluded');
});
check('time and energy failures settle at zero; pause holds simulation',()=>{
 let s=create();s=send(s,{kind:'pause'});assert.equal(command(s,{kind:'drive',deltaSeconds:1/30,intent:{throttle:1,brake:false}}).accepted,false);s=send(s,{kind:'resume'});
 const timed=tick({...s,elapsedSeconds:180});assert.equal(timed.result.failure,'timeExceeded');assert.equal(timed.result.score.formalScore,0);
 const drained=tick({...s,energyRemainingUnits:.00001});assert.equal(drained.result.failure,'energyExhausted');assert.equal(drained.result.score.formalScore,0);
});
mkdirSync('docs/evidence/single-map',{recursive:true});writeFileSync('docs/evidence/single-map/domain.json',JSON.stringify({checks,runs},null,2));
console.log(JSON.stringify(runs,null,2));
