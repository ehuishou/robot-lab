import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { load } from './verification-loader.mjs';

// Match the loader's CJS Three singleton (instanceof must use the same classes).
const THREE = createRequire(import.meta.url)('three');
const { batchStaticMeshes, disposeStaticBatches } = load('src/render/StaticBatch.ts');
const geometry = new THREE.BoxGeometry(2, 3, 4);
const material = new THREE.MeshStandardMaterial();
const resources = [geometry, material];
let sharedDisposals = 0;
for (const resource of resources) resource.addEventListener('dispose', () => sharedDisposals++);
const makeMesh = (parent, offset = 0) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(offset, offset * 0.2, -offset * 0.5);
  mesh.rotation.set(0.2, 0.4, -0.3);
  mesh.scale.set(0.8, 1.3, 2);
  parent.add(mesh);
  return mesh;
};
const closeMatrix = (actual, expected) => actual.elements.forEach((value, i) =>
  assert.ok(Math.abs(value - expected.elements[i]) < 2e-5, `matrix element ${i}: ${value} != ${expected.elements[i]}`));
const flags = mesh => [mesh.visible, mesh.castShadow, mesh.receiveShadow, mesh.frustumCulled,
  mesh.layers.mask, mesh.renderOrder, mesh.customDepthMaterial, mesh.customDistanceMaterial];
const checkBounds = batch => {
  assert.ok(batch.boundingSphere && Number.isFinite(batch.boundingSphere.radius));
  assert.ok(batch.boundingBox && !batch.boundingBox.isEmpty());
  const transform = new THREE.Matrix4();
  const position = batch.geometry.getAttribute('position');
  for (let i = 0; i < batch.count; i++) {
    batch.getMatrixAt(i, transform);
    for (let j = 0; j < position.count; j++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(position, j).applyMatrix4(transform);
      assert.ok(batch.boundingSphere.distanceToPoint(vertex) < 1e-5, 'local sphere contains every instance vertex');
      assert.ok(batch.boundingBox.clone().expandByScalar(1e-5).containsPoint(vertex));
    }
  }
};

