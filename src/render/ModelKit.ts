import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { TerrainSampler } from '../domain/simulation/terrain';

export class ModelKit {
  readonly materials = {
    paint: new THREE.MeshPhysicalMaterial({ color: '#d8e3e4', roughness: 0.34, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#203445', roughness: 0.48, metalness: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: '#a3b3bc', roughness: 0.27, metalness: 0.88 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#131c25', roughness: 0.86, metalness: 0 }),
    orange: new THREE.MeshStandardMaterial({ color: '#e9a03d', roughness: 0.37, metalness: 0.3 }),
    cyan: new THREE.MeshStandardMaterial({ color: '#48dae4', emissive: '#25aab6', emissiveIntensity: 0.6, roughness: 0.4 }),
    bypass: new THREE.MeshStandardMaterial({ color:'#59746f', roughness:.92 }),
    soil: new THREE.MeshStandardMaterial({ color:'#725136', roughness:1 }),
    ground: new THREE.MeshStandardMaterial({ color: '#435462', roughness: 0.83, metalness: 0.12 }),
    wall: new THREE.MeshStandardMaterial({ color: '#2b4053', roughness: 0.82, metalness: 0.25 }),
    window: new THREE.MeshStandardMaterial({ color: '#75a8bc', emissive: '#4b708d', emissiveIntensity: 0.45, roughness: 0.32 }),
  };
  private surfaceDetailsReady = false;

  constructor(private readonly anisotropy = 1) {}

  // Linear grayscale modulation: one small shared map supplies colour grain,
  // roughness and millimetre-scale relief, without downloads or extra geometry.
  private prepareSurfaceDetails(): void {
    if (this.surfaceDetailsReady) return;
    this.surfaceDetailsReady = true;
    for (const [kind, seed] of [['ground', 17], ['soil', 71]] as const) {
      const size = 128, data = new Uint8Array(size * size * 4);
      let state = seed;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const grain = state / 0xffffffff;
        const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
        const pattern = kind === 'soil' ? Math.sin(u * 3 + Math.sin(v) * .6) * 9 : Math.cos(u) * Math.cos(v) * 3;
        const value = Math.round(220 + grain * 24 + pattern), offset = (y * size + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = value;
        data[offset + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, size, size);
      texture.name = `${kind}-surface-detail`;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      this.textures.push(texture);
      const material = this.materials[kind];
      material.map = material.roughnessMap = material.bumpMap = texture;
      material.bumpScale = kind === 'soil' ? .024 : .009;
    }
  }

  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly textures: THREE.Texture[] = [];
  private readonly labelMaterials: THREE.Material[] = [];
  private readonly labelCache = new Map<string, THREE.MeshBasicMaterial>();

  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material,
    position: readonly [number, number, number], rotation: readonly [number, number, number] = [0, 0, 0]): THREE.Mesh {
    if (material === this.materials.ground || material === this.materials.soil) this.prepareSurfaceDetails();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(parent: THREE.Object3D, size: readonly [number, number, number], position: readonly [number, number, number],
    material: THREE.Material, rotation: readonly [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const key = `box:${size.join(',')}`;
    return this.mesh(parent, this.geometry(key, () => new THREE.BoxGeometry(...size)), material, position, rotation);
  }

  terrainSurface(parent: THREE.Object3D, terrain: TerrainSampler, startM: number, endM: number,
    widthM: number, zM: number, offsetM: number, material: THREE.Material): THREE.Mesh {
    const key = `terrain:${terrain.id}:${startM}:${endM}:${widthM}:${zM}:${offsetM}`;
    const geometry = this.geometry(key, () => {
      const surface = new THREE.PlaneGeometry(endM - startM, widthM, Math.ceil((endM - startM) / 0.5), 1);
      surface.rotateX(-Math.PI / 2);
      surface.translate((startM + endM) / 2, 0, zM);
      const positions = surface.getAttribute('position'), uv = surface.getAttribute('uv');
      for (let index = 0; index < positions.count; index++) {
        positions.setY(index, terrain.sample(positions.getX(index)).heightM + offsetM);
        uv.setXY(index, positions.getX(index), positions.getZ(index));
      }
      surface.computeVertexNormals();
      return surface;
    });
    const surface = this.mesh(parent, geometry, material, [0, 0, 0]);
    surface.userData.terrainSurface = { offsetM, startM, endM };
    return surface;
  }

  cylinder(parent: THREE.Object3D, radius: number, length: number, position: readonly [number, number, number],
    material: THREE.Material, rotation: readonly [number, number, number] = [0, 0, 0], segments = 32): THREE.Mesh {
    const key = `cylinder:${radius}:${length}:${segments}`;
    return this.mesh(parent, this.geometry(key, () => new THREE.CylinderGeometry(radius, radius, length, segments)), material, position, rotation);
  }

  housing(parent: THREE.Object3D, width: number, height: number, depth: number,
    position: readonly [number, number, number], material: THREE.Material): THREE.Mesh {
    const bevel = Math.min(0.08, Math.min(width, height, depth) * 0.18);
    const key = `housing:${width}:${height}:${depth}`;
    const geometry = this.geometry(key, () => new RoundedBoxGeometry(width, height, depth, 2, bevel));
    return this.mesh(parent, geometry, material, position);
  }

  beam(parent: THREE.Object3D, start: readonly [number, number, number], end: readonly [number, number, number],
    thickness: number, material: THREE.Material, depth = thickness): THREE.Mesh {
    const startVector = new THREE.Vector3(...start);
    const endVector = new THREE.Vector3(...end);
    const direction = endVector.clone().sub(startVector);
    const midpoint = startVector.add(endVector).multiplyScalar(0.5);
    const beam = this.housing(parent, thickness, direction.length(), depth, [midpoint.x, midpoint.y, midpoint.z], material);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return beam;
  }

  ring(parent: THREE.Object3D, radius: number, tube: number, position: readonly [number, number, number], material: THREE.Material): THREE.Mesh {
    return this.mesh(parent, this.geometry(`ring:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 10, 48)),
      material, position, [Math.PI / 2, 0, 0]);
  }

  strut(parent: THREE.Object3D, start: readonly [number, number, number], end: readonly [number, number, number],
    radius: number, material: THREE.Material): THREE.Mesh {
    const direction = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
    const midpoint = new THREE.Vector3(...start).add(new THREE.Vector3(...end)).multiplyScalar(0.5);
    const strut = this.cylinder(parent, radius, direction.length(), [midpoint.x, midpoint.y, midpoint.z], material);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return strut;
  }

  cable(parent: THREE.Object3D, points: readonly (readonly [number, number, number])[], radius: number, material: THREE.Material): THREE.Mesh {
    const key = `cable:${radius}:${points.flat().join(',')}`;
    const geometry = this.geometry(key, () => new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), 24, radius, 8, false));
    return this.mesh(parent, geometry, material, [0, 0, 0]);
  }

  label(parent: THREE.Object3D, text: string, width: number, height: number, position: readonly [number, number, number],
    color = '#dce8ec', background = '#162d3e'): THREE.Mesh {
    const aspect = width / height;
    const key = `${text}:${color}:${background}:${aspect}`;
    let material = this.labelCache.get(key);
    if (!material) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(128, Math.min(1536, Math.round(192 * aspect)));
      canvas.height = Math.max(1, Math.round(canvas.width / aspect));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法生成场景标识。');
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = color;
      let fontSize = Math.round(canvas.height * .43);
      context.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`;
      const availableWidth = canvas.width * .9;
      const measuredWidth = context.measureText(text).width;
      if (measuredWidth > availableWidth) {
        fontSize = Math.max(1, Math.floor(fontSize * availableWidth / measuredWidth));
        context.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`;
      }
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, canvas.width / 2, canvas.height / 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.anisotropy;
      this.textures.push(texture);
      material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      this.labelMaterials.push(material);
      this.labelCache.set(key, material);
    }
    const plane = this.mesh(parent, this.geometry(`label:${width}:${height}`, () => new THREE.PlaneGeometry(width, height)), material, position);
    plane.castShadow = false;
    plane.receiveShadow = false;
    return plane;
  }

  get resources(): Readonly<{ geometries: number; materials: number; textures: number }> {
    return { geometries: this.geometries.size, materials: Object.keys(this.materials).length + this.labelMaterials.length,
      textures: this.textures.length };
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of [...Object.values(this.materials), ...this.labelMaterials]) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.labelMaterials.length = 0;
    this.labelCache.clear();
    this.textures.length = 0;
  }

  geometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = create();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }
}
