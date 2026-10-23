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
const stability=new Map(), peakPoses=new Map(), bridgeStability=new Map();
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS',name)};
function create(c={},test=false){return createMissionSession('single-'+ ++seq,test?sandboxMission(mission):mission,{...mission.recommendedConfiguration,...c},test?sandboxCatalog(catalog):catalog,assets).state;}
function command(s,c){return transitionSession(s,{sessionId:s.sessionId,commandId:'c'+ ++seq,...c});}
function send(s,c){const r=command(s,c);assert.ok(r.accepted,JSON.stringify({command:c,reason:r.reason,x:s.xM,phase:s.phase}));return r.state;}
function tick(s,throttle=0,brake=true){
 const next=send(s,{kind:'drive',deltaSeconds:1/30,intent:{throttle,brake}});
 if(next.quadruped && next.quadruped.tiltDegrees>(stability.get(s.sessionId)??0)){stability.set(s.sessionId,next.quadruped.tiltDegrees);peakPoses.set(s.sessionId,{x:next.xM,v:next.speedMps,dir:throttle});}
 if(next.quadruped && next.xM>=60 && next.xM<=72)bridgeStability.set(s.sessionId,Math.max(bridgeStability.get(s.sessionId)??0,next.quadruped.tiltDegrees));
 return next;
}
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
check('context interaction resolves work and cargo in both directions, with safety guards',()=>{
 const {findNearbyInteraction:nearby}=load('src/domain/mission/nearbyInteraction.ts');
 const base=create({chassis:'chassis_wheel'});
 for(const direction of [-1,1]){
  const at=(xM)=>({...base,xM,energyRemainingUnits:base.energyRemainingUnits-5,
   environment:{...base.environment,travelDirection:direction}});
  for(const [x,kind,workKind] of [[38,'pickup'],[47,'work','charge'],[84.15,'work','clear'],[87.85,'work','clear']]){
   const state=at(x),action=nearby(state);assert.equal(action?.kind,kind);if(workKind)assert.equal(action.workKind,workKind);
   assert.equal(nearby({...state,speedMps:direction*.3}),null);
   assert.equal(nearby({...state,phase:'paused'}),null);
   assert.equal(nearby({...state,environment:{...state.environment,zM:1}}),null);
   assert.equal(nearby({...state,environment:{...state.environment,work:{kind:'load'}}}),null);
  }
  assert.equal(nearby(at(44)),null);
  assert.equal(nearby({...at(47),environment:{...at(47).environment,stationUsed:true}}),null);
  assert.equal(nearby({...at(47),energyRemainingUnits:base.parameters.batteryCapacityUnits}),null);
  assert.equal(nearby({...at(84.15),environment:{...at(84.15).environment,removed:{debris:1}}}),null);
  const loaded=wait(send(at(38),{kind:'pickup',objectId:'cargo'}));
  assert.equal(nearby(loaded)?.kind,'stage');
  assert.equal(nearby({...loaded,xM:95})?.kind,'deliver');
  assert.equal(nearby({...loaded,xM:47})?.workKind,'charge');
  assert.equal(nearby({...loaded,xM:50}),null);
 }
});
check('E and pointer interaction dispatch all operations once, with pause and busy protection',()=>{
 const {DrivingSessionController}=load('src/app/DrivingSessionController.ts');
 const base=create({chassis:'chassis_wheel'});
 const loaded=wait(send({...base,xM:38},{kind:'pickup',objectId:'cargo'}));
 for(const source of ['key','pointer'])for(const [state,workKind] of [
  [{...base,xM:38},'load'],[{...loaded,xM:95},'unload'],[{...loaded,xM:38},'unload'],
  [{...base,xM:47,energyRemainingUnits:base.energyRemainingUnits-5},'charge'],[{...base,xM:84.15},'clear']]){
  const controller=new DrivingSessionController(state);controller.advanceFrame(0);
  const press=(down)=>source==='key'?controller.input.setKey('e',down):controller.input.setAction('pointer:1','interact',down);
  press(true);controller.advanceFrame(34);assert.equal(controller.state.environment.work?.kind,workKind);
  const first=controller.state.environment.work;press(false);press(true);controller.advanceFrame(68);
  assert.ok(controller.state.environment.work.seconds>first.seconds,'busy press must not restart work');
  for(let t=102;t<=5500;t+=34)controller.advanceFrame(t);
  assert.equal(controller.state.environment.work,null,'holding interaction must not repeat or stage loaded cargo');
  if(workKind==='load')assert.equal(controller.state.cargo.carried.length,1);
  if(workKind==='charge')assert.equal(controller.state.environment.stationUsed,true);
  if(workKind==='clear')assert.equal(controller.state.environment.removed.debris,1);
  press(false);controller.pause();press(true);controller.advanceFrame(5600);assert.equal(controller.state.environment.work,null);
 }
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
check('both junctions accept either direction after passing and reversing; branch interior is locked',()=>{
 const section=mission.environment.sections.find(s=>s.kind==='bridge'),b=E.bypassBounds(section);
 for(const direction of [1,-1])for(const x of [b.startM-2,b.startM,b.endM,b.endM+2]){
  const base=create(),s={...base,xM:x,environment:{...base.environment,travelDirection:direction}};
  assert.equal(E.routePresentation(mission.environment,s.environment,x).junction?.id,section.id);
  for(const route of ['direct','bypass'])assert.equal(command(s,{kind:'route',sectionId:section.id,route}).accepted,true);
 }
 for(const x of [b.startM-2.1,b.startM+.1,66,b.endM-.1,b.endM+2.1]){
  assert.equal(E.nearestJunction([section],x),undefined);
  assert.equal(command({...create(),xM:x},{kind:'route',sectionId:section.id,route:'bypass'}).accepted,false);
 }
 let s=go(create(),58);s=go(s,54);
 assert.equal(s.environment.travelDirection,-1);
 assert.equal(E.routePresentation(mission.environment,s.environment,s.xM).junction?.id,section.id);
 s=send(s,{kind:'route',sectionId:section.id,route:'bypass'});s=go(s,78);
 assert.equal(s.environment.choices.bridge,'bypass');
 s=go(s,76);s=go(s,78);
 assert.equal(s.environment.travelDirection,1);
 s=send(s,{kind:'route',sectionId:section.id,route:'direct'});
 assert.equal(s.environment.choices.bridge,'direct');
});
check('pickup, charge, clear, delivery and staging remain available after reversing',()=>{
 const {findNearbyInteraction}=load('src/domain/mission/nearbyInteraction.ts');
 let s=go(create(),40);s=go(s,38);assert.equal(s.environment.travelDirection,-1);
 assert.equal(findNearbyInteraction(s)?.kind,'pickup');s=send(s,{kind:'pickup',objectId:'cargo'});s=wait(s);
 s=send(s,{kind:'stage',cargoIds:['cargo']});s=wait(s);
 assert.equal(findNearbyInteraction(s)?.kind,'pickup');s=send(s,{kind:'pickup',objectId:'cargo'});s=wait(s);
 s=go(s,49);s=go(s,47);assert.equal(s.environment.travelDirection,-1);
 s=send(s,{kind:'work'});assert.equal(s.environment.work.kind,'charge');s=wait(s);
 s=go(s,54);s=send(s,{kind:'route',sectionId:'bridge',route:'bypass'});s=go(s,84.1);
 s=tick(s,-1,false);s=tick(s);assert.equal(s.environment.travelDirection,-1);
 s=send(s,{kind:'work'});assert.equal(s.environment.work.kind,'clear');s=wait(s);
 s=go(s,98);s=go(s,95);assert.equal(s.environment.travelDirection,-1);
 assert.equal(findNearbyInteraction(s)?.kind,'deliver');s=send(s,{kind:'deliver',zoneId:'delivery',cargoIds:['cargo']});s=wait(s);
 assert.equal(s.cargo.delivered.length,1);
});
const bridgeRuns=[];
check('all quadruped motors cross the arch faster than bypass, loaded and in reverse',()=>{
 for(const motor of ['motor_low','motor_standard','motor_high'])for(const heavy of [false,true]){
  const config={chassis:'chassis_quadruped',motor,...(heavy?{battery:'battery_large',accessory:'tool_blade'}:{})};
  let base=create(config);
  if(heavy){base=go(base,38);base=send(base,{kind:'pickup',objectId:'cargo'});base=wait(base);}
  base=go(base,54);
  const times={};
  for(const route of ['direct','bypass']){
   stability.set(base.sessionId,0);bridgeStability.set(base.sessionId,0);
   let s=send(base,{kind:'route',sectionId:'bridge',route});const start=s.elapsedSeconds,energy=s.energyConsumedUnits;
   s=go(s,78);const forward=s.elapsedSeconds-start;
   s=send(s,{kind:'route',sectionId:'bridge',route});const reverseStart=s.elapsedSeconds;
   s=go(s,54);times[route]={forward,reverse:s.elapsedSeconds-reverseStart};
   assert.ok((stability.get(s.sessionId)??0)<25,JSON.stringify({motor,heavy,route,tilt:stability.get(s.sessionId),peak:peakPoses.get(s.sessionId)}));
   assert.ok((bridgeStability.get(s.sessionId)??0)<12,JSON.stringify({motor,heavy,route,bridgeTilt:bridgeStability.get(s.sessionId)}));
   assert.ok(s.energyConsumedUnits>energy);assert.equal(s.quadruped.overturnedSeconds,0);
  }
  assert.ok(times.direct.forward<times.bypass.forward,JSON.stringify({motor,heavy,times}));
  assert.ok(times.direct.reverse<times.bypass.reverse,JSON.stringify({motor,heavy,times}));
  bridgeRuns.push({motor,heavy,times});
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
 const ratios=[],speeds=[];
 for(const chassis of ['chassis_wheel','chassis_track','chassis_quadruped']){
  function segment(sand){let env={...E.createEnvironmentState({...mission.recommendedConfiguration,chassis,motor:'motor_standard'}),assist:false},x=19,v=0;let max=0;
   for(let i=0;i<120;i++){const r=E.simulateEnvironmentStep(sand?mission.environment:{...mission.environment,sections:[]},env,{xM:x,speedMps:v,massKg:80,energy:100,capacity:100,testMode:false},{throttle:1,brake:false},terrain,1/30);env=r.environment;x=r.xM;v=r.speedMps;max=Math.max(max,v);}return max;}
  const speed=segment(true),ratio=speed/segment(false);assert.ok(ratio<.95);ratios.push(ratio);speeds.push(speed);
 }
 assert.ok(ratios[1]>ratios[2]&&ratios[2]>.8&&ratios[2]<.9);
 assert.ok(speeds[2]>speeds[0]&&speeds[2]<speeds[0]*1.2);
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
function complete(chassis,carry=true,bridge='bypass',blade=false,extra={}){
 let s=create({chassis,motor:chassis==='chassis_quadruped'?'motor_high':'motor_standard',...(blade?{accessory:'tool_blade'}:{}),...extra});
 if(carry){s=go(s,38);s=send(s,{kind:'pickup',objectId:'cargo'});s=wait(s);assert.equal(s.cargo.carried.length,1);}
 s=go(s,47);s=send(s,{kind:'work'});s=wait(s);assert.equal(s.environment.stationUsed,true);assert.ok(s.energyRestoredUnits>0);
 s=go(s,54);s=send(s,{kind:'route',sectionId:'bridge',route:bridge});
 s=go(s,84.1);s=send(s,{kind:'work'});s=wait(s);assert.equal(s.environment.removed.debris,1);
 if(carry){s=go(s,95);s=send(s,{kind:'deliver',zoneId:'delivery',cargoIds:['cargo']});s=wait(s);}
 s=go(s,100);assert.equal(s.phase,'succeeded');assert.equal(s.result.score.cargoBonus,carry?2000:0);
 assert.ok(Math.abs(s.energyRemainingUnits+s.energyConsumedUnits-s.energyRestoredUnits-s.parameters.batteryCapacityUnits)<1e-6);
 assert.deepEqual(s.result.score,scoreChallenge(s.challenge,'succeeded',challengePerformance(s)));
 runs.push({chassis,carry,bridge,blade,time:s.elapsedSeconds,energy:s.energyRemainingUnits,maxTiltDegrees:stability.get(s.sessionId),score:s.result.score});
 return s;
}
let completed;
for(const chassis of ['chassis_wheel','chassis_track','chassis_quadruped'])check(chassis+' complete real drive, cargo, charging, clearing',()=>{completed=complete(chassis,true,chassis==='chassis_quadruped'?'direct':'bypass');});
check('heavy quadruped with large battery and blade stays upright through sand and arch',()=>{
 const s=complete('chassis_quadruped',true,'direct',true,{battery:'battery_large'});
 assert.equal(s.parameters.massKg,114);
 // A moving gait can temporarily place the COM outside its contact triangle.
 // Check actual tilt over the whole trip, including the loaded arch crossing.
 assert.ok(stability.get(s.sessionId)<12,JSON.stringify({maxTiltDegrees:stability.get(s.sessionId),peak:peakPoses.get(s.sessionId)}));
 assert.equal(s.quadruped.overturnedSeconds,0);
});
check('blade halves clearing time and works with a full cargo hold',()=>{
 const config=mission.recommendedConfiguration,env=E.createEnvironmentState(config);
 const hand=E.beginWork(mission.environment,env,config,86,0,8,25,10);
 const blade=E.beginWork(mission.environment,env,{...config,accessory:'tool_blade'},86,0,25,25,10);
 assert.equal(hand.work.duration,2);assert.equal(blade.work.duration,1);
 assert.equal(E.beginWork(mission.environment,env,config,86,0,25,25,10),null);
});
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
mkdirSync('docs/evidence/single-map',{recursive:true});writeFileSync('docs/evidence/single-map/domain.json',JSON.stringify({checks,bridgeRuns,runs},null,2));
console.log(JSON.stringify(runs,null,2));
