import * as THREE from 'three';

const ownedBatches = new WeakSet<THREE.InstancedMesh>();

function eligible(object: THREE.Object3D): object is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (Object.getPrototypeOf(object) !== THREE.Mesh.prototype || object.name || object.children.length || object.animations.length ||
      Object.keys(object.userData).length) return false;
  const mesh = object as THREE.Mesh;
  if (!mesh.matrixWorldAutoUpdate || Array.isArray(mesh.material) || mesh.material.transparent ||
      mesh.material.blending !== THREE.NormalBlending ||
      ('transmission' in mesh.material && Number(mesh.material.transmission) > 0) ||
      Object.keys(mesh.geometry.morphAttributes).length || mesh.geometry instanceof THREE.InstancedBufferGeometry ||
      Object.values(mesh.geometry.attributes).some(attribute => attribute instanceof THREE.InstancedBufferAttribute)) return false;
  // Object-specific hooks may rely on the original mesh or mutate it while rendering.
  return mesh.onBeforeRender === THREE.Mesh.prototype.onBeforeRender &&
    mesh.onAfterRender === THREE.Mesh.prototype.onAfterRender &&
    mesh.onBeforeShadow === THREE.Mesh.prototype.onBeforeShadow &&
    mesh.onAfterShadow === THREE.Mesh.prototype.onAfterShadow;
}

function flagsKey(mesh: THREE.Mesh): string {
  return [mesh.geometry.uuid, (mesh.material as THREE.Material).uuid, mesh.visible,
    mesh.castShadow, mesh.receiveShadow, mesh.frustumCulled, mesh.layers.mask, mesh.renderOrder,
    mesh.customDepthMaterial?.uuid ?? '', mesh.customDistanceMaterial?.uuid ?? ''].join(':');
}

/**
 * Opt in ONE known-static group. Only repeated unnamed direct-child leaf Meshes are
 * replaced; this deliberately never recurses into dynamic/interactive subgroups.
 * The caller must not animate the replaced children. Shared geometry/materials
 * remain owned by their original resource manager (e.g. ModelKit).
 */
export function batchStaticMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  const buckets = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  for (const child of group.children) {
    if (!eligible(child)) continue;
    if (child.matrixAutoUpdate) child.updateMatrix();
    // Instancing cannot preserve mirrored/singular transforms or sheared normals.
    if (child.matrix.determinant() <= 0) continue;
    x.setFromMatrixColumn(child.matrix, 0).normalize();
    y.setFromMatrixColumn(child.matrix, 1).normalize();
    z.setFromMatrixColumn(child.matrix, 2).normalize();
    if (Math.abs(x.dot(y)) > 1e-10 || Math.abs(x.dot(z)) > 1e-10 || Math.abs(y.dot(z)) > 1e-10) continue;
    const key = flagsKey(child);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(child);
    else buckets.set(key, [child]);
  }

  const batches: THREE.InstancedMesh[] = [];
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    batch.visible = first.visible;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.frustumCulled = first.frustumCulled;
    batch.layers.mask = first.layers.mask;
    batch.renderOrder = first.renderOrder;
    batch.customDepthMaterial = first.customDepthMaterial;
    batch.customDistanceMaterial = first.customDistanceMaterial;
    for (const [index, mesh] of meshes.entries()) batch.setMatrixAt(index, mesh.matrix);
    batch.instanceMatrix.needsUpdate = true;
    // Bounds stay in this facade's coordinates; never make one world-wide batch.
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    group.add(batch);
    for (const mesh of meshes) group.remove(mesh);
    ownedBatches.add(batch);
    batch.addEventListener('dispose', () => ownedBatches.delete(batch));
    batches.push(batch);
  }
  return batches;
}

/**
 * Call at world teardown, before discarding root and disposing shared kit assets.
 * Idempotent; releases only this helper's InstancedMesh GPU-specific resources,
 * NOT their shared geometries/materials. Also safe after manual batch.dispose().
 */
export function disposeStaticBatches(root: THREE.Object3D): void {
  root.traverse(object => {
    if (object instanceof THREE.InstancedMesh && ownedBatches.has(object)) object.dispose();
  });
}
