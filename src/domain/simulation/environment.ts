import type { Configuration } from '../config/validateConfiguration';
import type { DrivingIntent } from './driving';
import type { TerrainSampler } from './terrain';

export interface RouteSection {
  readonly id: string;
  readonly kind: 'soil' | 'bridge' | 'debris' | 'charger';
  readonly label: string;
  readonly startM: number;
  readonly endM: number;
  readonly extraM: number;
  readonly bypass?: boolean;
  /** Distance before/after an obstacle where the bypass branches off and rejoins. */
  readonly bypassLeadM?: number;
  readonly bypassExitM?: number;
  readonly severity: number;
  readonly pieces?: number;
  readonly pieceMassKg?: number;
}
export interface EnvironmentDefinition { readonly version: 'environment-v2'; readonly sections: readonly RouteSection[] }
export interface EnergyLedger { drive: number; electronics: number; slip: number; gait: number; tools: number }
export interface EnvironmentState {
  readonly choices: Readonly<Record<string, 'direct' | 'bypass'>>;
  readonly removed: Readonly<Record<string, number>>;
  readonly ledger: Readonly<EnergyLedger>;
  readonly distanceM: number;
  readonly commandedSpeedMps: number;
  readonly travelDirection: 1 | -1;
  readonly zM: number;
  readonly blocked: string;
  readonly stallSeconds: number;
  readonly assist: boolean;
  readonly work: null | Readonly<{ kind: 'clear' | 'charge' | 'load' | 'unload'; sectionId: string; seconds: number; duration: number; units: number; count: number }>;
  readonly stationUsed: boolean;
  readonly modelVersion: typeof ENERGY_MODEL_VERSION;
  readonly model: Readonly<{ joulesPerUnit: number; electronicsW: number; forceN: number; powerW: number; maxSpeed: number; widthM: number; motor: string; chassis: string; sensor: string }>;
}
export const ENERGY_MODEL_VERSION = 'work-loss-v2.3';
export function motorEfficiency(motor: string, resistanceN: number): number {
  const load=Math.max(0,Math.min(1,(resistanceN-40)/70));
  return motor==='motor_low'?.84-.26*load:motor==='motor_high'?.69+.15*load:.78;
}
export function createEnvironmentState(c: Configuration): EnvironmentState {
  const force = c.motor === 'motor_low' ? 130 : c.motor === 'motor_standard' ? 240 : 360;
  return { modelVersion:ENERGY_MODEL_VERSION, choices: {}, removed: {}, ledger: { drive:0, electronics:0, slip:0, gait:0, tools:0 }, distanceM:0,commandedSpeedMps:0,travelDirection:1,zM:0,blocked:'',stallSeconds:0,assist:true,work:null,stationUsed:false,
    model: { widthM:Math.max(c.accessory==='tool_blade'?2:0,c.chassis==='chassis_quadruped'?2.46:1.8), joulesPerUnit:250, electronicsW:6+(c.sensor==='sensor_lidar'?8:c.sensor==='sensor_depth'?5:2), forceN:force,
      powerW: Math.min(c.motor==='motor_low'?420:c.motor==='motor_standard'?850:1250,c.battery==='battery_small'?800:c.battery==='battery_standard'?1100:1400),
      maxSpeed: Math.min(c.chassis==='chassis_wheel'?5:c.chassis==='chassis_track'?3.8:3.2,c.motor==='motor_low'?4:c.motor==='motor_standard'?5.5:7),
      motor:c.motor!,chassis:c.chassis!,sensor:c.sensor! } };
}
export function hasBypass(section: RouteSection): boolean {
  return section.kind !== 'charger' && section.bypass !== false;
}
/** Shared smooth arch: zero height and slope at both ends. */
export function bridgeHeight(section: RouteSection, x: number): number {
  const t = Math.max(0, Math.min(1, (x-section.startM)/(section.endM-section.startM)));
  return section.severity * Math.sin(Math.PI*t)**2;
}
export function bypassBounds(section: RouteSection): Readonly<{ startM: number; endM: number }> {
  if (!hasBypass(section)) return { startM: section.startM, endM: section.endM };
  return { startM: section.startM - (section.bypassLeadM ?? 3), endM: section.endM + (section.bypassExitM ?? 3) };
}
export function nearestJunction(sections: readonly RouteSection[], x: number, direction = 1): RouteSection | undefined {
  return sections.filter(s => {
    if (!hasBypass(s)) return false;
    const bounds = bypassBounds(s);
    const edge = direction < 0 ? bounds.endM : bounds.startM;
    return Math.abs(x-edge)<=2 && (direction < 0 ? x>=edge-.02 : x<=edge+.02);
  }).sort((a,b)=>{
    const ae=bypassBounds(a),be=bypassBounds(b);
    const da=Math.abs(x-(direction<0?ae.endM:ae.startM)),db=Math.abs(x-(direction<0?be.endM:be.startM));
    return da-db;
  })[0];
}
export const ROUTE_LANE_OFFSET_M = .4;
// The same sampled curve supplies rendered geometry, arc length and motion conversion.
interface CurvePiece { x: number[]; z: number[] }
const curves=new Map<string,CurvePiece[]>();
const projectionCurves=new Map<string,{x:number;z:number}[]>();
function curvePieces(section:RouteSection):CurvePiece[] {
  const bounds=bypassBounds(section),span=bounds.endM-bounds.startM,lead=section.bypassLeadM ?? 3,exit=section.bypassExitM ?? 3;
  const key=[span,section.extraM,lead,exit].join(':');
  const cached=curves.get(key);if(cached)return cached;
  const line=(ax:number,az:number,bx:number,bz:number):CurvePiece=>({x:[ax,ax+(bx-ax)/3,ax+2*(bx-ax)/3,bx],z:[az,az+(bz-az)/3,az+2*(bz-az)/3,bz]});
  const make=(offset:number):CurvePiece[]=>[
    {x:[0,lead/3,lead*2/3,lead],z:[0,0,offset,offset]},
    line(lead,offset,span-exit,offset),
    {x:[span-exit,span-exit+exit/3,span-exit+exit*2/3,span],z:[offset,offset,0,0]},
  ];
  const arc=(pieces:CurvePiece[])=>pieces.reduce((sum,p)=>{let px=p.x[0],pz=p.z[0];for(let i=1;i<=100;i++){const x=bezier(p.x,i/100),z=bezier(p.z,i/100);sum+=Math.hypot(x-px,z-pz);px=x;pz=z;}return sum;},0);
  let lo=.15,hi=Math.max(1.2,section.extraM*2.2+1);
  for(let i=0;i<36;i++){const mid=(lo+hi)/2;if(arc(make(mid))>span+section.extraM)hi=mid;else lo=mid;}
  const result=make((lo+hi)/2);curves.set(key,result);return result;
}
function bezier(p:number[],t:number):number{return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3];}
function derivative(p:number[],t:number):number{return 3*(1-t)**2*(p[1]-p[0])+6*(1-t)*t*(p[2]-p[1])+3*t*t*(p[3]-p[2]);}
function second(p:number[],t:number):number{return 6*((1-t)*(p[2]-2*p[1]+p[0])+t*(p[3]-2*p[2]+p[1]));}
function curveAt(s:RouteSection,x:number){
  const bounds=bypassBounds(s),local=Math.max(0,Math.min(bounds.endM-bounds.startM,x-bounds.startM));
  const pieces=curvePieces(s),p=pieces.find(piece=>local<=piece.x[3]+1e-10)??pieces[pieces.length-1];
  let lo=0,hi=1;for(let i=0;i<30;i++){const t=(lo+hi)/2;if(bezier(p.x,t)>local)hi=t;else lo=t;}
  const t=(lo+hi)/2,dx=Math.max(1e-8,derivative(p.x,t)),dz=derivative(p.z,t);
  return {zM:bezier(p.z,t),dz:dz/dx,curvature:(dx*second(p.z,t)-dz*second(p.x,t))/Math.hypot(dx,dz)**3};
}
export function routePose(sections: readonly RouteSection[], choices: EnvironmentState['choices'], terrain: TerrainSampler, x: number) {
  const section=sections.find(s=>choices[s.id]==='bypass'&&hasBypass(s)&&(()=>{const bounds=bypassBounds(s);return x>=bounds.startM&&x<=bounds.endM;})())??sections.find(s=>{const bounds={startM:s.startM,endM:s.endM};return x>=bounds.startM&&x<=bounds.endM;});
  const bypass=!!section&&choices[section.id]==='bypass'&&hasBypass(section);
  const curve=bypass?curveAt(section!,x):{zM:0,dz:0,curvature:0};
  const {zM,dz}=curve;
  let heightM=terrain.sample(x).heightM;
  if(section?.kind==='bridge'&&!bypass) heightM+=bridgeHeight(section,x);
  const h = (at: number) => {
    let y=terrain.sample(at).heightM;
    if(section?.kind==='bridge'&&!bypass)y+=bridgeHeight(section,at);
    return y;
  };
  const slope=(h(x+.001)-h(x-.001))/.002;
  return { xM:x,zM,heightM,dz,slope,curvature:curve.curvature,scale:Math.hypot(1,dz,slope),section,bypass };
}
/** Nearest world point on the selected lane, so sideways balance motion is not
 * mistaken for forward/reverse travel on the steep sides of a curved branch. */
