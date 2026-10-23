import * as THREE from 'three';
import type { MissionDefinition } from '../domain/mission/definition';
import { createTerrainSampler } from '../domain/simulation/terrain';
import type { TerrainSampler } from '../domain/simulation/terrain';
import { bypassBounds, hasBypass, routePose, senseEnvironment, routePresentation } from '../domain/simulation/environment';
import type { EnvironmentState, RouteSection } from '../domain/simulation/environment';
import { ModelKit } from './ModelKit';

function strip(kit: ModelKit, parent: THREE.Object3D, mission: MissionDefinition, s: RouteSection,
  route: 'direct'|'bypass', terrain: TerrainSampler, low: number, high: number, lift: number, material: THREE.Material, solid=false): void {
  const geometry=kit.geometry(['route-v4',mission.id,s.id,route,low,high,lift,solid].join(':'),()=>{
    const vertices:number[]=[], indices:number[]=[];
    const bounds=route==='bypass'?bypassBounds(s):{startM:s.startM,endM:s.endM};
    const count=Math.max(100,Math.ceil((bounds.endM-bounds.startM)*25));
    for(let i=0;i<=count;i++){
      const x=bounds.startM+(bounds.endM-bounds.startM)*i/count,p=routePose(mission.environment!.sections,{[s.id]:route},terrain,x);
      const n=new THREE.Vector3(-p.dz,0,1).normalize();
      for(const side of [low,high]){
        const px=x+n.x*side, pz=p.zM+n.z*side;
        vertices.push(px,p.heightM+lift,pz);
        if(solid)vertices.push(px,terrain.sample(x).heightM-.09,pz);
      }
      if(i){const k=i*(solid?4:2);
        if(solid){
          indices.push(k-4,k,k-2,k-2,k,k+2); // top
          indices.push(k-4,k-3,k,k-3,k+1,k); // near skirt
          indices.push(k-2,k+2,k-1,k-1,k+2,k+3); // far skirt
        }else indices.push(k-2,k,k-1,k-1,k,k+1);
      }
    }
    // Match Three.js front-face winding: the road top faces +Y.
    for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
  });
  kit.mesh(parent,geometry,material,[0,0,0]);
}
// Short branches use a paved turning apron: a ribbon wider than its turn radius
// folds over itself. The convex boundary contains the full swept road width.
function turningApron(kit:ModelKit,parent:THREE.Object3D,mission:MissionDefinition,s:RouteSection,terrain:TerrainSampler,width:number,material:THREE.Material):void {
  const points:THREE.Vector2[]=[];
  const bounds=bypassBounds(s);
  for(let i=0;i<=240;i++){
    const x=bounds.startM+(bounds.endM-bounds.startM)*i/240,p=routePose(mission.environment!.sections,{[s.id]:'bypass'},terrain,x),n=new THREE.Vector2(-p.dz,1).normalize();
    for(const side of [-width,width])points.push(new THREE.Vector2(x+n.x*side,p.zM+n.y*side));
  }
  points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=(values:THREE.Vector2[])=>{const result:THREE.Vector2[]=[];for(const p of values){while(result.length>1&&cross(result[result.length-2],result[result.length-1],p)<=0)result.pop();result.push(p)}result.pop();return result};
  const hull=[...half(points),...half([...points].reverse())];
  const geometry=kit.geometry('turning-apron:'+mission.id+':'+s.id,()=>{
    const vertices:number[]=[],indices:number[]=[];
    for(const p of hull)vertices.push(p.x,terrain.sample(p.x).heightM+.018,p.y);
    for(let i=1;i<hull.length-1;i++)indices.push(0,i+1,i);
    const topCount=vertices.length/3;
    for(let i=0;i<hull.length;i++){
      const a=hull[i],b=hull[(i+1)%hull.length],k=vertices.length/3;
      vertices.push(a.x,terrain.sample(a.x).heightM+.018,a.y,a.x,terrain.sample(a.x).heightM-.09,a.y,b.x,terrain.sample(b.x).heightM+.018,b.y,b.x,terrain.sample(b.x).heightM-.09,b.y);
      indices.push(k,k+2,k+1,k+1,k+2,k+3);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();g.userData.topVertexCount=topCount;return g;
  });
  kit.mesh(parent,geometry,material,[0,0,0]);
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length],dx=b.x-a.x,dz=b.y-a.y,x=(a.x+b.x)/2;
    kit.box(parent,[Math.hypot(dx,dz),.016,.06],[x,terrain.sample(x).heightM+.038,(a.y+b.y)/2],kit.materials.orange,[0,-Math.atan2(dz,dx),0]);
  }
}
function arrow(kit:ModelKit,parent:THREE.Object3D,x:number,y:number,z:number,dz:number,material:THREE.Material):void {
  const a=new THREE.Group();a.name='route-arrow';a.position.set(x,y,z);a.rotation.y=-Math.atan(dz);
  // The chevron tip faces local +X, then follows the road tangent toward the finish.
  for(const side of [-1,1])kit.box(a,[.48,.018,.09],[.06,0,side*.14],material,[0,side*.65,0]);
  parent.add(a);
}
export function createEnvironmentView(kit:ModelKit, mission:MissionDefinition): THREE.Group {
  const group=new THREE.Group();group.name='route-environment';
  if(!mission.environment)return group;
  const def=mission.environment, terrain=createTerrainSampler(mission.terrain), mat=kit.materials;
  for(const s of def.sections){
    for(const route of ['direct','bypass'] as const){
      if(!hasBypass(s)&&route==='bypass')continue;
      const road=new THREE.Group();road.name='route:'+s.id+':'+route;group.add(road);
      const width=route==='bypass'?1.55:2.4;
      const surface=route==='bypass'?mat.ground:s.kind==='soil'?mat.soil:s.kind==='bridge'&&s.severity>0?mat.paint:mat.ground;
      const bounds=route==='bypass'?bypassBounds(s):{startM:s.startM,endM:s.endM};
      const apron=route==='bypass'&&Array.from({length:241},(_,i)=>routePose(def.sections,{[s.id]:route},terrain,bounds.startM+(bounds.endM-bounds.startM)*i/240)).some(p=>Math.abs(p.curvature)*width>.9);
      if(apron)turningApron(kit,road,mission,s,terrain,width,surface);
      else {
        strip(kit,road,mission,s,route,terrain,-width,width,.025,surface,true);
        for(const side of [-1,1])strip(kit,road,mission,s,route,terrain,side*width-.035,side*width+.035,.043,route==='bypass'?mat.orange:mat.steel);
      }
      const selected=new THREE.Group();selected.name='route-selected:'+s.id+':'+route;selected.visible=false;group.add(selected);
      if(apron)strip(kit,selected,mission,s,route,terrain,-.05,.05,.052,mat.cyan);
      else for(const side of [-1,1])strip(kit,selected,mission,s,route,terrain,side*(width-.16)-.045,side*(width-.16)+.045,.052,mat.cyan);
      for(let i=1;i<8;i++){
        const x=bounds.startM+(bounds.endM-bounds.startM)*i/8,p=routePose(def.sections,{[s.id]:route},terrain,x);
        arrow(kit,route==='bypass'?road:selected,x,p.heightM+.065,p.zM,p.dz,route==='bypass'?mat.orange:mat.cyan);
      }
    }
    const preview=new THREE.Group();preview.name='sense:'+s.id;preview.visible=false;
    for(const x of [s.startM,s.endM])kit.box(preview,[.12,.035,4],[x,terrain.sample(x).heightM+.08,0],mat.cyan);
    group.add(preview);
    // Short signs mark both approaches; their surfaces stay away from the driving line.
    const signBounds=s.kind==='charger'?{startM:s.startM,endM:s.endM}:bypassBounds(s);
    for(const x of [signBounds.startM-.7,signBounds.endM+.7]){
      const y=terrain.sample(x).heightM;
      kit.box(group,[.08,.65,.08],[x,y+.325,-2.65],mat.dark);
      kit.label(group,s.label,1.6,.3,[x,y+.85,-2.65]);
      const sign=kit.label(group,(hasBypass(s)?'旁路 +'+s.extraM+'m':s.kind==='charger'?'停车充能':s.kind==='soil'?'全底盘减速 · 无旁路':'停车清理 · 无旁路'),1.7,.3,[x,y+.48,-2.65],'#ffdd9b','#263c49');sign.name='junction-sign:'+s.id;
    }
    if(s.kind==='soil')for(let i=0;i<24;i++){
      const x=s.startM+(s.endM-s.startM)*(i+.5)/24;
      kit.box(group,[.25,.008,.18],[x,terrain.sample(x).heightM+.035,(i%5-2)*.65],mat.dark,[0,i*.4,0]);
    }
    if(s.kind==='bridge') {
      for (const [x, direction] of [[signBounds.startM, '↑'], [signBounds.endM, '↓']] as const) {
        const y=terrain.sample(x).heightM;
        kit.box(group,[.16,3,.16],[x,y+1.5,-3.4],mat.dark);
        const sign=kit.label(group,direction+' 四足翻桥 / 平地旁路',4,.65,[x,y+3.3,-3.4],'#ffe0a0','#263c49');
        sign.name='bridge-route-reminder:'+x;
        kit.label(group,'分岔减速选路 · 旁路 +'+s.extraM+' m',3.8,.45,[x,y+2.65,-3.4]);
      }
      for(let i=0;i<=24;i++) {
        const x=s.startM+(s.endM-s.startM)*i/24,p=routePose(def.sections,{},terrain,x);
        kit.box(group,[.035,.012,4.65],[x,p.heightM+.04,0],i%4===0?mat.orange:mat.steel,[0,0,Math.atan(p.slope)]);
      }
      for(const side of [-1,1])for(let i=0;i<24;i++) {
        const x=s.startM+(s.endM-s.startM)*i/24, end=x+(s.endM-s.startM)/24;
        const a=routePose(def.sections,{},terrain,x),b=routePose(def.sections,{},terrain,end);
        kit.beam(group,[x,a.heightM+.30,side*2.35],[end,b.heightM+.30,side*2.35],.065,mat.orange);
        if(i%4===0)kit.box(group,[.07,.3,.07],[x,a.heightM+.15,side*2.35],mat.steel);
      }
    }
    if(s.kind==='debris')for(let i=0;i<s.pieces!;i++){
      const object=new THREE.Group();object.name='debris:'+s.id+':'+i;
      const x=(s.startM+s.endM)/2;
      object.position.set(x,terrain.sample(x).heightM+.67,0);
      object.userData.roadHeightM=object.position.y;
      kit.box(object,[1.7,1.3,3.4],[0,0,0],mat.orange);
      for(const z of [-1.1,1.1])kit.box(object,[1.74,1.34,.10],[0,0,z],mat.dark);
      kit.box(object,[1.78,.09,3.48],[0,.68,0],mat.steel);
      kit.label(object,'碎料箱 · 停车清理',1.55,.3,[0,.96,0]);
      group.add(object);
    }
    if(s.kind==='charger'){
      const p=routePose(def.sections,{[s.id]:'direct'},terrain,(s.startM+s.endM)/2);
      kit.box(group,[1,.06,1.8],[p.xM,p.heightM+.055,p.zM],mat.cyan);
      kit.box(group,[.4,1.2,.4],[p.xM,p.heightM+.6,p.zM+2.1],mat.dark);
      kit.label(group,'充电 +10',1.4,.3,[p.xM,p.heightM+1.4,p.zM+2.1],'#76eeed','#263c49');
    }
  }
  return group;
}
export function updateEnvironmentView(world:THREE.Object3D, mission:MissionDefinition, env:EnvironmentState|null,xM=0,speedMps=0):void {
  const sensed=env&&mission.environment?senseEnvironment(mission.environment,env,xM,speedMps<-.1?-1:1):null;
  const presentation=env&&mission.environment?routePresentation(mission.environment,env,xM):null;
  for(const s of mission.environment?.sections??[]){
    const preview=world.getObjectByName('sense:'+s.id);if(preview)preview.visible=sensed?.section.id===s.id;
    for(const route of ['direct','bypass']){
      const selected=world.getObjectByName('route-selected:'+s.id+':'+route);
      if(selected)selected.visible=!!env&&presentation?.section?.id===s.id&&(env.choices[s.id]??'direct')===route;
    }
    if(s.kind==='debris')for(let i=0;i<s.pieces!;i++){
      const object=world.getObjectByName('debris:'+s.id+':'+i);if(!object)continue;
      const cleared=i<(env?.removed[s.id]??0);
      object.position.z=cleared?-4.5:0;
      object.position.y=object.userData.roadHeightM-(cleared ? .15 : 0);
    }
  }
}

