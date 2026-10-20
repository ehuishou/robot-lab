import { Quaternion, Vector3 } from 'three';
import type { Configuration, ModuleDefinition } from '../config/validateConfiguration';
import type { TerrainSampler } from './terrain';
import { footPose } from './locomotion';

// SI units; +Y up, +X travel. Centroidal rigid body with massless actuated legs.
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
const v = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]);
const tuple = (a: Vector3): V3 => [a.x, a.y, a.z];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const GRAVITY = 9.81;
export const FRICTION = 0.75;
export const PHYSICS_STEP = 1 / 240;
export interface MassElement { massKg: number; position: V3; halfExtents?: V3 }
export interface BodyMass { massKg: number; center: V3; inertia: V3 }
export interface FootContact {
  side: number; direction: number; offset: number; phase: number;
  position: V3; force: V3; normalN: number; frictionN: number;
  planted: boolean; slipping: boolean;
}
export interface QuadrupedPath { project(x:number,z:number):number; sample(xM: number): { zM: number; dz: number; curvature: number } }
export interface QuadrupedState {
  position: V3; orientation: Q4; velocity: V3; angularVelocity: V3;
  mass: BodyMass; dryMass: readonly MassElement[]; originXM: number; laneZM: number; travelM: number; gaitM: number;
  feet: readonly FootContact[]; supportMarginM: number; tiltDegrees: number;
  bodyContactCount: number; bodyNormalN: number; overturnedSeconds: number;
  status: 'balanced' | 'unstable' | 'tipping' | 'fallen';
}
export function massProperties(elements: readonly MassElement[]): BodyMass {
  const massKg = elements.reduce((sum, item) => sum + item.massKg, 0);
  if (!(massKg > 0) || elements.some(e => !Number.isFinite(e.massKg) || e.massKg < 0 || !e.position.every(Number.isFinite))) throw new RangeError('Invalid body mass');
  const center = elements.reduce((sum, e) => sum.addScaledVector(v(e.position), e.massKg / massKg), new Vector3());
  // Finite local box inertia plus parallel-axis contributions from modules and cargo.
  const inertia = new Vector3();
  for (const e of elements) {
    const r = v(e.position).sub(center);
    inertia.x += e.massKg * (0.10 + r.y ** 2 + r.z ** 2);
    inertia.y += e.massKg * (0.18 + r.x ** 2 + r.z ** 2);
    inertia.z += e.massKg * (0.18 + r.x ** 2 + r.y ** 2);
  }
  return { massKg, center: tuple(center), inertia: tuple(inertia) };
}
export function robotMassElements(configuration: Configuration, catalog: readonly ModuleDefinition[], baseMassKg: number): MassElement[] {
  const positions: Record<string, V3> = { chassis: [0, .65, 0], motor: [-.28, 1.42, .67], battery: [-.57, 1.49, 0], sensor: [-.83, 1.95, -.26], accessory: [1.35, .4, 0], tool: configuration.tool === 'tool_arm' ? [.65, 1.95, 0] : configuration.tool === 'tool_blade' ? [1.35, .4, 0] : [1.15, 1.45, 0] };
  const sizes: Record<string,V3> = { chassis:[.95,.16,.58], motor:[.27,.24,.23], battery:[.4,.2,.35], sensor:[.2,.2,.25], accessory:[.4,.4,.9], tool:configuration.tool === 'tool_arm'?[.7,.7,.25]:configuration.tool === 'tool_blade'?[.4,.4,.9]:[.65,.2,.4] };
  return [{ massKg: baseMassKg, position: [0, .95, 0], halfExtents:[.95,.45,.58] }, ...catalog.filter(m => configuration[m.category] === m.id).map(m => ({ massKg: m.massKg, position: positions[m.category], halfExtents: sizes[m.category] }))];
}
export function bodyOrigin(state: Pick<QuadrupedState, 'position' | 'orientation' | 'mass'>): V3 {
  return tuple(v(state.position).sub(v(state.mass.center).applyQuaternion(new Quaternion(...state.orientation))));
}
export function createQuadruped(dryMass: readonly MassElement[], xM: number, terrain: TerrainSampler, cargoKg = 0): QuadrupedState {
  const mass = massProperties([...dryMass, { massKg: cargoKg, position: [0, 1.1, 0] }]);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan(terrain.sample(xM).slope));
  return { position: tuple(v(mass.center).applyQuaternion(q).add(new Vector3(xM, terrain.sample(xM).heightM, .4))), orientation: q.toArray() as Q4,
    velocity: [0, 0, 0], angularVelocity: [0, 0, 0], mass, dryMass, originXM: xM, laneZM: .4, travelM: 0, gaitM: 0,
    feet: [], supportMarginM: 0, tiltDegrees: 0, bodyContactCount: 0, bodyNormalN: 0, overturnedSeconds: 0, status: 'balanced' };
}
export function updateQuadrupedMass(state: QuadrupedState, cargoKg: number): QuadrupedState {
  const mass = massProperties([...state.dryMass, { massKg: cargoKg, position: [0, 1.1, 0] }]);
  if (mass.massKg === state.mass.massKg) return state;
  const q = new Quaternion(...state.orientation);
  const delta = v(mass.center).sub(v(state.mass.center)).applyQuaternion(q);
  return { ...state, mass, position: tuple(v(state.position).add(delta)), velocity: tuple(v(state.velocity).add(v(state.angularVelocity).cross(delta))) };
}
// Signed distance of COM projection from the convex support polygon (negative outside).
export function supportMargin(points: readonly V3[], center: V3): number {
  if (points.length < 3) return -1;
  const sorted = [...points].sort((a,b) => a[0] - b[0] || a[2] - b[2]);
  const cross = (a: V3,b: V3,c: V3) => (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
  const half = (input: V3[]) => { const out: V3[]=[]; for(const p of input) { while(out.length>=2 && cross(out[out.length-2],out[out.length-1],p)<=0) out.pop(); out.push(p); } return out; };
  const lo=half(sorted), hi=half([...sorted].reverse()); const hull=[...lo.slice(0,-1),...hi.slice(0,-1)];
  if(hull.length<3) return -1;
  return Math.min(...hull.map((p,i) => { const n=hull[(i+1)%hull.length];return cross(p,n,center)/Math.hypot(n[0]-p[0],n[2]-p[2]); }));
}
function normalAt(x: number, terrain: TerrainSampler): Vector3 { return new Vector3(-terrain.sample(x).slope, 1, 0).normalize(); }
// Unilateral support and Coulomb friction cone; no attractive ground forces.
export function constrainContact(force: Vector3, normal: Vector3, maxNormal: number, friction = FRICTION): Vector3 {
  const n = clamp(force.dot(normal), 0, maxNormal);
  const tangent = force.clone().addScaledVector(normal, -force.dot(normal));
  if(tangent.length()>friction*n) tangent.setLength(friction*n);
  return tangent.addScaledVector(normal,n);
}
export function perturbQuadruped(state: QuadrupedState, impulse: V3, point: V3): QuadrupedState {
  if (![...impulse,...point].every(Number.isFinite)) throw new RangeError('Invalid impulse');
  const q=new Quaternion(...state.orientation), inv=q.clone().invert();
  const angular=v(point).sub(v(state.position)).cross(v(impulse)).applyQuaternion(inv).divide(v(state.mass.inertia)).applyQuaternion(q);
  return {...state, velocity:tuple(v(state.velocity).addScaledVector(v(impulse),1/state.mass.massKg)), angularVelocity:tuple(v(state.angularVelocity).add(angular))};
}
export function stepQuadruped(state: QuadrupedState, terrain: TerrainSampler, targetSpeed: number, dt: number, friction = FRICTION, acceleration = 0, path?: QuadrupedPath): QuadrupedState {
  if(!Number.isFinite(dt)||dt<=0||dt>1/30||!Number.isFinite(targetSpeed)||!Number.isFinite(friction)||friction<0||!Number.isFinite(acceleration)) throw new RangeError('Invalid physics step');
  let next=state;
  const steps=Math.ceil(dt/PHYSICS_STEP), h=dt/steps;
  for(let i=0;i<steps;i++) next=substep(next,terrain,targetSpeed,h,friction,acceleration,path);
  return next;
}
function substep(s: QuadrupedState, terrain: TerrainSampler, targetSpeed: number, dt: number, friction: number, acceleration: number, path?: QuadrupedPath): QuadrupedState {
  const p=v(s.position), q=new Quaternion(...s.orientation), vel=v(s.velocity), omega=v(s.angularVelocity), origin=v(bodyOrigin(s));
  const pathX=path?.project(origin.x,origin.z)??origin.x;
  const frame=path?.sample(pathX), planScale=Math.hypot(1,frame?.dz??0);
  const forward=new Vector3(1,0,frame?.dz??0).normalize(), lateral=new Vector3(-forward.z,0,forward.x);
  const pathYaw=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-Math.atan(frame?.dz??0));
  const forwardSpeed=vel.dot(forward), travel=s.gaitM;
  const strideScale=Math.abs(frame?.curvature??0)>.75?.22:1;
  const up=new Vector3(0,1,0).applyQuaternion(q), upright=up.dot(normalAt(origin.x,terrain));
  const active=upright>0.5 && s.status!=='fallen';
  const mass=s.mass.massKg, weight=mass*GRAVITY;
  const feet: FootContact[]=[];
  for(const side of [-1,1]) for(const direction of [-1,1]) {
    const offset=side<0?(direction<0?0:.25):(direction<0?.5:.75);
    const gait=footPose(travel,0,direction*.68,offset);
    // Stand on four planted feet while braking or operating a tool. A distance-driven
    // walking phase must not leave the stationary body balancing on swinging legs.
    const standing=Math.abs(targetSpeed)<.04 && Math.hypot(vel.x,vel.z)<.8;
    if(standing){gait.planted=true;gait.phase=-1;gait.liftM=0;gait.xM=travel+direction*.68;}
    const old=s.feet.find(f=>f.side===side&&f.direction===direction);
    // Keep anchors fixed during stance; replant at the next gait landing.
    const sameStance=!!old?.planted && gait.planted && Math.abs(old.phase-gait.phase)<.25;
    const along=direction*.68+(gait.xM-travel-direction*.68)*strideScale;
    // Land within reach of the actual body, rather than teleporting feet onto a
    // distant route target when the physical body lags behind a tight turn.
    const bodyForward=new Vector3(1,0,0).applyQuaternion(q);bodyForward.y=0;bodyForward.normalize();
    const bodyLateral=new Vector3(-bodyForward.z,0,bodyForward.x);
    const footCenter=origin.clone().addScaledVector(bodyForward,along).addScaledVector(bodyLateral,side*1.03);
    let position: V3=sameStance ? [...old!.position] : [footCenter.x, terrain.sample(footCenter.x).heightM+gait.liftM, footCenter.z];
    const hip=new Vector3(direction*.68,.7,side*.49).applyQuaternion(q).add(origin);
    let reachable=hip.distanceTo(v(position).add(new Vector3(0,.08,0)))<1.18;
    if(!active||!reachable) {
      // Detached feet fold with the body. No imaginary support beyond leg reach.
      const folded=new Vector3(direction*.72,.28,side*.86).applyQuaternion(q).add(origin);
      position=tuple(folded); reachable=false;
    }
    feet.push({side,direction,offset,phase:gait.phase,position,force:[0,0,0],normalN:0,frictionN:0,planted:active&&reachable&&gait.planted,slipping:false});
  }
  const contacts=feet.filter(f=>f.planted);
  const support=contacts.length ? contacts.reduce((a,f)=>a.add(v(f.position)),new Vector3()).multiplyScalar(1/contacts.length) : p.clone();
  const ground=terrain.sample(origin.x), desiredQ=pathYaw.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.atan(ground.slope/planScale)));
  const error=desiredQ.clone().multiply(q.clone().invert()); if(error.w<0) error.set(-error.x,-error.y,-error.z,-error.w);
  const desiredCenter=new Vector3(pathX,ground.heightM,frame?.zM??s.laneZM).add(v(s.mass.center).applyQuaternion(desiredQ));
  const lateralError=desiredCenter.clone().sub(p).dot(lateral);
  const supportShift=clamp(support.clone().sub(desiredCenter).dot(lateral),-.20,.20);
  const lateralAcceleration=18*(lateralError+supportShift)-8*vel.dot(lateral)+(frame?.curvature??0)*forwardSpeed**2;
  const desiredForce=forward.clone().multiplyScalar(clamp(acceleration+(targetSpeed-forwardSpeed)*9,-6,6))
    .addScaledVector(lateral,clamp(lateralAcceleration,-6,6));
  desiredForce.y=GRAVITY+70*(desiredCenter.y-p.y)-15*vel.y;
  desiredForce.multiplyScalar(mass);
  const desiredOmega=new Vector3(0,-(frame?.curvature??0)*forwardSpeed,0);
  const desiredTorque=new Vector3(error.x,error.y,error.z).multiplyScalar(75).addScaledVector(desiredOmega.sub(omega),10).multiply(v(s.mass.inertia));
  const maxNormal=s.dryMass.reduce((sum,e)=>sum+e.massKg,0)*GRAVITY*.85;
  const forces=contacts.map(f=> { const old=s.feet.find(o=>o.side===f.side&&o.direction===f.direction); return old?.planted?v(old.force):new Vector3(0,weight/Math.max(1,contacts.length),0); });
  const arms=contacts.map(f=>v(f.position).sub(p)), normals=contacts.map(f=>normalAt(f.position[0],terrain));
  // Projected gradient wrench allocation. Torque must come from reachable contacts.
  const rate=.11/(1+Math.max(0,...arms.map(r=>r.lengthSq())));
  for(let iteration=0;iteration<36;iteration++) {
    const totalF=new Vector3(),totalT=new Vector3();
    forces.forEach((f,i)=>{totalF.add(f);totalT.add(arms[i].clone().cross(f));});
    const ef=totalF.sub(desiredForce),et=totalT.sub(desiredTorque);
    forces.forEach((f,i)=> {const gradient=ef.clone().add(et.clone().cross(arms[i])).addScaledVector(f,.0005);f.copy(constrainContact(f.clone().addScaledVector(gradient,-rate),normals[i],maxNormal,friction));});
  }
  const totalF=new Vector3(0,-weight,0),totalT=new Vector3();
  contacts.forEach((f,i)=>{
    const force=forces[i], normal=normals[i];
    f.force=tuple(force); f.normalN=Math.max(0,force.dot(normal)); f.frictionN=force.clone().addScaledVector(normal,-f.normalN).length();
    f.slipping=f.normalN>1 && f.frictionN>=friction*f.normalN*.995 && vel.clone().addScaledVector(forward,-targetSpeed).length()>.15;
    if(f.slipping) {f.position[0]+=vel.x*dt;f.position[2]+=vel.z*dt;f.position[1]=terrain.sample(f.position[0]).heightM;}
    totalF.add(force);totalT.add(arms[i].clone().cross(force));
  });
  let bodyContactCount=0,bodyNormalN=0;
  // Compliant hull contacts keep a falling chassis above terrain and dissipate impact.
  const colliders=s.dryMass.flatMap(e=>{
    const extent=e.halfExtents??[.15,.15,.15]; const points:Vector3[]=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) points.push(v(e.position).add(new Vector3(x*extent[0],y*extent[1],z*extent[2])));
    return points;
  });
  if(mass>s.dryMass.reduce((sum,e)=>sum+e.massKg,0)) for(const x of [-.4,.4])for(const y of [.75,1.45])for(const z of [-.35,.35])colliders.push(new Vector3(x,y,z));
  // Folded feet also collide: a settled robot must not bury its feet below ground.
  if (!active) for (const foot of feet) {
    const local = v(foot.position).sub(origin).applyQuaternion(q.clone().invert());
    for(const x of [-.17,.17])for(const z of [-.15,.15]) colliders.push(local.clone().add(new Vector3(x,0,z)));
  }
  for(const localPoint of colliders) {
    const point=localPoint.applyQuaternion(q).add(origin), n=normalAt(point.x,terrain);
    const depth=(terrain.sample(point.x).heightM-point.y)*n.y;
    if(depth<=0) continue;
    const arm=point.clone().sub(p), speed=omega.clone().cross(arm).add(vel), vn=speed.dot(n);
    const fn=Math.max(0,mass*(450*depth-12*vn));
    const tangent=speed.clone().addScaledVector(n,-vn).multiplyScalar(-mass*8);
    if(tangent.length()>friction*fn) tangent.setLength(friction*fn);
    const force=tangent.addScaledVector(n,fn);
    totalF.add(force);totalT.add(arm.cross(force));bodyContactCount++;bodyNormalN+=fn;
  }
  vel.addScaledVector(totalF,dt/mass); p.addScaledVector(vel,dt);
  const localOmega=omega.clone().applyQuaternion(q.clone().invert()), inertia=v(s.mass.inertia);
  const gyroscopic=localOmega.clone().cross(localOmega.clone().multiply(inertia));
  const angularAccel=totalT.applyQuaternion(q.clone().invert()).sub(gyroscopic).divide(inertia).applyQuaternion(q);
  omega.addScaledVector(angularAccel,dt);
  const angle=omega.length()*dt;
  if(angle>0) q.premultiply(new Quaternion().setFromAxisAngle(omega.clone().normalize(),angle)).normalize();
  // Track boundaries are walls, not position commands; remove only outward velocity.
  const root=v(s.mass.center).applyQuaternion(q); const rootX=p.x-root.x;
  if(rootX<0||rootX>terrain.lengthM){p.x=clamp(rootX,0,terrain.lengthM)+root.x;if(vel.x*(rootX<0?-1:1)>0)vel.x=0;}
  const tiltDegrees=Math.acos(clamp(new Vector3(0,1,0).applyQuaternion(q).dot(normalAt(p.x,terrain)),-1,1))*180/Math.PI;
  const overturnedSeconds=tiltDegrees>60?s.overturnedSeconds+dt:0;
  const margin=supportMargin(contacts.filter(f=>f.normalN>1).map(f=>f.position),tuple(p));
  const status=s.status==='fallen'||overturnedSeconds>1.5&&bodyContactCount>0?'fallen':tiltDegrees>35?'tipping':margin<-.05||tiltDegrees>12?'unstable':'balanced';
  const nextOrigin=p.clone().sub(v(s.mass.center).applyQuaternion(q));
  const displacement=nextOrigin.clone().sub(origin), signedDistance=Math.sign(displacement.dot(forward))*displacement.length();
  return {...s,travelM:s.travelM+signedDistance,gaitM:s.gaitM+signedDistance/strideScale,laneZM:frame?.zM??s.laneZM,position:tuple(p),orientation:q.toArray() as Q4,velocity:tuple(vel),angularVelocity:tuple(omega),feet,supportMarginM:margin,tiltDegrees,bodyContactCount,bodyNormalN,overturnedSeconds,status};
}