export function routeProjection(def:EnvironmentDefinition,env:EnvironmentState,x:number,z:number):number {
  let bestX=x,best=Infinity;
  for(const section of def.sections){
    if(env.choices[section.id]!=='bypass'||!hasBypass(section))continue;
    const bounds=bypassBounds(section);if(x<bounds.startM-2||x>bounds.endM+2)continue;
    const key=[bounds.endM-bounds.startM,section.extraM,section.bypassLeadM??3,section.bypassExitM??3].join(':');
    let points=projectionCurves.get(key);
    if(!points){points=[];for(const piece of curvePieces(section))for(let i=0;i<=60;i++)points.push({x:bezier(piece.x,i/60),z:bezier(piece.z,i/60)});projectionCurves.set(key,points);}
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-bounds.startM-a.x)*dx+(z-.4-a.z)*dz)/(dx*dx+dz*dz||1)));
      const px=bounds.startM+a.x+dx*t,pz=.4+a.z+dz*t,d=(px-x)**2+(pz-z)**2;
      if(d<best){best=d;bestX=px;}
    }
    if(x<bounds.startM||x>bounds.endM){const d=(z-.4)**2;if(d<best){best=d;bestX=x;}}
  }
  return bestX;
}
export function routeDistance(def: EnvironmentDefinition, choices: EnvironmentState['choices'], terrain: TerrainSampler, from: number, to: number): number {
  const count=Math.max(2,Math.ceil(Math.abs(to-from)/.02)*2), h=(to-from)/count;
  let sum=0;
  for(let i=0;i<=count;i++)sum+=(i===0||i===count?1:i%2?4:2)*routePose(def.sections,choices,terrain,from+i*h).scale;
  return Math.abs(sum*h/3);
}
export function routePresentation(def: EnvironmentDefinition, env: EnvironmentState, x: number, direction=env.travelDirection) {
  const boundsFor=(s:RouteSection)=>env.choices[s.id]==='bypass'?bypassBounds(s):{startM:s.startM,endM:s.endM};
  const active=def.sections.find(s=>{const b=boundsFor(s);return x>b.startM+.02&&x<b.endM-.02;});
  const junction=nearestJunction(def.sections,x,direction);
  const upcoming=def.sections.map(section=>{const b=bypassBounds(section);return {section,distance:direction<0?x-b.endM:b.startM-x};})
    .filter(item=>item.distance>=0&&item.distance<=Math.max(8,env.model.sensor==='sensor_lidar'?15:8)).sort((a,b)=>a.distance-b.distance)[0];
  const merged=def.sections.find(s=>{if(env.choices[s.id]!=='bypass')return false;const b=bypassBounds(s);return direction<0?x<b.startM&&x>=b.startM-2:x>b.endM&&x<=b.endM+2;});
  const section=junction??active??upcoming?.section;
  return {section,junction,active,merged,choice:section?env.choices[section.id]??'direct':null,distanceM:upcoming?.distance??0};
}
export function environmentTerrain(def: EnvironmentDefinition, env: EnvironmentState, base: TerrainSampler): TerrainSampler {
  return { id:base.id+':route', lengthM:base.lengthM, sample(xM:number) {
    xM=Math.max(0,Math.min(base.lengthM,xM));const h=(x:number)=>routePose(def.sections,env.choices,base,Math.max(0,Math.min(base.lengthM,x))).heightM;
    const slope=(h(xM+.02)-h(xM-.02))/.04;
    return {xM,heightM:h(xM),slope,slopeDegrees:Math.atan(slope)*180/Math.PI,curvaturePerM:0};
  } };
}
export function beginWork(def: EnvironmentDefinition, env: EnvironmentState, c: Configuration, x: number, speed: number, cargoKg: number, payload: number, batteryRoom: number): EnvironmentState | null {
  if(env.work||Math.abs(speed)>.25)return null;
  const debris=def.sections.find(s=>s.kind==='debris'&&env.choices[s.id]!=='bypass'&&Math.abs(x-(s.startM+s.endM)/2)<2.1&&(env.removed[s.id]??0)<(s.pieces??0));
  if(debris){const blade=c.accessory==='tool_blade';if(!blade&&cargoKg+(debris.pieceMassKg??0)>payload)return null;
    const count=blade?debris.pieces!-(env.removed[debris.id]??0):1;
    const mass=count*debris.pieceMassKg!;
    const m=env.model;
    const units=blade?(mass*9.81*.45*1.8/.65+100)/m.joulesPerUnit:(mass*9.81*.6/.55+45)/m.joulesPerUnit;
    return {...env,blocked:'',work:{kind:'clear',sectionId:debris.id,seconds:0,duration:blade?3+count*.3:2,units,count}};
  }
  const station=def.sections.find(s=>s.kind==='charger'&&env.choices[s.id]!=='bypass'&&Math.abs(x-(s.startM+s.endM)/2)<.8);
  if(station&&!env.stationUsed&&batteryRoom>.01)return {...env,work:{kind:'charge',sectionId:station.id,seconds:0,duration:5,units:0,count:0}};
  return null;
}
export interface EnvironmentMotion { xM:number;speedMps:number;energyConsumedUnits:number;environment:EnvironmentState;restored:number; components:EnergyLedger }
export function simulateEnvironmentStep(def: EnvironmentDefinition, env: EnvironmentState, state: {xM:number;speedMps:number;massKg:number;energy:number;capacity:number;testMode:boolean}, intent: DrivingIntent, terrain: TerrainSampler, dt:number): EnvironmentMotion {
  if(env.model.chassis==='chassis_quadruped')state={...state,speedMps:env.commandedSpeedMps};
  const m=env.model,p=routePose(def.sections,env.choices,terrain,state.xM), section=p.section;
  const leg=m.chassis==='chassis_quadruped',track=m.chassis==='chassis_track';
  let crr=leg?.012:track?.027:.018,mu=.7,slipRatio=0;
  if(section&&!p.bypass&&section.kind==='soil') {crr=track?.045:leg?.075:.11;mu=track?.62:leg?.48:.32;slipRatio=track?.035:leg?.07:.22}
  if(section&&!p.bypass&&section.kind==='bridge')crr=leg?.02:track?.05:.07;
  let blocked='';
  const dir=intent.throttle;
  const travelDir=dir || Math.sign(state.speedMps);
  // Obstacles are swept boundaries in both directions. No invisible traversal followed by a penalty.
  let barrier: number | null=null;
  if(travelDir)for(const s of def.sections){
    if(hasBypass(s)&&env.choices[s.id]==='bypass')continue;
    const debris=s.kind==='debris'&&(env.removed[s.id]??0)<(s.pieces??0);
    const bridge=s.kind==='bridge'&&!leg;
    const boundary=debris?(s.startM+s.endM)/2-travelDir*1.85:travelDir>0?s.startM-.8:s.endM+.8;
    if((debris||bridge)&&((travelDir>0&&state.xM<=boundary+.03)||(travelDir<0&&state.xM>=boundary-.03))&&Math.abs(boundary-state.xM)<2){barrier=boundary;blocked=debris?'前方碎料箱：停稳后清理':'拱桥仅限四足：退回分岔口选择旁路';break}
  }
  let limit=Math.min(m.maxSpeed, p.bypass?Math.min(m.maxSpeed*.96,Math.sqrt((leg?1.1:2.0)/Math.max(.01,Math.abs(p.curvature)))):m.maxSpeed)*Math.sqrt(Math.min(1,65/state.massKg));
  if(dir<0)limit*=.6;
  if(section&&!p.bypass){if(section.kind==='soil')limit*=track?.8:leg?.65:.48;if(section.kind==='bridge')limit=Math.min(limit,leg?1.5:1.2)}
  // Geometry sensing brakes before nearby hazards; it changes control, not friction or efficiency.
  const lookahead=m.sensor==='sensor_depth'?8:m.sensor==='sensor_lidar'?15:5;
  if(dir)for(const upcoming of def.sections){
    if(env.choices[upcoming.id]!=='bypass')continue;
    const bounds=bypassBounds(upcoming);
    const distance=dir>0?bounds.startM-state.xM:state.xM-bounds.endM;
    if(distance>=0&&distance<1.5)limit=Math.min(limit,Math.sqrt((leg?.9:1.8)**2+2*(leg?1.2:2)*distance));
  }
  if(env.assist&&dir){const near=def.sections.find(s=>env.choices[s.id]!=='bypass'&&s.kind==='bridge'&&(dir>0?s.startM-state.xM:state.xM-s.endM)>0&&(dir>0?s.startM-state.xM:state.xM-s.endM)<lookahead);if(near)limit=Math.min(limit,m.sensor==='sensor_camera'?1.5:2)}
  const ground=environmentTerrain(def,env,terrain);
  const grade=ground.sample(state.xM).slope/p.scale;
  const resistance=state.massKg*9.81*(crr+Math.max(0,grade*dir));
  const force=Math.min(m.forceN,mu*state.massKg*9.81,m.powerW*.78/Math.max(.8,Math.abs(state.speedMps)));
  const target=env.work||intent.brake?0:dir*limit;
  const reversing=state.speedMps*dir<0;
  const accel=env.work||intent.brake||reversing?5:!dir?1:Math.max(0,Math.min(2.8,(force-resistance)/state.massKg));
  let speed=state.speedMps+Math.max(-accel*dt,Math.min(accel*dt,target-state.speedMps));
  if(dir&&force<=resistance&&!intent.brake){speed*=Math.max(0,1-3*dt);blocked='牵引不足：松开油门，退回选择缓坡'}
  let dx=(state.speedMps+speed)*.5*dt/p.scale;
  if(env.work)dx=0;
  if(barrier!==null&&((travelDir>0&&state.xM+dx>barrier)||(travelDir<0&&state.xM+dx<barrier))){dx=barrier-state.xM;speed=0}
  let x=Math.max(0,Math.min(terrain.lengthM,state.xM+dx));
  const nextPose=routePose(def.sections,env.choices,terrain,x);
  const distance=routeDistance(def,env.choices,terrain,state.xM,x);
  const powered=!!dir&&!intent.brake&&!env.work&&!reversing;
  const stallSeconds=powered&&Math.abs(speed)<.08?env.stallSeconds+dt:0;
  const efficiency=motorEfficiency(m.motor,resistance);
  const positiveKinetic=powered?Math.max(0,.5*state.massKg*(speed*speed-state.speedMps*state.speedMps)):0;
  const climb=powered?state.massKg*9.81*Math.max(0,nextPose.heightM-p.heightM):0;
  const drive=powered?(state.massKg*9.81*crr*distance+positiveKinetic+climb)/efficiency/m.joulesPerUnit:0;
  const electronics=m.electronicsW*dt/m.joulesPerUnit;
  const slip=powered?(resistance*distance*slipRatio/efficiency/m.joulesPerUnit+(Math.abs(speed)<.08?(stallSeconds>1?8:65)*dt/m.joulesPerUnit:0)):0;
  const gait=leg?(8*dt+distance*3.5)/m.joulesPerUnit:0;
  const tools=env.work && env.work.kind!=='charge'?env.work.units*dt/env.work.duration:0;
  let components={drive,electronics,slip,gait,tools};
  const demand=Object.values(components).reduce((a,b)=>a+b,0);
  const fraction=state.testMode||demand<=state.energy?1:state.energy/demand;
  // Insufficient energy cannot complete a full motion or work step.
  if(fraction<1){x=state.xM+(x-state.xM)*fraction;speed=0;components=Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v*fraction])) as unknown as EnergyLedger}
  const energyConsumedUnits=Object.values(components).reduce((a,b)=>a+b,0);
  let work=env.work,removed=env.removed,stationUsed=env.stationUsed,restored=0;
  if(work){const seconds=work.seconds+dt*fraction;if(seconds>=work.duration-1e-8){
    if(work.kind==='clear')removed={...removed,[work.sectionId]:(removed[work.sectionId]??0)+work.count};
    else if(work.kind==='charge') {stationUsed=true;restored=Math.max(0,Math.min(10,state.capacity-state.energy+energyConsumedUnits))}
    work=null;
  }else work={...work,seconds};}
  const ledger={...env.ledger};for(const key of Object.keys(components) as (keyof EnergyLedger)[])ledger[key]+=components[key];
  return {xM:x,speedMps:speed,energyConsumedUnits,restored,components,environment:{...env,ledger,commandedSpeedMps:speed,travelDirection:dir===-1?-1:dir===1?1:env.travelDirection,distanceM:env.distanceM+distance*fraction,zM:routePose(def.sections,env.choices,terrain,x).zM,blocked,stallSeconds,work,removed,stationUsed}};
}

