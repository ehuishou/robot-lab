import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { load } from './verification-loader.mjs';
const THREE = createRequire(import.meta.url)('three');
const { ModelKit } = load('src/render/ModelKit.ts');
const { createTerrainSampler } = load('src/domain/simulation/terrain.ts');
const { TRANSPORT_MISSION: mission } = load('src/content/challenges.ts');
const { createEnvironmentView } = load('src/render/EnvironmentView.ts');

const kit = new ModelKit(4), second = new ModelKit(4), root = new THREE.Group();
const originalDocument = globalThis.document;
const draws = [];
globalThis.document = { createElement: tag => {
  assert.equal(tag, 'canvas');
  const context = { fillStyle: '', font: '', textAlign: '', textBaseline: '', fillRect() {},
    measureText(text) { return { width: text.length * parseFloat(this.font.slice(4)) }; },
    fillText(text, x, y) { draws.push({ text, x, y, font: this.font }); } };
  return { width: 0, height: 0, getContext: () => context };
} };
try {
  assert.equal(kit.resources.textures, 0, 'surface textures are lazy for robot-only kits');
  const terrain = createTerrainSampler(mission.terrain);
  const surface = kit.terrainSurface(root, terrain, 0, 100, 4.8, 0, 0, kit.materials.ground);
  assert.equal(kit.resources.textures, 2);
  second.terrainSurface(new THREE.Group(), terrain, 0, 100, 4.8, 0, 0, second.materials.ground);
  for (const kind of ['ground', 'soil']) {
    const material = kit.materials[kind], texture = material.map;
    assert.ok(texture.isDataTexture);
    assert.equal(texture, material.bumpMap);
    assert.equal(texture, material.roughnessMap);
    assert.equal(texture.image.width, 128);
    assert.equal(texture.image.height, 128);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.ok(texture.generateMipmaps);
    assert.equal(texture.anisotropy, 4);
    assert.deepEqual(texture.image.data, second.materials[kind].map.image.data, 'deterministic surface');
    assert.ok(material.bumpScale <= .024, 'pure visual detail must not change terrain geometry');
  }
  const env = createEnvironmentView(kit, mission);
  let surfaceCount = 0;
  const checkSurface = mesh => {
    if (!mesh.isMesh || ![kit.materials.ground, kit.materials.soil].includes(mesh.material)) return;
    const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    assert.equal(uv.count, position.count);
    for (let i = 0; i < position.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - position.getX(i)) < 1e-5);
      assert.ok(Math.abs(uv.getY(i) - position.getZ(i)) < 1e-5);
    }
    surfaceCount++;
  };
  checkSurface(surface); env.traverse(checkSurface);
  assert.ok(surfaceCount >= 5, 'terrain, direct road and turning aprons are covered');
  for (let i = 0; i < surface.geometry.attributes.position.count; i++) {
    const p = surface.geometry.attributes.position;
    assert.ok(Math.abs(p.getY(i) - terrain.sample(p.getX(i)).heightM) < 1e-5);
  }
  console.log('PASS deterministic shared surface details, metre-scale UVs, unchanged terrain heights');
  const sign = kit.label(root, '测试标识', 4, .65, [0, 1, 0]);
  const sameAspect = kit.label(root, '测试标识', 8, 1.3, [0, 2, 0]);
  const otherAspect = kit.label(root, '测试标识', 3.8, .45, [0, 3, 0]);
  assert.equal(sign.material, sameAspect.material);
  assert.notEqual(sign.material, otherAspect.material);
  for (const mesh of [sign, otherAspect]) {
    const canvas = mesh.material.map.image;
    const { width, height } = mesh.geometry.parameters;
    assert.ok(Math.abs(canvas.width / canvas.height - width / height) / (width / height) < .005);
    assert.equal(mesh.material.toneMapped, false);
    assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
  }
  assert.ok(draws.length > 2);
  const disposable = new Set();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    disposable.add(mesh.geometry); disposable.add(mesh.material);
    if (mesh.material.map) disposable.add(mesh.material.map);
  });
  disposable.add(kit.materials.soil.map);
  let disposed = 0;
  for (const resource of disposable) resource.addEventListener('dispose', () => disposed++);
  kit.dispose();
  assert.equal(disposed, disposable.size, 'each shared resource disposed once');
  assert.equal(kit.resources.geometries, 0); assert.equal(kit.resources.textures, 0);
  console.log('PASS aspect-aware cached labels, no tone-mapping or shadow tint, resource disposal');
} finally {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  second.dispose();
}
