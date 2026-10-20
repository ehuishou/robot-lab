import { bypassBounds } from '../domain/simulation/environment';
import * as THREE from 'three';
import type { MissionDefinition } from '../domain/mission/definition';
import { createTerrainSampler } from '../domain/simulation/terrain';
import { ModelKit } from './ModelKit';
import { PREVIEW_ASSETS } from '../content/assets';

export function createCargoView(kit: ModelKit, massKg = 8): THREE.Group {
  const cargo = new THREE.Group();
  cargo.name = massKg >= 20 ? 'transport-crate-heavy' : 'transport-crate';
  const { paint, dark, orange, steel } = kit.materials;
  kit.housing(cargo, 0.74, 0.68, 0.7, [0, 0.37, 0], paint);
  kit.box(cargo, [0.8, 0.08, 0.76], [0, 0.07, 0], dark);
  kit.box(cargo, [0.8, 0.06, 0.76], [0, 0.72, 0], steel);
  for (const side of [-1, 1]) {
    kit.box(cargo, [0.08, 0.68, 0.74], [side * 0.23, 0.37, 0], orange);
    kit.box(cargo, [0.2, 0.12, 0.015], [0, 0.55, side * 0.36], dark);
    for (const corner of [-1, 1]) {
      kit.housing(cargo, 0.11, 0.7, 0.11, [corner * 0.34, 0.37, side * 0.32], steel);
      kit.housing(cargo, 0.12, 0.13, 0.035, [corner * 0.23, 0.54, side * 0.38], dark);
    }
  }
  kit.label(cargo, 'CARGO / ' + String(massKg).padStart(2, '0'), 0.28, 0.075, [0, 0.29, 0.358], '#c8e7eb', '#203445');
  if (massKg >= 20) cargo.scale.set(1.12, 1.12, 1.12);
  return cargo;
}

