import * as THREE from 'three';
import type { QuadrupedState } from '../domain/simulation/quadruped';
import type { TerrainSampler } from '../domain/simulation/terrain';

/** Optional diagnostics, updated from the same authoritative physics snapshot. */
export class PhysicsOverlay {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(.09, 12, 8);
  private readonly material = new THREE.MeshBasicMaterial({ color: '#ffb34e', depthTest: false });
  private readonly center = new THREE.Mesh(this.geometry, this.material);
  private readonly projection = new THREE.Mesh(this.geometry, this.material);
  private readonly arrows = Array.from({ length: 4 }, () => new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, '#43e5eb'));
  enabled = false;
  constructor() {
    this.group.visible = false;
    this.center.renderOrder = this.projection.renderOrder = 10;
    this.projection.scale.set(.7,.2,.7);
    this.group.add(this.center, this.projection, ...this.arrows);
  }
  update(body: QuadrupedState | null, terrain: TerrainSampler): void {
    this.group.visible = this.enabled && !!body;
    if (!body) return;
    this.center.position.set(...body.position);
    this.projection.position.set(body.position[0], terrain.sample(body.position[0]).heightM + .025, body.position[2]);
    this.arrows.forEach((arrow, i) => {
      const foot = body.feet[i];
      arrow.visible = !!foot && foot.normalN > 1;
      if (!foot || !arrow.visible) return;
      const force = new THREE.Vector3(...foot.force), length = Math.min(2, force.length() / (body.mass.massKg * 9.81) * 2);
      arrow.position.set(...foot.position);
      arrow.setDirection(force.normalize());
      arrow.setLength(length, Math.min(.14, length*.3), Math.min(.08, length*.15));
      arrow.setColor(foot.slipping ? '#ff6b5c' : '#43e5eb');
    });
  }
  dispose(): void {
    this.geometry.dispose(); this.material.dispose();
    this.arrows.forEach(arrow => arrow.dispose());
    this.group.clear();
  }
}
