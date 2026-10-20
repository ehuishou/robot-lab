import assert from 'node:assert/strict';
import * as THREE from 'three';
import {load} from './verification-loader.mjs';
const P=load('src/domain/simulation/quadruped.ts');
const {MODULES}=load('src/content/modules.ts');
import {PHYSICS_MISSIONS} from './physics-fixtures.mjs';
const RECOMMENDED_CONFIGURATION=PHYSICS_MISSIONS[0].recommendedConfiguration;
const {createTerrainSampler}=load('src/domain/simulation/terrain.ts');
const {createMissionSession,transitionSession,createRenderSnapshot}=load('src/domain/mission/session.ts');
const {PREVIEW_ASSETS}=load('src/content/assets.ts');
const {sandboxCatalog,sandboxMission}=load('src/testing/SandboxPolicy.ts');
const {DrivingSessionController}=load('src/app/DrivingSessionController.ts');
const configuration={...RECOMMENDED_CONFIGURATION,chassis:'chassis_quadruped'};
const dry=P.robotMassElements(configuration,MODULES,20),flat=createTerrainSampler(PHYSICS_MISSIONS[0].terrain);
const initial=()=>P.createQuadruped(dry,10,flat);
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,a+' != '+b);
function valid(s){
 assert.ok([...s.position,...s.orientation,...s.velocity,...s.angularVelocity].every(Number.isFinite));
 near(Math.hypot(...s.orientation),1);
 for(const f of s.feet){assert.ok(f.normalN>=0);assert.ok(f.frictionN<=P.FRICTION*f.normalN+1e-7);if(!f.planted)near(Math.hypot(...f.force),0);}
}
let s=initial(),loaded=P.updateQuadrupedMass(s,80);
near(loaded.mass.massKg,s.mass.massKg+80);assert.notDeepEqual(loaded.mass.center,s.mass.center);
assert.notDeepEqual(loaded.mass.inertia,s.mass.inertia);
P.bodyOrigin(s).forEach((value,i)=>near(value,P.bodyOrigin(loaded)[i]));
assert.deepEqual(P.updateQuadrupedMass(loaded,0).mass,s.mass);
console.log('PASS mass-weighted COM, inertia, loading/unloading without chassis teleport');
assert.ok(P.supportMargin([[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]],[0,1,0])>.99);
assert.ok(P.supportMargin([[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]],[2,1,0])<0);
let air={...s,position:[s.position[0],s.position[1]+5,s.position[2]]};
air=P.stepQuadruped(air,flat,0,1/60);near(air.velocity[1],-P.GRAVITY/60);assert.equal(air.feet.filter(f=>f.normalN>0).length,0);
const forced=P.constrainContact(new THREE.Vector3(100,-10,0),new THREE.Vector3(0,1,0),100);near(forced.length(),0);
const limited=P.constrainContact(new THREE.Vector3(1000,100,0),new THREE.Vector3(0,1,0),60,.2);near(limited.y,60);near(limited.x,12);
console.log('PASS unsupported free fall, unilateral contact, bounded actuator forces and friction cone');
for(let i=0;i<600;i++)s=P.stepQuadruped(s,flat,0,1/60);
valid(s);assert.ok(s.tiltDegrees<2);assert.ok(Math.hypot(...s.velocity)<.03);
near(s.feet.reduce((n,f)=>n+f.force[1],0),s.mass.massKg*P.GRAVITY,3);
console.log('PASS stationary gravity balance and damping');
let weak=P.perturbQuadruped(s,[0,0,s.mass.massKg*.45],[s.position[0],s.position[1]+.8,s.position[2]]);
assert.ok(Math.abs(weak.angularVelocity[0])>.1);
for(let i=0;i<600;i++)weak=P.stepQuadruped(weak,flat,0,1/60);
valid(weak);assert.notEqual(weak.status,'fallen');assert.ok(weak.tiltDegrees<3);
let fall=P.perturbQuadruped(s,[0,0,s.mass.massKg*6],[s.position[0],s.position[1]+.8,s.position[2]]),maxTilt=0,contacts=0;
for(let i=0;i<720;i++){fall=P.stepQuadruped(fall,flat,0,1/60);valid(fall);maxTilt=Math.max(maxTilt,fall.tiltDegrees);contacts=Math.max(contacts,fall.bodyContactCount);}
assert.ok(maxTilt>60);assert.ok(contacts>0);assert.equal(fall.status,'fallen');assert.ok(Math.hypot(...fall.velocity)<.1);assert.ok(fall.bodyNormalN>0);
console.log('PASS small-push recovery, torque impulse, actual fall, chassis impact and rest');
let a=initial(),b=initial();for(let i=0;i<240;i++)a=P.stepQuadruped(a,flat,1,1/60);for(let i=0;i<480;i++)b=P.stepQuadruped(b,flat,1,1/120);
a.position.forEach((x,i)=>near(x,b.position[i],1e-8));
console.log('PASS identical integration at 60/120Hz');
let sequence=0;
function command(state,detail){const r=transitionSession(state,{sessionId:state.sessionId,commandId:'q'+ ++sequence,...detail});assert.ok(r.accepted,r.reason);return r.state;}
function session(mission=PHYSICS_MISSIONS[0],config=configuration){return createMissionSession('physics',sandboxMission(mission),config,sandboxCatalog(MODULES),PREVIEW_ASSETS).state;}
for(const mission of PHYSICS_MISSIONS){
 let state=session(mission),max=0;
 for(let i=0;i<900;i++){
  state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:1,brake:false}});valid(state.quadruped);max=Math.max(max,state.quadruped.tiltDegrees);assert.notEqual(state.quadruped.status,'fallen');
 }
 assert.ok(state.xM>30);const forwardX=state.xM;
 for(let i=0;i<360;i++)state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:0,brake:true}});
 assert.ok(Math.abs(state.speedMps)<.08,'brake '+state.speedMps);
 for(let i=0;i<180;i++)state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:-1,brake:false}});
 assert.ok(state.speedMps<-.3,JSON.stringify({speed:state.speedMps,pose:state.quadruped}));assert.ok(state.xM<forwardX+1);
 console.log('PASS '+mission.id+': physical forward/braking/reverse, max tilt '+max.toFixed(1)+'deg');
}
let state=session();
// Establish real stance anchors before applying the repeatable external impulse.
for(let i=0;i<120;i++)state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:0,brake:true}});
state=command(state,{kind:'physicsTest',action:'topple'});
for(let i=0;i<900;i++)state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:0,brake:true}});
assert.equal(state.quadruped.status,'fallen');assert.equal(state.phase,'running');
const paused=command(state,{kind:'pause'}),before=JSON.stringify(paused.quadruped);
assert.equal(transitionSession(paused,{sessionId:paused.sessionId,commandId:'paused-step',kind:'drive',deltaSeconds:1/60,intent:{throttle:1,brake:false}}).accepted,false);
assert.equal(JSON.stringify(paused.quadruped),before);
state=command(command(paused,{kind:'resume'}),{kind:'physicsTest',action:'reset'});assert.equal(state.quadruped.status,'balanced');assert.equal(state.quadruped.overturnedSeconds,0);
assert.equal(createRenderSnapshot(state).robot.quadruped,state.quadruped);
let normal={...session(),mission:{...session().mission,testMode:false}};
assert.equal(transitionSession(normal,{sessionId:'physics',commandId:'denied-push',kind:'physicsTest',action:'push'}).accepted,false);
for(let i=0;i<120;i++)normal=command(normal,{kind:'drive',deltaSeconds:1/60,intent:{throttle:0,brake:true}});
normal={...normal,quadruped:P.perturbQuadruped(normal.quadruped,[0,0,normal.quadruped.mass.massKg*4],[normal.quadruped.position[0],normal.quadruped.position[1]+.8,normal.quadruped.position[2]])};
for(let i=0;i<900 && !normal.result;i++)normal=command(normal,{kind:'drive',deltaSeconds:1/60,intent:{throttle:0,brake:true}});
assert.equal(normal.result?.failure,'overturned');
console.log('PASS immutable session snapshots, pause, test-mode recovery and normal-mode fall failure');

