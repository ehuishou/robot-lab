import assert from 'node:assert/strict';
import * as THREE from 'three';
import {load} from './verification-loader.mjs';
const {trackPose, TRACK_LENGTH, TRACK_HALF_LENGTH, TRACK_RADIUS, STRIDE, STANCE, footPose, kneePosition, UPPER_LEG, LOWER_LEG}=load('src/render/Locomotion.ts');
const {ChassisAnimation}=load('src/render/ChassisAnimation.ts');
const {createTerrainSampler}=load('src/domain/simulation/terrain.ts');
const {MODULES}=load('src/content/modules.ts');
import {PHYSICS_MISSIONS} from './physics-fixtures.mjs';
const RECOMMENDED_CONFIGURATION=PHYSICS_MISSIONS[0].recommendedConfiguration;
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,a+' != '+b);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
for(let s=-20;s<20;s+=.013){
  const a=trackPose(s),b=trackPose(s+TRACK_LENGTH);near(a.x,b.x);near(a.y,b.y);
  const next=trackPose(s+1e-5);near(Math.hypot(next.x-a.x,next.y-a.y),1e-5,1e-8);
}
const bottom=2*TRACK_HALF_LENGTH+Math.PI*TRACK_RADIUS+.4;
near(trackPose(bottom+.01).x-trackPose(bottom).x,-.01);
console.log('PASS continuous closed tracks; arc-length speed; ground run cancels forward travel');
for(const mission of PHYSICS_MISSIONS){
  const terrain=createTerrainSampler(mission.terrain);
  let previous=new Map(),checked=0;
  for(let x=-1;x<=101;x+=.025){
    let support=0;
    const pitch=terrain.sample(x).slopeDegrees*Math.PI/180;
    const robot=new THREE.Matrix4().compose(new THREE.Vector3(x,terrain.sample(x).heightM,.4),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),pitch),new THREE.Vector3(1,1,1)).invert();
    for(const side of [-1,1])for(const dir of [-1,1]){
      const offset=side<0?(dir<0?0:.25):(dir<0?.5:.75);
      const foot=footPose(x,0,dir*.68,offset);
      if(foot.planted)support++;
      const prev=previous.get(offset);
      if(prev?.planted&&foot.planted&&Math.abs(foot.phase-prev.phase)<.1)near(foot.xM,prev.xM);
      previous.set(offset,foot);
      const sample=terrain.sample(foot.xM),slope=sample.slopeDegrees*Math.PI/180;
      const ankle=new THREE.Vector3(foot.xM-.08*Math.sin(slope),sample.heightM+foot.liftM+.08*Math.cos(slope),.4+side*1.03).applyMatrix4(robot).toArray();
      const hip=[dir*.68,.7,side*.49],knee=kneePosition(hip,ankle,-dir);
      near(distance(hip,knee),UPPER_LEG);near(distance(knee,ankle),LOWER_LEG);
      assert.ok(foot.liftM>=0);checked++;
    }
    assert.ok(support>=3,'insufficient ground contacts');
  }
  console.log('PASS '+mission.id+': '+checked+' IK targets; fixed link lengths; planted feet never slide; 3+ supports');
}
// Exercise the real animation adapter with Three transforms: forward, stationary, reverse, restart.
const robot=new THREE.Group();
const wheel=new THREE.Group(),track=new THREE.Mesh();robot.add(wheel,track);
robot.userData.chassisRig={wheels:[{object:wheel,radius:.38}],tracks:[{object:track,offset:0}],legs:[]};
const animator=new ChassisAnimation(robot),flat=createTerrainSampler(PHYSICS_MISSIONS[0].terrain);
for(const x of [0,1,2])animator.update(x,flat);
near(wheel.rotation.z,-2/.38);const still=JSON.stringify(animator.diagnostics);
animator.update(2,flat);assert.equal(JSON.stringify(animator.diagnostics),still);
animator.update(1,flat);near(wheel.rotation.z,-1/.38);
animator.reset();animator.update(20,flat);near(wheel.rotation.z,0);
console.log('PASS real render adapter: displacement-driven rotation, stopped pose, reverse and reset');