try {
  const parent = new THREE.Group();
  parent.position.set(13, 7, -9);
  parent.rotation.set(0.1, -0.5, 0.3);
  parent.scale.set(1.2, 0.9, 1.4);
  const a = makeMesh(parent, -4), b = makeMesh(parent, 6);
  // Respect authored matrices when automatic updates are disabled.
  b.updateMatrix();
  b.matrixAutoUpdate = false;
  b.position.set(999, 999, 999);
  const depth = new THREE.MeshDepthMaterial(), distance = new THREE.MeshDistanceMaterial();
  resources.push(depth, distance);
  for (const mesh of [a, b]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(3);
    mesh.renderOrder = 7;
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = distance;
  }
  parent.updateMatrixWorld(true);
  const originals = [a, b].map(mesh => ({ local: mesh.matrix.clone(), world: mesh.matrixWorld.clone(), flags: flags(mesh) }));
  const [batch] = batchStaticMeshes(parent);
  assert.equal(parent.children.length, 1);
  assert.equal(batch.count, 2);
  assert.equal(batch.geometry, geometry);
  assert.equal(batch.material, material);
  assert.equal(batch.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.ok(batch.instanceMatrix.version > 0);
  assert.equal(batch.parent, parent);
  parent.updateMatrixWorld(true);
  originals.forEach((original, index) => {
    const matrix = new THREE.Matrix4();
    batch.getMatrixAt(index, matrix);
    closeMatrix(matrix, original.local);
    closeMatrix(new THREE.Matrix4().multiplyMatrices(batch.matrixWorld, matrix), original.world);
    assert.deepEqual(flags(batch), original.flags);
  });
  checkBounds(batch);
  assert.equal(batchStaticMeshes(parent).length, 0, 'repeated calls do not re-batch instances');
  console.log('PASS local/world transforms, authored matrices, flags, shared assets, local bounds');

  // Each render-flag or asset difference must form a separate bucket.
  const variants = [
    mesh => { mesh.visible = false; },
    mesh => { mesh.castShadow = true; },
    mesh => { mesh.receiveShadow = true; },
    mesh => { mesh.frustumCulled = false; },
    mesh => { mesh.layers.set(2); },
    mesh => { mesh.renderOrder = 2; },
    mesh => { mesh.customDepthMaterial = depth; },
    mesh => { mesh.customDistanceMaterial = distance; },
    mesh => { mesh.geometry = new THREE.BoxGeometry(2, 3, 4); resources.push(mesh.geometry); },
    mesh => { mesh.material = material.clone(); resources.push(mesh.material); },
  ];
  for (const vary of variants) {
    const group = new THREE.Group();
    const pair = [makeMesh(group), makeMesh(group, 2)];
    const different = makeMesh(group, 4);
    vary(different);
    const [result] = batchStaticMeshes(group);
    assert.equal(result.count, pair.length);
    assert.equal(different.parent, group, 'different flag/geometry/material is not combined');
    assert.deepEqual(flags(result), flags(pair[0]));
    disposeStaticBatches(group);
  }
  console.log('PASS geometry/material identity and all render-flag bucket boundaries');

  const cullingRoot = new THREE.Group();
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
  camera.position.z = 40;
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const offset of [0, 1000]) {
    const facade = new THREE.Group();
    facade.position.x = offset;
    cullingRoot.add(facade);
    makeMesh(facade, -2); makeMesh(facade, 2);
    const [localBatch] = batchStaticMeshes(facade);
    cullingRoot.updateMatrixWorld(true);
    assert.equal(frustum.intersectsObject(localBatch), offset === 0, 'facades cull independently in world space');
    assert.ok(localBatch.boundingSphere.center.length() < 1, 'bounds do not bake parent translation');
  }
  disposeStaticBatches(cullingRoot);
  console.log('PASS independent facade-local frustum culling under translated parents');

  const untouched = new THREE.Group();
  const named = [makeMesh(untouched), makeMesh(untouched)];
  named.forEach(mesh => { mesh.name = 'route-arrow'; });
  const dynamic = new THREE.Group();
  dynamic.name = 'moving-interactive-group';
  untouched.add(dynamic);
  makeMesh(dynamic); makeMesh(dynamic, 3);
  const nested = makeMesh(untouched);
  nested.add(new THREE.Object3D());
  const callback = makeMesh(untouched);
  callback.onBeforeRender = () => {};
  const metadata = makeMesh(untouched);
  metadata.userData.interactive = true;
  const mirrored = makeMesh(untouched);
  mirrored.scale.x = -1;
  const singular = makeMesh(untouched);
  singular.scale.x = 0;
  const shear = makeMesh(untouched);
  shear.matrixAutoUpdate = false;
  shear.matrix.makeShear(0.3, 0, 0, 0, 0, 0);
  const transparentMaterial = material.clone();
  transparentMaterial.transparent = true;
  resources.push(transparentMaterial);
  for (let i = 0; i < 2; i++) makeMesh(untouched).material = transparentMaterial;
  for (let i = 0; i < 2; i++) makeMesh(untouched).material = [material];
  const external = new THREE.InstancedMesh(geometry, material, 2);
  untouched.add(external);
  const children = [...untouched.children];
  assert.deepEqual(batchStaticMeshes(untouched), []);
  assert.deepEqual(untouched.children, children);
  assert.equal(dynamic.children.length, 2);
  let externalDisposals = 0;
  external.addEventListener('dispose', () => externalDisposals++);
  disposeStaticBatches(untouched);
  assert.equal(externalDisposals, 0, 'cleanup must not dispose unrelated instances');
  external.dispose();
  console.log('PASS named/interactive/dynamic subgroups, hooks, unsafe transforms, transparency exclusions');

  let disposals = 0;
  batch.addEventListener('dispose', () => disposals++);
  disposeStaticBatches(parent);
  disposeStaticBatches(parent);
  assert.equal(disposals, 1, 'root cleanup is idempotent');
  const manual = new THREE.Group();
  makeMesh(manual); makeMesh(manual);
  const [manualBatch] = batchStaticMeshes(manual);
  let manualDisposals = 0;
  manualBatch.addEventListener('dispose', () => manualDisposals++);
  manualBatch.dispose();
  disposeStaticBatches(manual);
  assert.equal(manualDisposals, 1, 'manual disposal is respected by root cleanup');
  assert.equal(sharedDisposals, 0, 'shared geometry/material remain alive');
  console.log('PASS owned-only, idempotent GPU-resource disposal without shared-asset disposal');

  // Build the real bay, intercepting only creation to retain pre-batch evidence.
  const { ModelKit } = load('src/render/ModelKit.ts');
  const { createLogisticsBay } = load('src/render/LogisticsBay.ts');
  const { TRANSPORT_MISSION: mission } = load('src/content/challenges.ts');
  const kit = new ModelKit();
  // Canvas rasterization is irrelevant to batching; retain real label meshes.
  kit.label = (group, text, width, height, position) => {
    const label = kit.mesh(group, kit.geometry(`test-label:${width}:${height}`, () => new THREE.PlaneGeometry(width, height)),
      kit.materials.dark, position);
    label.name = `sign:${text}`;
    label.castShadow = false;
    return label;
  };
  const created = [];
  const originalMesh = kit.mesh.bind(kit);
  kit.mesh = (...args) => {
    const mesh = originalMesh(...args);
    created.push({ mesh, parent: args[0] });
    return mesh;
  };
  let world;
  try {
    world = createLogisticsBay(kit, mission);
    const batches = [];
    world.traverse(object => { if (object.isInstancedMesh) batches.push(object); });
    const facades = new Set(batches.map(mesh => mesh.parent));
    assert.equal(facades.size, 14, 'only fourteen facade parents contain batches');
    let before = 0, after = 0;
    for (const facade of facades) {
      assert.equal(facade.parent, world);
      const original = created.filter(record => record.parent === facade).map(record => record.mesh);
      before += original.length;
      after += facade.children.length;
      const expected = new Map();
      for (const mesh of original) {
        if (mesh.matrixAutoUpdate) mesh.updateMatrix();
        const key = `${mesh.geometry.uuid}:${mesh.material.uuid}`;
        if (!expected.has(key)) expected.set(key, []);
        expected.get(key).push(mesh);
      }
      for (const mesh of facade.children) {
        if (!mesh.isInstancedMesh) { assert.ok(original.includes(mesh)); continue; }
        assert.equal(mesh.frustumCulled, true);
        assert.equal(mesh.parent, facade);
        checkBounds(mesh);
        const sources = expected.get(`${mesh.geometry.uuid}:${mesh.material.uuid}`);
        assert.equal(mesh.count, sources.length);
        sources.forEach((source, i) => {
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(i, matrix);
          closeMatrix(matrix, source.matrix);
          assert.deepEqual(flags(mesh), flags(source));
        });
        assert.ok(mesh.boundingSphere.radius < 10, 'each culling bound spans one facade, not the entire warehouse');
      }
    }
    for (const { mesh, parent: originalParent } of created) {
      if (!facades.has(originalParent)) assert.equal(mesh.parent, originalParent, 'non-facade items/signs stay intact');
    }
    assert.ok(world.getObjectByName('loading-platform'));
    assert.ok(world.getObjectByName('finish-marker'));
    for (const item of mission.layout) assert.ok(world.getObjectByName(item.id));
    let worldDisposals = 0, kitDisposals = 0;
    for (const mesh of batches) {
      mesh.addEventListener('dispose', () => worldDisposals++);
      mesh.geometry.addEventListener('dispose', () => kitDisposals++);
      mesh.material.addEventListener('dispose', () => kitDisposals++);
    }
    disposeStaticBatches(world);
    disposeStaticBatches(world);
    assert.equal(worldDisposals, batches.length);
    assert.equal(kitDisposals, 0);
    const reduction = before - after;
    assert.ok(reduction > 0);
    console.log(`PASS real bay: 14 facades, ${before} -> ${after} mesh draws (${reduction} fewer, ${(100 * reduction / before).toFixed(1)}%); ${batches.length} local batches`);
    console.log(`PASS non-facade mesh parents unchanged; ${worldDisposals} owned batches disposed exactly once`);
  } finally {
    if (world) disposeStaticBatches(world);
    kit.dispose();
  }
} finally {
  for (const resource of resources) resource.dispose();
}
console.log('Static batching verification passed. Draw counts are scene-structural, not a GPU timing benchmark.');
