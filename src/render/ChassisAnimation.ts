import * as THREE from 'three';
import type { TerrainSampler } from '../domain/simulation/terrain';
import { footPose, kneePosition, TRACK_LENGTH, trackPose, WHEEL_RADIUS } from './Locomotion';
import type { QuadrupedState } from '../domain/simulation/quadruped';
import type { Point3 } from './Locomotion';

export interface LegRig {
  hip: Point3; side: number; direction: number; offset: number;
  upper: THREE.Mesh; lower: THREE.Mesh; joint: THREE.Mesh; foot: THREE.Mesh;
}
export interface ChassisRig {
  wheels: { object: THREE.Group; radius: number }[];
  tracks: { object: THREE.Mesh; offset: number }[];
  legs: LegRig[];
}
export function chassisRig(robot: THREE.Group): ChassisRig { return robot.userData.chassisRig; }
function moveLink(mesh: THREE.Mesh, start: Point3, end: Point3): void {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
}

export class ChassisAnimation {
  private lastXM: number | null = null;
  private originXM = 0;
  private distanceM = 0;
  private feet: Record<string, unknown>[] = [];
  constructor(private readonly robot: THREE.Group) {}
  reset(): void { this.lastXM = null; this.distanceM = 0; }
  update(xM: number, terrain: TerrainSampler, body: QuadrupedState | null = null, distance?: (from:number,to:number)=>number): void {
    if (this.lastXM === null) this.originXM = xM;
    else {
      const dx = xM - this.lastXM;
      // Signed arc length, including uphill/downhill travel; Simpson integration.
      const metric = (x: number) => Math.hypot(1, terrain.sample(x).slope);
      this.distanceM += distance ? Math.sign(dx)*distance(this.lastXM,xM) : dx / 6 * (metric(this.lastXM) + 4 * metric((xM + this.lastXM) / 2) + metric(xM));
    }
    this.lastXM = xM;
    const rig = chassisRig(this.robot);
    for (const wheel of rig.wheels) wheel.object.rotation.z = -this.distanceM / wheel.radius;
    for (const link of rig.tracks) {
      const pose = trackPose(this.distanceM + link.offset);
      link.object.position.x = pose.x;
      link.object.position.y = pose.y;
      link.object.rotation.z = pose.angle;
    }
    this.robot.updateMatrixWorld(true);
    const inverse = this.robot.matrixWorld.clone().invert();
    this.feet = rig.legs.map(leg => {
      const pose = footPose(xM, this.originXM, leg.direction * 0.68, leg.offset);
      const ground = terrain.sample(pose.xM);
      const slope = THREE.MathUtils.degToRad(ground.slopeDegrees);
      // Sole lies on terrain; ankle at the foot pad's centre, normal to the surface.
      const footWorld = new THREE.Vector3(pose.xM - 0.08 * Math.sin(slope), ground.heightM + pose.liftM + 0.08 * Math.cos(slope), this.robot.position.z + leg.side * 1.03);
      const contact = body?.feet.find(f => f.side === leg.side && f.direction === leg.direction);
      if(contact) footWorld.set(...contact.position).add(new THREE.Vector3(-Math.sin(slope)*.08, Math.cos(slope)*.08,0));
      const local = footWorld.clone().applyMatrix4(inverse);
      // Swing and detached targets may exceed reach after an impact: extend the leg,
      // never stretch either bone or abort rendering when the body overturns.
      const relative = local.clone().sub(new THREE.Vector3(...leg.hip));
      const reach = relative.length();
      if(body && (reach>1.199 || reach<.041)) local.copy(relative.setLength(Math.max(.041,Math.min(1.199,reach)))).add(new THREE.Vector3(...leg.hip));
      const ankle: Point3 = [local.x, local.y, local.z];
      const knee = kneePosition(leg.hip, ankle, -leg.direction);
      moveLink(leg.upper, leg.hip, knee);
      moveLink(leg.lower, knee, ankle);
      leg.joint.position.set(...knee);
      leg.foot.position.copy(local);
      leg.foot.rotation.z = slope - this.robot.rotation.z;
      if(contact) {
        const orientation = contact.planted ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), slope) : this.robot.quaternion.clone();
        leg.foot.quaternion.copy(this.robot.quaternion.clone().invert().multiply(orientation));
      }
      return { side: leg.side, direction: leg.direction, planted: contact?.planted ?? pose.planted, phase: contact?.phase ?? pose.phase, force: contact?.force ?? [0,0,0],
        xM: contact?.position[0] ?? pose.xM, soleHeightM: contact?.position[1] ?? ground.heightM + pose.liftM, groundHeightM: ground.heightM,
        hip: leg.hip, knee, ankle };
    });
  }
  get diagnostics() {
    const rig = chassisRig(this.robot);
    return { distanceM: this.distanceM, wheelAngle: rig.wheels[0]?.object.rotation.z ?? null,
      wheelRadius: rig.wheels[0]?.radius ?? WHEEL_RADIUS, trackCount: rig.tracks.length,
      trackPhase: this.distanceM % TRACK_LENGTH,
      trackSample: rig.tracks.slice(0, 2).map(link => ({ x: link.object.position.x, y: link.object.position.y, angle: link.object.rotation.z })),
      feet: this.feet };
  }
}