export function createLogisticsBay(kit: ModelKit, mission: MissionDefinition): THREE.Group {
  const world = new THREE.Group();
  world.name = 'logistics-bay';
  world.userData.assetId = 'environment:logistics-bay';
  if (!PREVIEW_ASSETS.some(asset => asset.id === world.userData.assetId && asset.status === 'procedural-preview')) throw new Error('未登记的物流场景资产。');
  const { dark, steel, orange, cyan, ground, wall, window: glass } = kit.materials;
  const terrain = createTerrainSampler(mission.terrain);
  kit.terrainSurface(world, terrain, -5, terrain.lengthM + 5, 23, -1, -0.15, ground);
  const road = kit.terrainSurface(world, terrain, 0, terrain.lengthM, 4.8, 0, 0, ground);
  road.name = 'terrain-road';
  for (const side of [-1, 1]) {
    let start=0;
    for(const section of mission.environment?.sections??[]){
      const bounds=bypassBounds(section);
      if(bounds.startM>start)kit.terrainSurface(world,terrain,start,bounds.startM,.35,side*2.6,.03,dark);
      start=bounds.endM;
    }
    if(start<terrain.lengthM)kit.terrainSurface(world,terrain,start,terrain.lengthM,.35,side*2.6,.03,dark);
  }
  for (let index = 0; index < 50; index++) {
    const xM = index * 2 + 1;
    if(mission.environment?.sections.some(s=>{const b=bypassBounds(s);return xM>=b.startM-1&&xM<=b.endM+1;}) || mission.platforms.some(p=>xM>=p.startM-1&&xM<=p.endM+1))continue;
    const sample = terrain.sample(xM);
    const markings = new THREE.Group();
    markings.position.set(xM, sample.heightM, 0);
    markings.rotation.z = THREE.MathUtils.degToRad(sample.slopeDegrees);
    world.add(markings);
    kit.box(markings, [1.4, 0.006, 0.035], [0, 0.008, -2.1], steel);
    kit.box(markings, [1.4, 0.006, 0.035], [0, 0.008, 2.1], steel);
    if (index % 2 === 0) kit.box(markings, [0.75, 0.008, 0.045], [0, 0.012, 0], steel);
    for (const side of [-1, 1]) {
      if (index % 3 === 0) kit.box(markings, [0.4, 0.045, 0.12], [0, 0.13, side * 2.6], cyan);
    }
  }
  for (let index = 0; index <= 10; index++) {
    const xM = index * 10;
    const heightM = terrain.sample(xM).heightM;
    kit.housing(world, 0.17, 1.05, 0.17, [xM, heightM + 0.52, -2.95], steel);
    kit.box(world, [0.23, 0.15, 0.2], [xM, heightM + 1.06, -2.95], cyan);
    kit.label(world, `${String(xM).padStart(3, '0')} m`, 1.4, 0.34, [xM + 0.5, heightM + 0.31, -3.02]);
  }
  for (let index = 0; index < 14; index++) {
    const xM = index * 8;
    const facade = new THREE.Group();
    facade.position.y = Math.min(...[xM - 3.8, xM, xM + 3.8].map(positionM => terrain.sample(positionM).heightM));
    world.add(facade);
    kit.box(facade, [7.6, 6.7, 0.35], [xM, 3.25, -8], wall);
    kit.box(facade, [0.22, 7.2, 0.55], [xM - 3.8, 3.5, -7.7], steel);
    kit.box(facade, [7.45, 0.22, 0.5], [xM, 5.2, -7.7], dark);
    for (let pane = 0; pane < 5; pane++) {
      kit.box(facade, [1.17, 1.15, 0.06], [xM - 2.6 + pane * 1.3, 5.95, -7.79], glass);
      kit.box(facade, [0.065, 1.2, 0.08], [xM - 3.2 + pane * 1.3, 5.95, -7.7], dark);
    }
    kit.box(facade, [5.8, 3.7, 0.15], [xM, 1.85, -7.7], dark);
    for (let slat = 0; slat < 10; slat++) kit.box(facade, [5.45, 0.025, 0.09], [xM, 0.35 + slat * 0.33, -7.56], steel);
    kit.box(facade, [5.6, 0.07, 0.13], [xM, 4.25, -7.5], cyan);
    kit.box(facade, [7.4, 0.6, 3.1], [xM, 7, -7], dark);
    kit.box(facade, [7.2, 0.05, 0.12], [xM, 6.68, -5.55], glass);
    for (const side of [-1, 1]) {
      kit.beam(facade, [xM + side * 3.55, 5.3, -7.5], [xM + side * 3.55, 6.65, -5.6], 0.13, steel);
      kit.housing(facade, 0.22, 0.9, 0.22, [xM + side * 3.2, 0.45, -6.8], orange);
      kit.box(facade, [0.24, 0.1, 0.24], [xM + side * 3.2, 0.68, -6.8], dark);
    }
  }
  for (const xM of [8, 33, 50, 80, 98]) {
    const heightM = terrain.sample(xM).heightM;
    kit.box(world, [0.22, 3.8, 0.22], [xM, heightM + 1.75, -4.9], steel);
    kit.beam(world, [xM, heightM + 3.65, -4.9], [xM, heightM + 3.65, -2.8], 0.12, dark);
    kit.box(world, [0.65, 0.1, 0.9], [xM, heightM + 3.58, -2.8], glass);
    const cabinetHeightM = terrain.sample(xM + 2).heightM - 0.15;
    kit.housing(world, 1.2, 0.9, 0.9, [xM + 2, cabinetHeightM + 0.45, -5.7], dark);
    kit.box(world, [0.75, 0.025, 0.025], [xM + 2, cabinetHeightM + 0.81, -5.21], cyan);
    kit.cylinder(world, 0.09, 7.5, [xM, heightM + 1.05, -8.4], steel, [0, 0, Math.PI / 2]);
  }

  const cargoItems = mission.layout.filter(item => item.kind === 'cargo');
  if (!cargoItems.length) throw new Error('视觉小样缺少装货物件。');
  for (const [index, cargoItem] of cargoItems.entries()) {
    const loadingXM = cargoItem.xM;
    const loading = new THREE.Group();
    loading.name = index === 0 ? 'loading-platform' : 'loading-platform-' + index;
    loading.position.y = terrain.sample(loadingXM).heightM;
    world.add(loading);
    kit.box(loading, [4.6, 0.06, 4.5], [loadingXM, 0.006, 0], dark);
    for (const side of [-1, 1]) kit.box(loading, [4.25, 0.008, 0.07], [loadingXM, 0.042, side * 2.01], orange);
    for (const xM of [loadingXM - 2.1, loadingXM + 2.1]) kit.box(loading, [0.07, 0.008, 4.1], [xM, 0.042, 0], orange);
    kit.housing(loading, 4.6, 0.32, 2.1, [loadingXM + 2, 0.05, -4.3], dark);
    kit.label(loading, '装载 / ' + loadingXM + ' m', 3.1, 0.75, [loadingXM, 3.7, -5.3], '#f0be7b');
    for (const xM of [loadingXM - 2.2, loadingXM + 2.2]) {
      kit.box(loading, [0.22, 3.85, 0.22], [xM, 1.775, -5.4], steel);
      kit.box(loading, [0.045, 2.6, 0.24], [xM + 0.14, 1.8, -5.3], orange);
    }
    kit.box(loading, [4.85, 0.18, 0.36], [loadingXM, 4.15, -5.4], dark);
    for (const [xM, zM] of [[loadingXM + 1.7, -4.2], [loadingXM + 2.5, -4.2], [loadingXM + 1.7, -5]]) {
      const crate = createCargoView(kit);
      crate.position.set(xM, 0.22, zM);
      loading.add(crate);
    }

  }

  for (const item of mission.layout) {
    if (!PREVIEW_ASSETS.some(asset => asset.id === item.viewAssetId && asset.kind === 'item' && asset.status === 'procedural-preview')) throw new Error(`未登记的场景资产：${item.viewAssetId}`);
    const object = new THREE.Group();
    object.name = item.id;
    object.userData.assetId = item.viewAssetId;
    object.position.set(item.xM, terrain.sample(item.xM).heightM + 0.05, 0);
    world.add(object);
    if (item.kind === 'cargo') {
      const crate = createCargoView(kit, item.cargo.massKg);
      kit.label(object, item.cargo.massKg + ' kg · ' + item.xM + ' m', 1.8, .35, [0, 1.6, -1.4], '#f0be7b');
      crate.position.set(0, 0, -1.4);
      object.add(crate);
      kit.ring(object, 0.55, 0.018, [0, 0.015, -1.4], orange);
    } else {
      kit.box(object, [item.endM - item.startM, 0.06, 4.3], [(item.startM + item.endM) / 2 - item.xM, -0.018, 0], dark);
      kit.ring(object, 1.65, 0.025, [0, 0.024, 0], cyan);
      for (const side of [-1, 1]) {
        kit.box(object, [0.24, 3.3, 0.3], [side * 2.15, 1.65, -3.1], steel);
        kit.box(object, [0.12, 2.9, 0.32], [side * 2.15, 1.7, -3.1], cyan);
      }
      kit.box(object, [4.65, 0.25, 0.4], [0, 3.45, -3.1], dark);
      kit.label(object, '02 / 交付终端', 2.7, 0.62, [0, 3.0, -2.86]);
      kit.housing(object, 0.65, 0.9, 0.55, [2.7, 0.45, -2.7], dark);
      kit.box(object, [0.42, 0.35, 0.04], [2.7, 0.77, -2.4], cyan);
    }
  }
  for (const xM of [35, 48, 65, 91]) {
    for (let index = 0; index < 3; index++) {
      const crate = createCargoView(kit);
      const positionM = xM + index * 0.85;
      crate.position.set(positionM, terrain.sample(positionM).heightM - 0.15, -6.2);
      world.add(crate);
    }
  }
  return world;
}
