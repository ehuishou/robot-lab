import { createEnvironmentView, updateEnvironmentView } from './EnvironmentView';
import { routePose, environmentTerrain, ROUTE_LANE_OFFSET_M, routeDistance } from '../domain/simulation/environment';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Configuration } from '../domain/config/validateConfiguration';
import type { MissionDefinition } from '../domain/mission/definition';
import { createTerrainSampler } from '../domain/simulation/terrain';
import type { TerrainSampler } from '../domain/simulation/terrain';
import { PhysicsOverlay } from './PhysicsOverlay';
import { ModelKit } from './ModelKit';
import { createRobotView } from './RobotView';
import { bodyOrigin } from '../domain/simulation/quadruped';
import { ChassisAnimation } from './ChassisAnimation';
import { createLogisticsBay } from './LogisticsBay';
import { createCargoView } from './LogisticsBay';
import type { RenderSnapshot } from '../domain/mission/session';

export class PreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 160);
  private readonly kit = new ModelKit();
  private readonly physicsOverlay = new PhysicsOverlay();
  private worldKit = new ModelKit();
  private terrain: TerrainSampler;
  private readonly key = new THREE.DirectionalLight('#ffe6c7', 3.5);
  private readonly rim = new THREE.DirectionalLight('#a0ddff', 1.9);
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly observer: ResizeObserver;
  private robot: THREE.Group;
  private locomotion: ChassisAnimation;
  private world: THREE.Group;
  private readonly carriedCrate: THREE.Group;
  private readonly items = new Map<string, THREE.Object3D>();
  private snapshot: RenderSnapshot | null = null;
  onFrame: ((timestampMs: number) => void) | null = null;
  private frameId: number | null = null;
  private focusXM = 40;
  private cameraTarget: THREE.Vector3 | null = null;
  private lastCameraTime = 0;
  private view: 'configuration' | 'world' = 'configuration';
  private yaw = 0;
  private zoom = 1;
  private disposed = false;
  private suspended = false;
  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => {
    this.suspended = document.hidden;
    if (this.suspended) this.stop();
    else this.draw();
  };
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.stop();
    this.onFailure(new Error('Three.js WebGL 上下文丢失，请重新加载视觉小样。'));
  };

  constructor(private readonly container: HTMLElement, configuration: Configuration, private mission: MissionDefinition,
    private readonly onFailure: (error: unknown) => void) {
    this.terrain = createTerrainSampler(mission.terrain);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Three.js 工业机器人视觉小样');
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#1b3045');
    this.scene.fog = new THREE.Fog('#263f54', 30, 95);
    const environmentScene = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    try { this.environment = environmentGenerator.fromScene(environmentScene, 0.04); }
    finally { environmentScene.dispose(); environmentGenerator.dispose(); }
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    this.scene.add(new THREE.HemisphereLight('#c6e5fa', '#3c4653', 1.1));
    const key = this.key;
    key.position.set(35, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -11;
    key.shadow.camera.right = 11;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    key.shadow.normalBias = 0.015;
    key.shadow.bias = -0.0001;
    key.target.position.set(40, 0, 0);
    this.scene.add(key, key.target);
    this.rim.position.set(46, 6, -6);
    this.rim.target.position.set(40, 1, 0);
    this.scene.add(this.rim, this.rim.target);
    this.world = createLogisticsBay(this.worldKit, mission);
    this.world.add(createEnvironmentView(this.worldKit, mission));
    this.scene.add(this.world);
    for (const item of mission.layout) this.items.set(item.id, this.world.getObjectByName(item.id)!);
    this.carriedCrate = new THREE.Group();
    this.buildCarriedViews();
    this.carriedCrate.visible = false;
    this.scene.add(this.carriedCrate);
    this.robot = createRobotView(this.kit, configuration);
    this.locomotion = new ChassisAnimation(this.robot);
    this.focusXM = mission.layout.find(item => item.kind === 'cargo')?.xM ?? mission.spawnXM;
    this.robot.position.set(this.focusXM, this.terrain.sample(this.focusXM).heightM, 0.4);
    this.scene.add(this.robot, this.physicsOverlay.group);
    this.locomotion.update(this.focusXM, this.terrain);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.draw();
  }

  setConfiguration(configuration: Configuration): void {
    this.scene.remove(this.robot);
    this.robot = createRobotView(this.kit, configuration);
    this.locomotion = new ChassisAnimation(this.robot);
    const sample = this.terrain.sample(this.focusXM);
    this.robot.position.set(this.focusXM, sample.heightM, 0.4);
    this.robot.rotation.set(0, 0, THREE.MathUtils.degToRad(sample.slopeDegrees));
    this.scene.add(this.robot);
    this.locomotion.update(this.focusXM, this.terrain);
    this.render();
  }

  setMission(mission: MissionDefinition): void {
    if (mission.id === this.mission.id) return;
    const terrain = createTerrainSampler(mission.terrain);
    const kit = new ModelKit();
    let world: THREE.Group;
    try { world = createLogisticsBay(kit, mission); world.add(createEnvironmentView(kit, mission)); }
    catch (error) { kit.dispose(); throw error; }
    this.scene.remove(this.world);
    this.world.clear();
    this.worldKit.dispose();
    this.worldKit = kit;
    this.world = world;
    this.mission = mission;
    this.terrain = terrain;
    this.items.clear();
    for (const item of mission.layout) this.items.set(item.id, world.getObjectByName(item.id)!);
    this.scene.add(world);
    this.buildCarriedViews();
    this.setSnapshot(null);
    this.setView(this.view, mission.layout.find(item => item.kind === 'cargo')?.xM ?? mission.spawnXM);
  }

  private buildCarriedViews(): void {
    this.carriedCrate.clear();
    for (const item of this.mission.layout) if (item.kind === 'cargo') {
      const crate = createCargoView(this.worldKit, item.cargo.massKg);
      crate.userData.cargoId = item.id;
      this.carriedCrate.add(crate);
    }
  }

  setView(view: 'configuration' | 'world', focusXM = this.focusXM): void {
    this.view = view;
    this.focusXM = focusXM;
    const sample = this.terrain.sample(focusXM);
    this.positionLights(sample.heightM);
    if (!this.snapshot) {
      this.robot.position.set(focusXM, sample.heightM, 0.4);
      this.robot.rotation.z = THREE.MathUtils.degToRad(sample.slopeDegrees);
    }
    if (!this.snapshot) { this.locomotion.reset(); this.locomotion.update(focusXM, this.terrain); }
    this.yaw = 0;
    this.zoom = 1;
    this.render();
  }

  orbit(delta: number): void {
    this.yaw = Math.max(-0.8, Math.min(0.8, this.yaw + delta));
    this.render();
  }

  setSnapshot(snapshot: RenderSnapshot | null): void {
    if (!snapshot || !this.snapshot || this.snapshot.sessionId !== snapshot.sessionId) this.locomotion.reset();
    this.snapshot = snapshot;
    updateEnvironmentView(this.world,this.mission,snapshot?.environment??null,snapshot?.robot.xM??0,snapshot?.robot.speedMps??0);
    this.physicsOverlay.update(snapshot?.robot.quadruped ?? null, this.terrain);
    this.carriedCrate.visible = !!snapshot?.robot.carriedCargoIds.length;
    const carriedIds = snapshot?.robot.carriedCargoIds ?? [];
    for (const crate of this.carriedCrate.children) {
      const index = carriedIds.indexOf(crate.userData.cargoId);
      crate.visible = index >= 0;
      crate.position.x = (index - (carriedIds.length - 1) / 2) * .9;
    }
    for (const item of this.mission.layout) {
      const object = this.items.get(item.id)!;
      const state = snapshot?.items.find(candidate => candidate.id === item.id);
      object.visible = !state || state.status === 'world' || state.status === 'delivered';
      const deliveredOffset = state?.status === 'delivered' ? this.mission.layout.filter(i=>i.kind==='cargo').findIndex(i=>i.id===item.id) * .95 - .45 : 0;
      object.position.set((state?.xM ?? item.xM) + deliveredOffset, (state?.heightM ?? this.terrain.sample(item.xM).heightM) + 0.05, 0);
    }
    if (snapshot) {
      this.focusXM = snapshot.robot.xM;
      const lane=ROUTE_LANE_OFFSET_M;
      this.robot.position.set(snapshot.robot.xM, snapshot.robot.heightM, lane+snapshot.robot.zM);
      this.robot.rotation.set(0, 0, THREE.MathUtils.degToRad(snapshot.robot.slopeDegrees));
      if (snapshot.robot.quadruped) {
        this.robot.position.set(...bodyOrigin(snapshot.robot.quadruped));
        this.robot.quaternion.set(...snapshot.robot.quadruped.orientation);
      }
      const cargoOffset = new THREE.Vector3(0, 1.1, 0).applyQuaternion(this.robot.quaternion);
      this.carriedCrate.position.copy(this.robot.position).add(cargoOffset);
      this.carriedCrate.quaternion.copy(this.robot.quaternion);
      const activeTerrain=snapshot.environment&&this.mission.environment?environmentTerrain(this.mission.environment,snapshot.environment,this.terrain):this.terrain;
      this.locomotion.update(snapshot.robot.xM, activeTerrain, snapshot.robot.quadruped, snapshot.environment&&this.mission.environment ? (from,to)=>routeDistance(this.mission.environment!,snapshot.environment!.choices,this.terrain,from,to) : undefined);
      if(snapshot.environment&&this.mission.environment&&!snapshot.robot.quadruped){const p=routePose(this.mission.environment.sections,snapshot.environment.choices,this.terrain,snapshot.robot.xM);this.robot.rotation.y=-Math.atan(p.dz)}
      const attachment=this.robot.getObjectByName('tool_blade');if(attachment&&snapshot.environment)attachment.rotation.z=snapshot.environment.work?.kind==='clear'?0:.22;
      this.positionLights(snapshot.robot.heightM);
    } else {
      const sample = this.terrain.sample(this.focusXM);
      this.robot.position.set(this.focusXM, sample.heightM, 0.4);
      this.robot.rotation.z = THREE.MathUtils.degToRad(sample.slopeDegrees);
    }
  }

  togglePhysicsOverlay(): boolean {
    this.physicsOverlay.enabled = !this.physicsOverlay.enabled;
    this.physicsOverlay.update(this.snapshot?.robot.quadruped ?? null, this.terrain);
    this.render();
    return this.physicsOverlay.enabled;
  }

  adjustZoom(delta: number): void {
    this.zoom = Math.max(0.7, Math.min(1.4, this.zoom + delta));
    this.render();
  }

  get diagnostics(): Readonly<Record<string, unknown>> {
    const realizedAssets = new Set<string>();
    this.scene.traverse(object => { if (object.userData.assetId) realizedAssets.add(object.userData.assetId); });
    let maxSurfaceErrorM = 0;
    this.world.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.userData.terrainSurface) return;
      const positions = object.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) maxSurfaceErrorM = Math.max(maxSurfaceErrorM,
        Math.abs(positions.getY(index) - this.terrain.sample(positions.getX(index)).heightM - object.userData.terrainSurface.offsetM));
    });
    const worldResources = this.worldKit.resources;
    const robotResources = this.kit.resources;
    return { renderer: `Three.js r${THREE.REVISION} / WebGL2`, view: this.view, focusXM: this.focusXM, cameraTarget: this.cameraTarget?.toArray(), robotZM: this.robot.position.z, robotYaw: this.robot.rotation.y, missionId: this.mission.id,
      viewport: { width: this.container.clientWidth, height: this.container.clientHeight,
        drawingBufferWidth: this.renderer.domElement.width, drawingBufferHeight: this.renderer.domElement.height,
        pixelRatio: this.renderer.getPixelRatio(), cameraAspect: this.camera.aspect },
      realizedAssets: [...realizedAssets],
      physicsOverlayVisible: this.physicsOverlay.group.visible,
      locomotion: this.locomotion.diagnostics, quadruped: this.snapshot?.robot.quadruped ?? null,
      moduleIds: this.robot.userData.moduleIds, assetIds: this.robot.children.flatMap(component => component.userData.assetId ? [component.userData.assetId] : []),
      resources: { geometries: robotResources.geometries + worldResources.geometries,
        materials: robotResources.materials + worldResources.materials, textures: robotResources.textures + worldResources.textures }, drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, activeLoop: this.frameId !== null && !this.disposed && !this.suspended,
      lighting: { environment: !!this.scene.environment, environmentIntensity: this.scene.environmentIntensity,
        keyXM: this.key.target.position.x, rimXM: this.rim.target.position.x },
      disposed: this.disposed, robotXM: this.robot.position.x, robotHeightM: this.robot.position.y,
      robotSlopeDegrees: THREE.MathUtils.radToDeg(this.robot.rotation.z), carriedCrateVisible: this.carriedCrate.visible,
      terrain: { id: this.terrain.id, maxSurfaceErrorM, loadingHeightM: this.world.getObjectByName('loading-platform')?.position.y },
      items: [...this.items].map(([id, object]) => ({ id, visible: object.visible, xM: object.position.x, heightM: object.position.y })) };
  }

  stop(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onFrame = null;
    this.stop();
    this.observer.disconnect();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.clear();
    this.scene.environment = null;
    this.environment.dispose();
    this.physicsOverlay.dispose();
    this.kit.dispose();
    this.worldKit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const distance = (this.view === 'configuration' ? 8.8 : 17) * this.zoom * Math.max(1, Math.min(1.65, 0.95 / this.camera.aspect));
    const azimuth = -0.42 + this.yaw;
    const target = new THREE.Vector3(this.focusXM + 0.2,
      this.robot.position.y + (this.view === 'configuration' ? 1.1 : 0.8), this.robot.position.z-0.1);
    if(this.snapshot?.environment&&this.mission.environment){
      const p=routePose(this.mission.environment.sections,this.snapshot.environment.choices,this.terrain,this.focusXM);
      if(p.bypass){
        const ahead=routePose(this.mission.environment.sections,this.snapshot.environment.choices,this.terrain,Math.max(0,Math.min(this.terrain.lengthM,this.focusXM+(this.snapshot.robot.speedMps<-.1?-1:1)*1.3)));
        target.z=target.z*.7+ahead.zM*.3;
      }
    }
    const now=performance.now(), dt=Math.min(.1,(now-this.lastCameraTime)/1000);this.lastCameraTime=now;
    if(!this.cameraTarget||this.cameraTarget.distanceTo(target)>25)this.cameraTarget=target.clone();
    else this.cameraTarget.lerp(target,1-Math.exp(-dt*8));
    target.copy(this.cameraTarget);
    this.camera.position.set(target.x + Math.sin(azimuth) * distance, target.y + distance * 0.38,
      target.z + Math.cos(azimuth) * distance);
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }

  private positionLights(heightM: number): void {
    this.key.position.set(this.focusXM - 5, heightM + 10, 7);
    this.key.target.position.set(this.focusXM, heightM, 0);
    this.key.target.updateMatrixWorld();
    this.rim.position.set(this.focusXM + 6, heightM + 6, -6);
    this.rim.target.position.set(this.focusXM, heightM + 1, 0);
    this.rim.target.updateMatrixWorld();
  }

  private draw = (timestampMs = performance.now()): void => {
    if (this.disposed || this.suspended) return;
    try {
      this.onFrame?.(timestampMs);
      this.render();
      this.frameId = requestAnimationFrame(this.draw);
    } catch (error) {
      this.stop();
      this.onFailure(error);
    }
  };
}

