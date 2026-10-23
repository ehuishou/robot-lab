import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {load} from './verification-loader.mjs';
const THREE=createRequire(import.meta.url)('three');
const {ModelKit}=load('src/render/ModelKit.ts');
const {TRANSPORT_MISSION:mission}=load('src/content/challenges.ts');
const {createEnvironmentView,updateEnvironmentView}=load('src/render/EnvironmentView.ts');
const {createTerrainSampler}=load('src/domain/simulation/terrain.ts');
const {routePose}=load('src/domain/simulation/environment.ts');
const {createEnvironmentState}=load('src/domain/simulation/environment.ts');
const kit=new ModelKit();
// Canvas labels are unrelated to road geometry; keep all road meshes real.
kit.label=(parent,text,width,height,position)=>{
 const label=new THREE.Group();label.position.set(...position);parent.add(label);return label;
};
const terrain=createTerrainSampler(mission.terrain),checks=[];
try {
 const world=createEnvironmentView(kit,mission);world.updateMatrixWorld(true);
 for(const section of mission.environment.sections){
  for(const route of ['direct','bypass']){
   const group=world.getObjectByName((route==='direct'?'route-selected:':'route:')+section.id+':'+route);
   if(!group)continue;
   const arrows=group.children.filter(child=>child.name==='route-arrow');
   assert.equal(arrows.length,7,section.id+':'+route+' arrow count');
   for(const arrow of arrows){
    const ends=arrow.children.map(arm=>[-1,1].map(side=>arm.localToWorld(new THREE.Vector3(side*arm.geometry.parameters.width/2,0,0))));
    let closest={distance:Infinity};
    for(let i=0;i<2;i++)for(let j=0;j<2;j++){
     const distance=ends[0][i].distanceTo(ends[1][j]);
     if(distance<closest.distance)closest={distance,i,j};
    }
    const tip=ends[0][closest.i].clone().add(ends[1][closest.j]).multiplyScalar(.5);
    const tail=ends[0][1-closest.i].clone().add(ends[1][1-closest.j]).multiplyScalar(.5);
    const direction=tip.sub(tail).normalize();
    const pose=routePose(mission.environment.sections,{[section.id]:route},terrain,arrow.position.x);
    const forward=new THREE.Vector3(1,0,pose.dz).normalize();
    assert.ok(direction.dot(forward)>.999,`${section.id}:${route} arrow at ${arrow.position.x} faces away from the finish`);
    assert.ok(direction.x>0,section.id+':'+route+' must point toward increasing map distance');
   }
   checks.push({section:section.id,route,arrows:arrows.length});
   console.log('PASS forward route arrows',section.id,route,arrows.length);
  }
 }
 assert.equal(checks.length,5);
 const initial=createEnvironmentState(mission.recommendedConfiguration);
 const debris=mission.environment.sections.find(section=>section.kind==='debris');
 const cleared={...initial,removed:{[debris.id]:debris.pieces}};
 for(const travelDirection of [-1,1]){
  updateEnvironmentView(world,mission,{...cleared,travelDirection},(debris.startM+debris.endM)/2,travelDirection);
  assert.equal(world.getObjectByName('route-selected:'+debris.id+':direct').visible,true);
  assert.equal(world.getObjectByName('debris:'+debris.id+':0').position.z,-4.5);
 }
 console.log('PASS cleared debris exposes forward road arrows in either travel direction');
 mkdirSync('docs/evidence/single-map',{recursive:true});
 writeFileSync('docs/evidence/single-map/route-markers.json',JSON.stringify({passed:true,checks},null,2));
} finally {kit.dispose();}