/** Reconcile the contact body's actual path with the work proxy. Gait vibration is
 * not a second acceleration charge: the motor target supplies bulk kinetic work.
 * Rolling/climbing and leg cycling, however, must use the realized path. */
export function reconcileContactMotion(def: EnvironmentDefinition, before: EnvironmentState, motion: EnvironmentMotion,
  xBefore: number, xAfter: number, massKg: number, terrain: TerrainSampler): EnvironmentMotion {
  const m=before.model, a=routePose(def.sections,before.choices,terrain,xBefore), b=routePose(def.sections,before.choices,terrain,xAfter);
  const oldDistance=motion.environment.distanceM-before.distanceM;
  const distance=routeDistance(def,before.choices,terrain,xBefore,xAfter);
  const soil=a.section?.kind==='soil'&&!a.bypass, bridge=a.section?.kind==='bridge'&&!a.bypass;
  const crr=soil?.075:bridge?.02:.012;
  const resistance=massKg*9.81*(crr+Math.max(0,environmentTerrain(def,before,terrain).sample(xBefore).slope*Math.sign(motion.environment.commandedSpeedMps)/a.scale));
  const efficiency=motorEfficiency(m.motor,resistance);
  const predicted=routePose(def.sections,before.choices,terrain,motion.xM);
  const powered=motion.components.drive>0;
  const correction=powered?(massKg*9.81*(crr*(distance-oldDistance)+Math.max(0,b.heightM-a.heightM)-Math.max(0,predicted.heightM-a.heightM)))/efficiency/m.joulesPerUnit:0;
  const components={...motion.components,drive:Math.max(0,motion.components.drive+correction),gait:0};
  // Preserve dt from the always-on electronics term (supports 30/60 Hz identically).
  components.gait=(8*motion.components.electronics*m.joulesPerUnit/m.electronicsW+distance*3.5)/m.joulesPerUnit;
  const ledger={...before.ledger};for(const k of Object.keys(components) as (keyof EnergyLedger)[])ledger[k]+=components[k];
  return {...motion,xM:xAfter,energyConsumedUnits:Object.values(components).reduce((a,b)=>a+b,0),components,
    environment:{...motion.environment,ledger,distanceM:before.distanceM+distance,zM:b.zM}};
}