let configurations=0;
for(const motor of MODULES.filter(m=>m.category==='motor'))for(const battery of MODULES.filter(m=>m.category==='battery'))for(const sensor of MODULES.filter(m=>m.category==='sensor'))for(const tool of MODULES.filter(m=>m.category==='tool')){
 let test=session(PHYSICS_MISSIONS[0],{...configuration,motor:motor.id,battery:battery.id,sensor:sensor.id,tool:tool.id});
 for(let i=0;i<360;i++){test=command(test,{kind:'drive',deltaSeconds:1/60,intent:{throttle:i<240?1:0,brake:i>=240}});valid(test.quadruped);assert.notEqual(test.quadruped.status,'fallen',JSON.stringify(test.configuration));}
 assert.ok(test.xM>2,JSON.stringify(test.configuration)); configurations++;
}
console.log('PASS '+configurations+' quadruped configurations: finite dynamics, driving and brake stability');
let ice=initial();
for(let i=0;i<120;i++)ice=P.stepQuadruped(ice,flat,3,1/60,0);
assert.ok(Math.abs(ice.velocity[0])<1e-8);assert.ok(ice.feet.every(f=>f.frictionN<1e-8));
console.log('PASS zero friction cannot produce propulsion');

// Verify actual frozen controller state stays unchanged during paused wall-clock time.
const controller=new DrivingSessionController(session());controller.advanceFrame(0);controller.input.setAction('test','forward',true);
for(let i=1;i<121;i++)controller.advanceFrame(i*1000/60);
controller.pause();const stopped=JSON.stringify(controller.state.quadruped);controller.advanceFrame(100000);assert.equal(JSON.stringify(controller.state.quadruped),stopped);
controller.resume();controller.advanceFrame(100001);assert.equal(JSON.stringify(controller.state.quadruped),stopped);
console.log('PASS controller pause/resume discards wall-clock debt');
// Actual loading transition shifts mass in the same command, not just diagnostics.
function driveTo(state, target) {
 for(let i=0;i<6000;i++) {
  const dx=target-state.xM, speed=state.speedMps;
  if(Math.abs(dx)<.23 && Math.abs(speed)<.16)return state;
  const brake=Math.abs(dx)<speed*speed/7+.15 || speed*Math.sign(dx)<-.1;
  state=command(state,{kind:'drive',deltaSeconds:1/60,intent:{throttle:brake?0:Math.sign(dx),brake}});
 }
 assert.fail('Did not stop at '+target);
}
let cargo=driveTo(session(),PHYSICS_MISSIONS[0].layout.find(x=>x.kind==='cargo').xM);
const massBefore=cargo.quadruped.mass.massKg;
cargo=command(cargo,{kind:'pickup',objectId:cargo.mission.layout.find(x=>x.kind==='cargo').id});
assert.ok(cargo.quadruped.mass.massKg>massBefore);
for(let i=0;i<240;i++){cargo=command(cargo,{kind:'drive',deltaSeconds:1/60,intent:{throttle:1,brake:false}});valid(cargo.quadruped);assert.notEqual(cargo.quadruped.status,'fallen');}
cargo=driveTo(cargo,PHYSICS_MISSIONS[0].layout.find(x=>x.kind==='deliveryZone').xM);
cargo=command(cargo,{kind:'deliver',zoneId:cargo.mission.layout.find(x=>x.kind==='deliveryZone').id,cargoIds:cargo.cargo.carried.map(x=>x.id)});
near(cargo.quadruped.mass.massKg,massBefore);
console.log('PASS pickup and delivery update authoritative physical mass');