/** Collision boundary shared by the kinematic and contact bodies. */
export function constrainEnvironmentMotion(def: EnvironmentDefinition, env: EnvironmentState, from: number, to: number): number {
  const dir=Math.sign(to-from);if(!dir)return to;
  for(const s of def.sections){
    if(env.choices[s.id]==='bypass')continue;
    const debris=s.kind==='debris'&&(env.removed[s.id]??0)<(s.pieces??0);
    const bridge=s.kind==='bridge'&&env.model.chassis!=='chassis_quadruped';
    const boundary=debris?(s.startM+s.endM)/2-dir*1.85:dir>0?s.startM-.8:s.endM+.8;
    if((debris||bridge)&&dir*(boundary-from)>=-.03&&dir*(to-boundary)>0)return boundary;
  }return to;
}

export function senseEnvironment(def: EnvironmentDefinition, env: EnvironmentState, xM: number, direction=1) {
  if(!env.assist)return null;
  const range=env.model.sensor==='sensor_lidar'?15:env.model.sensor==='sensor_depth'?8:5;
  return def.sections.filter(s=>env.choices[s.id]!=='bypass'&&s.kind!=='charger')
    .map(s=>({section:s,distanceM:direction>=0?s.startM-xM:xM-s.endM}))
    .filter(s=>s.distanceM>=0&&s.distanceM<=range).sort((a,b)=>a.distanceM-b.distanceM)[0]??null;
}