const {ChassisAnimation}=load('src/render/ChassisAnimation.ts');
const {UPPER_LEG,LOWER_LEG}=load('src/render/Locomotion.ts');
const robot=new THREE.Group();robot.userData.chassisRig={wheels:[],tracks:[],legs:[]};
for(const side of [-1,1])for(const direction of [-1,1]){
 const upper=new THREE.Mesh(),lower=new THREE.Mesh(),joint=new THREE.Mesh(),foot=new THREE.Mesh();robot.add(upper,lower,joint,foot);
 robot.userData.chassisRig.legs.push({hip:[direction*.68,.7,side*.49],side,direction,offset:side<0?(direction<0?0:.25):(direction<0?.5:.75),upper,lower,joint,foot});
}
const animation=new ChassisAnimation(robot);
let visual=P.perturbQuadruped(initial(),[0,0,initial().mass.massKg*4],[initial().position[0],initial().position[1]+.8,initial().position[2]]);
for(let i=0;i<600;i++){
 visual=P.stepQuadruped(visual,flat,0,1/60);robot.position.set(...P.bodyOrigin(visual));robot.quaternion.set(...visual.orientation);animation.update(robot.position.x,flat,visual);
 for(const foot of animation.diagnostics.feet){
   const length=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));near(length(foot.hip,foot.knee),UPPER_LEG);near(length(foot.knee,foot.ankle),LOWER_LEG);
 }
}
assert.ok(visual.feet.every(f=>f.position[1]>-.04));
console.log('PASS real animation adapter through overturning: finite transforms, rigid bone lengths, folded feet above terrain');
