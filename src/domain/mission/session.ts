import { createEnvironmentState, simulateEnvironmentStep, reconcileContactMotion, constrainEnvironmentMotion, routePose, environmentTerrain, ROUTE_LANE_OFFSET_M, routeProjection, beginWork, nearestJunction, QUADRUPED_SOIL_FRICTION } from '../simulation/environment';
import type { EnvironmentState, EnvironmentMotion } from '../simulation/environment';
import { createChallengeSnapshot, scoreChallenge } from './scoring';
import type { ChallengeSnapshot, ChallengeScore } from './scoring';
import { bodyOrigin, createQuadruped, perturbQuadruped, robotMassElements, stepQuadruped, updateQuadrupedMass } from '../simulation/quadruped';
import type { QuadrupedState } from '../simulation/quadruped';
import type { AssetDefinition } from '../../content/assets';
import { MODULE_CATEGORIES, validateConfiguration } from '../config/validateConfiguration';
import type { Configuration, ConfigurationValidation, ModuleCategory, ModuleDefinition } from '../config/validateConfiguration';
import { carriedMassKg, createCargoState, deliverCargo, pickUpCargo } from '../simulation/cargo';
import type { CargoResult, CargoState } from '../simulation/cargo';
import { deriveDrivingParameters, simulateDrivingStep, validDrivingIntent } from '../simulation/driving';
import type { DrivingIntent, DrivingParameters } from '../simulation/driving';
import { createTerrainSampler } from '../simulation/terrain';
import type { MissionDefinition } from './definition';
import { CARGO_CAPABILITY, validateMission } from './validateMission';

export type FailureReason = 'timeExceeded' | 'energyExhausted' | 'overturned';

export interface DomainEvent {
  readonly sessionId: string;
  readonly eventId: string;
  readonly atSeconds: number;
  readonly kind: 'created' | 'advanced' | 'paused' | 'resumed' | 'pickedUp' | 'delivered' | 'interactionRejected' | 'succeeded' | 'failed';
  readonly objectId?: string;
  readonly cargoIds?: readonly string[];
  readonly failure?: FailureReason;
  readonly rejection?: SessionRejection;
}

export interface SessionState {
  readonly sessionId: string;
  readonly phase: 'running' | 'paused' | 'succeeded' | 'failed';
  readonly mission: MissionDefinition;
  readonly configuration: Configuration;
  readonly challenge: ChallengeSnapshot | null;
  readonly parameters: NonNullable<ConfigurationValidation['summary']>;
  readonly drivingParameters: DrivingParameters;
  readonly environment: EnvironmentState | null;
  readonly catalogSnapshot: readonly ModuleDefinition[];
  readonly quadruped: QuadrupedState | null;
  readonly moduleViews: readonly Readonly<{ category: ModuleCategory; moduleId: string; viewAssetId: string }>[];
  readonly xM: number;
  readonly heightM: number;
  readonly slopeDegrees: number;
  readonly speedMps: number;
  readonly elapsedSeconds: number;
  readonly energyRemainingUnits: number;
  readonly energyConsumedUnits: number;
  readonly energyRestoredUnits: number;
  readonly cargo: CargoState;
  readonly stagedCargo: Readonly<Record<string, number>>;
  readonly deliveries: readonly Readonly<{ cargoId: string; zoneId: string }>[];
  readonly completedObjectiveIds: readonly string[];
  readonly processedCommandIds: readonly string[];
  readonly result: Readonly<{ outcome: 'succeeded' | 'failed'; failure?: FailureReason; score?: ChallengeScore }> | null;
  readonly eventSequence: number;
}

interface CommandIdentity {
  readonly sessionId: string;
  readonly commandId: string;
}

export type SessionInteraction =
  | { readonly kind: 'pickup'; readonly objectId: string }
  | { readonly kind: 'deliver'; readonly zoneId: string; readonly cargoIds: readonly string[] };

export type SessionCommand = CommandIdentity & (
  | { readonly kind: 'drive'; readonly deltaSeconds: number; readonly intent: DrivingIntent;
      readonly interactions?: readonly SessionInteraction[] }
  | SessionInteraction
  | { readonly kind: 'route'; readonly sectionId: string; readonly route: 'direct' | 'bypass' }
  | { readonly kind: 'work' }
  | { readonly kind: 'stage'; readonly cargoIds: readonly string[] }
  | { readonly kind: 'assist'; readonly enabled: boolean }
  | { readonly kind: 'physicsTest'; readonly action: 'push' | 'topple' | 'reset' }
  | { readonly kind: 'pause' | 'resume' }
);

export type SessionRejection = 'staleSession' | 'duplicateCommand' | 'invalidCommand' | 'inactiveSession'
  | 'unknownObject' | 'outOfRange' | 'wrongDeliveryZone' | Extract<CargoResult, { accepted: false }>['reason'];

export type SessionTransition =
  | { readonly accepted: true; readonly state: SessionState; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly state: SessionState; readonly events: readonly DomainEvent[]; readonly reason: SessionRejection };

function freezeSnapshot<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeSnapshot(nested);
    Object.freeze(value);
  }
  return value;
}

export function createMissionSession(
  sessionId: string, mission: MissionDefinition, configuration: Configuration,
  catalog: readonly ModuleDefinition[], assets: readonly AssetDefinition[],
): Readonly<{ state: SessionState; events: readonly DomainEvent[] }> {
  if (!sessionId.trim()) throw new RangeError('必须由应用提供新的非空会话 ID。');
  const content = validateMission(mission, catalog, assets);
  if (!content.valid) throw new RangeError(content.issues.map(issue => issue.message).join('\n'));
  const validation = validateConfiguration(configuration, catalog, mission.configurationRules);
  const parameters = validation.summary;
  if (!validation.valid || !parameters || parameters.batteryCapacityUnits <= 0) throw new RangeError('无法用非法配置或空电池启动会话。');
  for (const objective of mission.objectives) {
    if (objective.kind !== 'deliver') continue;
    for (const cargoId of objective.cargoIds) {
      const item = mission.layout.find(candidate => candidate.id === cargoId);
      if (!item || item.kind !== 'cargo' || !parameters.capabilities.includes(CARGO_CAPABILITY[item.cargo.kind])
        || parameters.payloadKg < item.cargo.massKg) throw new RangeError('配置无法搬运目标货物。');
    }
  }
  const sample = createTerrainSampler(mission.terrain).sample(mission.spawnXM);
  const state: SessionState = {
    sessionId, phase: 'running', mission: structuredClone(mission), configuration: { ...configuration },
    challenge: mission.challenge ? createChallengeSnapshot(mission.id, mission.challenge,
      MODULE_CATEGORIES.reduce((sum, category) => {const module = catalog.find(m=>m.id===configuration[category])!;return sum+(module ? (module.referenceCost ?? module.cost) : 0);},0), !!mission.testMode) : null,
    catalogSnapshot: structuredClone(catalog), environment: mission.environment ? createEnvironmentState(configuration) : null,
    quadruped: configuration.chassis === 'chassis_quadruped' ? createQuadruped(robotMassElements(configuration, catalog, mission.configurationRules.baseMassKg), sample.xM, createTerrainSampler(mission.terrain)) : null,
    moduleViews: MODULE_CATEGORIES.filter(category => !!configuration[category]).map(category => {
      const module = catalog.find(candidate => candidate.id === configuration[category])!;
      return { category, moduleId: module.id, viewAssetId: module.viewAssetId };
    }),
    parameters: { ...parameters, capabilities: [...parameters.capabilities] },
    drivingParameters: deriveDrivingParameters(configuration, catalog), xM: sample.xM,
    heightM: sample.heightM, slopeDegrees: sample.slopeDegrees, speedMps: 0, elapsedSeconds: 0,
    energyRemainingUnits: parameters.batteryCapacityUnits, energyConsumedUnits: 0, energyRestoredUnits: 0,
    cargo: createCargoState(sessionId, parameters.payloadKg, parameters.capabilities), stagedCargo:{}, deliveries: [],
    completedObjectiveIds: [], processedCommandIds: [], result: null, eventSequence: 1,
  };
  return freezeSnapshot({ state, events: [{ sessionId, eventId: `${sessionId}:1`, atSeconds: 0, kind: 'created' as const }] });
}

export function transitionSession(state: SessionState, command: SessionCommand): SessionTransition {
  return applyCommand(state, command, false);
}

function validInteractions(interactions: readonly SessionInteraction[] | undefined): boolean {
  return interactions === undefined || Array.isArray(interactions) && interactions.every(interaction => {
    if (!interaction || typeof interaction !== 'object') return false;
    if (interaction.kind === 'deliver') return typeof interaction.zoneId === 'string' && !!interaction.zoneId.trim()
      && Array.isArray(interaction.cargoIds) && interaction.cargoIds.every((id: unknown) => typeof id === 'string' && !!id.trim());
    return interaction.kind === 'pickup' && typeof interaction.objectId === 'string' && !!interaction.objectId.trim();
  });
}

function applyCommand(state: SessionState, command: SessionCommand, deferSettlement: boolean): SessionTransition {
  const reject = (reason: SessionRejection): SessionTransition => freezeSnapshot({ accepted: false as const, state, events: [], reason });
  if (command.sessionId !== state.sessionId) return reject('staleSession');
  if (!command.commandId?.trim()) return reject('invalidCommand');
  if (state.processedCommandIds.includes(command.commandId)) return reject('duplicateCommand');
  if (state.result) return reject('inactiveSession');
  const events: DomainEvent[] = [];
  let next = state;
  const emit = (kind: DomainEvent['kind'], detail: Partial<Pick<DomainEvent, 'objectId' | 'cargoIds' | 'failure' | 'rejection'>> = {}) => {
    events.push({ sessionId: state.sessionId, eventId: `${state.sessionId}:${state.eventSequence + events.length + 1}`,
      atSeconds: next.elapsedSeconds, kind, ...detail });
  };
  if (command.kind === 'pause') {
    if (state.phase !== 'running') return reject('inactiveSession');
    next = { ...state, phase: 'paused' };
    emit('paused');
  } else if (command.kind === 'resume') {
    if (state.phase !== 'paused') return reject('inactiveSession');
    next = { ...state, phase: 'running' };
    emit('resumed');
  } else if (command.kind === 'route') {
    if (state.phase !== 'running' && state.phase !== 'paused') return reject('inactiveSession');
    if (!state.environment || !state.mission.environment || state.environment.work || !['direct','bypass'].includes(command.route)) return reject('invalidCommand');
    const section = nearestJunction(state.mission.environment.sections.filter(s=>s.id===command.sectionId),state.xM);
    if (!section || section.id !== command.sectionId) return reject('outOfRange');
    // A bridge decision freezes motion, so choosing does not require braking first.
    // Other paused actions and ordinary moving route changes keep their safety guards.
    if (state.phase === 'paused' ? section.kind !== 'bridge' : Math.abs(state.speedMps) > .75) return reject('invalidCommand');
    if (section.kind === 'bridge' && command.route === 'direct' && state.configuration.chassis !== 'chassis_quadruped') return reject('invalidCommand');
    next = {...state,environment:{...state.environment,choices:{...state.environment.choices,[section.id]:command.route}}};
    emit('advanced');
  } else {
    if (state.phase !== 'running') return reject('inactiveSession');
    if (command.kind === 'assist') {
      if (!state.environment || typeof command.enabled!=='boolean') return reject('invalidCommand');
      next={...state,environment:{...state.environment,assist:command.enabled}};emit('advanced');
    } else if (command.kind === 'stage') {
      if(!state.environment || state.environment.work || Math.abs(state.speedMps)>.25 || Math.abs(state.environment.zM)>.5
        || !state.mission.platforms.some(p=>state.xM>=p.startM&&state.xM<=p.endM))return reject('outOfRange');
      if(!Array.isArray(command.cargoIds)||!command.cargoIds.length||new Set(command.cargoIds).size!==command.cargoIds.length
        || command.cargoIds.some(id=>!state.cargo.carried.some(c=>c.id===id)))return reject('notCarried');
      const stagedCargo={...state.stagedCargo};for(const id of command.cargoIds)stagedCargo[id]=state.xM;
      next={...state,stagedCargo,cargo:{...state.cargo,carried:state.cargo.carried.filter(c=>!command.cargoIds.includes(c.id))},
        environment:{...state.environment,work:{kind:'unload',sectionId:'staging',seconds:0,duration:1.2,units:87.5*command.cargoIds.length/state.environment.model.joulesPerUnit,count:command.cargoIds.length}}};
      emit('advanced');
    } else if (command.kind === 'work') {
      if (!state.environment || !state.mission.environment) return reject('invalidCommand');
      const environment=beginWork(state.mission.environment,state.environment,state.configuration,state.xM,state.speedMps,carriedMassKg(state.cargo),state.parameters.payloadKg,state.parameters.batteryCapacityUnits-state.energyRemainingUnits);
      if (!environment) return reject('outOfRange');
      next={...state,environment};emit('advanced');
    } else if (command.kind === 'physicsTest') {
      if (!state.mission.testMode || !state.quadruped || !['push','topple','reset'].includes(command.action)) return reject('invalidCommand');
      const old = state.quadruped;
      const quadruped = command.action === 'reset'
        ? createQuadruped(old.dryMass, state.xM, createTerrainSampler(state.mission.terrain), carriedMassKg(state.cargo))
        : perturbQuadruped(old, [0, 0, old.mass.massKg * (command.action === 'push' ? .45 : 4)], [old.position[0], old.position[1] + .8, old.position[2]]);
      next = { ...state, quadruped, speedMps: command.action === 'reset' ? 0 : state.speedMps };
      emit('advanced');
    } else if (command.kind === 'drive') {
      const terrain = createTerrainSampler(state.mission.terrain);
      const lengthM = terrain.lengthM;
      if (!Number.isFinite(command.deltaSeconds) || command.deltaSeconds <= 0
        || !validInteractions(command.interactions)) return reject('invalidCommand');
      if ((!validDrivingIntent(command.intent) || command.deltaSeconds > 1 / 30)) return reject('invalidCommand');
      const elapsedSeconds = state.elapsedSeconds + command.deltaSeconds;
      if (!Number.isFinite(elapsedSeconds)) return reject('invalidCommand');
      for (const [index, interaction] of (command.interactions ?? []).entries()) {
        const result = applyCommand(next, { ...interaction, sessionId: state.sessionId,
          commandId: `${command.commandId}:interaction:${index}` }, true);
        if (result.accepted) {
          next = result.state;
          events.push(...result.events);
        } else {
          emit('interactionRejected', { objectId: interaction.kind === 'deliver' ? interaction.zoneId : interaction.objectId, rejection: result.reason });
          next = { ...next, eventSequence: state.eventSequence + events.length };
        }
      }
      let motion: Readonly<{ xM: number; speedMps: number; energyConsumedUnits: number }>;
      let environmentMotion: EnvironmentMotion | null = null;
      const environmentBefore = next.environment;
      try {
        if (next.environment && next.mission.environment) {
          const simulated=simulateEnvironmentStep(next.mission.environment,next.environment,{xM:next.xM,speedMps:next.speedMps,massKg:next.parameters.massKg+carriedMassKg(next.cargo),energy:next.energyRemainingUnits,capacity:next.parameters.batteryCapacityUnits,testMode:!!next.mission.testMode},command.intent,terrain,command.deltaSeconds);
          motion=simulated;environmentMotion=simulated;
          next={...next,environment:simulated.environment,energyRestoredUnits:next.energyRestoredUnits+simulated.restored,energyRemainingUnits:next.energyRemainingUnits+simulated.restored};
        } else motion = simulateDrivingStep({ xM: next.xM, speedMps: next.quadruped && Math.abs(next.speedMps) < .02 ? 0 : next.speedMps,
          dryMassKg: next.parameters.massKg, cargoMassKg: carriedMassKg(next.cargo) }, command.intent,
          next.drivingParameters, terrain, command.deltaSeconds);
      } catch {
        return reject('invalidCommand');
      }
      if (next.quadruped) {
        // The rigid body owns movement; driving provides a speed target only.
        const loaded = updateQuadrupedMass(next.quadruped, carriedMassKg(next.cargo));
        const activeTerrain=next.environment && next.mission.environment ? environmentTerrain(next.mission.environment,next.environment,terrain) : terrain;
        const path=next.environment && next.mission.environment ? { project:(x:number,z:number)=>routeProjection(next.mission.environment!,next.environment!,x,z), sample:(x:number)=>{
          const p=routePose(next.mission.environment!.sections,next.environment!.choices,terrain,x);
          return {zM:p.zM+ROUTE_LANE_OFFSET_M,dz:p.dz,curvature:p.curvature};
        }} : undefined;
        let quadruped = stepQuadruped(loaded, activeTerrain,
          next.environment&&next.mission.environment ? motion.speedMps*Math.hypot(1,path!.sample(next.xM).dz)/routePose(next.mission.environment.sections,next.environment.choices,terrain,next.xM).scale : motion.speedMps,
          command.deltaSeconds, next.environment && next.mission.environment ? (routePose(next.mission.environment.sections,next.environment.choices,terrain,next.xM).section?.kind==='soil' && next.environment.choices[routePose(next.mission.environment.sections,next.environment.choices,terrain,next.xM).section!.id]!=='bypass' ? QUADRUPED_SOIL_FRICTION : .75) : undefined,
          next.environment ? 0 : (motion.speedMps - next.speedMps) / command.deltaSeconds,path);
        let actualX = Math.max(0, Math.min(lengthM, path?.project(bodyOrigin(quadruped)[0],bodyOrigin(quadruped)[2])??bodyOrigin(quadruped)[0]));
        if(environmentMotion && environmentBefore && next.mission.environment){
          const allowedX=constrainEnvironmentMotion(next.mission.environment,environmentBefore,next.xM,actualX);
          if(allowedX!==actualX){quadruped={...quadruped,position:[quadruped.position[0]+allowedX-actualX,quadruped.position[1],quadruped.position[2]],velocity:[0,quadruped.velocity[1],quadruped.velocity[2]]};actualX=allowedX;}
          let settled=reconcileContactMotion(next.mission.environment,environmentBefore,environmentMotion,next.xM,actualX,loaded.mass.massKg,terrain);
          if(!next.mission.testMode && settled.energyConsumedUnits>next.energyRemainingUnits){
            const fraction=next.energyRemainingUnits/settled.energyConsumedUnits;
            const limitedX=next.xM+(actualX-next.xM)*fraction;
            quadruped={...quadruped,position:[quadruped.position[0]+limitedX-actualX,quadruped.position[1],quadruped.position[2]],velocity:[0,0,0]};actualX=limitedX;
            const ledger={...environmentBefore.ledger};for(const k of Object.keys(settled.components) as (keyof typeof settled.components)[])ledger[k]+=settled.components[k]*fraction;
            settled={...settled,energyConsumedUnits:next.energyRemainingUnits,environment:{...settled.environment,ledger,distanceM:environmentBefore.distanceM+(settled.environment.distanceM-environmentBefore.distanceM)*fraction}};
          }
          motion={...motion,energyConsumedUnits:settled.energyConsumedUnits};next={...next,environment:settled.environment};
        }
        motion = { ...motion, xM: actualX, speedMps: next.environment&&next.mission.environment ? (quadruped.velocity[0]+quadruped.velocity[2]*path!.sample(actualX).dz)/Math.hypot(1,path!.sample(actualX).dz) : quadruped.velocity[0] };
        next = { ...next, quadruped };
      }
      const consumed = next.mission.testMode ? 0 : Math.min(next.energyRemainingUnits, motion.energyConsumedUnits);
      const energyConsumedUnits = next.energyConsumedUnits + consumed;
      if (!Number.isFinite(energyConsumedUnits)) return reject('invalidCommand');
      const activeTerrain=next.environment && next.mission.environment ? environmentTerrain(next.mission.environment,next.environment,terrain) : terrain;
      const sample = activeTerrain.sample(motion.xM);
      next = { ...next, xM: sample.xM, heightM: sample.heightM, slopeDegrees: sample.slopeDegrees,
        speedMps: motion.speedMps, elapsedSeconds, energyConsumedUnits, energyRemainingUnits: next.energyRemainingUnits - consumed };
      emit('advanced');
    } else if (command.kind === 'pickup') {
      const item = state.mission.layout.find(candidate => candidate.id === command.objectId);
      if (!item || item.kind !== 'cargo') return reject('unknownObject');
      if (state.environment && (Math.abs(state.speedMps)>.25 || state.environment.work || Math.abs(state.environment.zM)>.5)) return reject('outOfRange');
      if (Math.abs(state.xM - (state.stagedCargo[item.id]??item.xM)) > item.pickupRadiusM) return reject('outOfRange');
      const cargo = pickUpCargo(state.cargo, state.sessionId, item.cargo);
      if (!cargo.accepted) return reject(cargo.reason);
      next = { ...state, cargo: cargo.state };
      if (state.environment) next={...next,environment:{...state.environment,work:{kind:'load',sectionId:item.id,seconds:0,duration:1.2,units:(item.cargo.massKg*9.81*.6/.65+35)/state.environment.model.joulesPerUnit,count:1}}};
      emit('pickedUp', { objectId: item.id });
    } else if (command.kind === 'deliver') {
      const zone = state.mission.layout.find(item => item.id === command.zoneId);
      if (!zone || zone.kind !== 'deliveryZone') return reject('unknownObject');
      if (state.environment && (Math.abs(state.speedMps)>.25 || state.environment.work || Math.abs(state.environment.zM)>.5)) return reject('outOfRange');
      if (state.xM < zone.startM || state.xM > zone.endM) return reject('outOfRange');
      const cargo = deliverCargo(state.cargo, state.sessionId, command.cargoIds);
      if (!cargo.accepted) return reject(cargo.reason);
      if (command.cargoIds.some(cargoId => state.mission.objectives.some(objective => objective.kind === 'deliver'
        && objective.cargoIds.includes(cargoId) && objective.zoneId !== zone.id))) return reject('wrongDeliveryZone');
      next = { ...state, cargo: cargo.state, deliveries: [...state.deliveries, ...command.cargoIds.map(cargoId => ({ cargoId, zoneId: zone.id }))] };
      if (state.environment) next={...next,environment:{...state.environment,work:{kind:'unload',sectionId:zone.id,seconds:0,duration:1.2,units:87.5*command.cargoIds.length/state.environment.model.joulesPerUnit,count:command.cargoIds.length}}};
      emit('delivered', { objectId: zone.id, cargoIds: [...command.cargoIds] });
    } else return reject('invalidCommand');

    if (next.quadruped) next = { ...next, quadruped: updateQuadrupedMass(next.quadruped, carriedMassKg(next.cargo)) };
    if (!deferSettlement) {
      const limits = next.mission.hardLimits;
      const failure: FailureReason | undefined = next.quadruped?.status === 'fallen' && Math.hypot(...next.quadruped.velocity) < .35 && Math.hypot(...next.quadruped.angularVelocity) < .35 ? 'overturned' : next.elapsedSeconds > limits.maxTimeSeconds ? 'timeExceeded'
        : next.energyRemainingUnits <= 1e-9 ? 'energyExhausted' : undefined;
      if (failure && !next.mission.testMode) {
        next = { ...next, phase: 'failed', speedMps: 0, result: { outcome: 'failed', failure, ...(next.challenge ? { score: scoreChallenge(next.challenge, 'failed') } : {}) } };
        emit('failed', { failure });
      } else {
        const delivered = (objective: Extract<MissionDefinition['objectives'][number], {kind:'deliver'}>) =>
          objective.cargoIds.every(cargoId => next.deliveries.some(delivery => delivery.cargoId === cargoId && delivery.zoneId === objective.zoneId));
        const allDelivered = next.mission.objectives.every(o=>o.kind!=='deliver'||o.optional||delivered(o));
        const previouslyDelivered = state.mission.objectives.every(o=>o.kind!=='deliver'||o.optional||o.cargoIds.every(id=>state.deliveries.some(d=>d.cargoId===id&&d.zoneId===o.zoneId)));
        const completedObjectiveIds = next.mission.objectives.filter(objective => objective.kind === 'reach'
          ? next.challenge ? allDelivered && previouslyDelivered && !next.environment?.work && next.xM >= objective.xM
            : state.completedObjectiveIds.includes(objective.id) || next.xM >= objective.xM
          : delivered(objective)).map(objective => objective.id);
        next = { ...next, completedObjectiveIds };
        if (next.mission.objectives.every(o => (o.kind === 'deliver' && o.optional) || completedObjectiveIds.includes(o.id))) {
          next = { ...next, phase: 'succeeded', speedMps: 0, result: { outcome: 'succeeded',
            ...(next.challenge ? { score: scoreChallenge(next.challenge, 'succeeded', challengePerformance(next)) } : {}) } };
          emit('succeeded');
        }
      }
    }
  }
  next = { ...next, processedCommandIds: [...next.processedCommandIds, command.commandId], eventSequence: state.eventSequence + events.length };
  return freezeSnapshot({ accepted: true as const, state: next, events });
}

export interface RenderSnapshot {
  readonly sessionId: string;
  readonly phase: SessionState['phase'];
  readonly themeAssetId: string;
  readonly terrainId: string;
  readonly environment: EnvironmentState | null;
  readonly robot: Readonly<{ zM: number; xM: number; heightM: number; slopeDegrees: number; speedMps: number;
    quadruped: QuadrupedState | null; modules: SessionState['moduleViews']; carriedCargoIds: readonly string[] }>;
  readonly items: readonly Readonly<{ id: string; kind: MissionDefinition['layout'][number]['kind']; viewAssetId: string;
    xM: number; heightM: number; status: 'world' | 'carried' | 'delivered' }>[];
}

export function createRenderSnapshot(state: SessionState): RenderSnapshot {
  const terrain = createTerrainSampler(state.mission.terrain);
  return freezeSnapshot({
    sessionId: state.sessionId, phase: state.phase, environment: state.environment, themeAssetId: state.mission.themeAssetId, terrainId: terrain.id,
    robot: { zM: state.environment?.zM ?? 0, xM: state.xM, heightM: state.heightM, slopeDegrees: state.slopeDegrees, speedMps: state.speedMps,
      quadruped: state.quadruped, modules: state.moduleViews, carriedCargoIds: state.cargo.carried.map(cargo => cargo.id) },
    items: state.mission.layout.map(item => {
      const delivery = state.deliveries.find(candidate => candidate.cargoId === item.id);
      const zone = delivery ? state.mission.layout.find(candidate => candidate.id === delivery.zoneId) : undefined;
      const xM = zone?.xM ?? state.stagedCargo[item.id] ?? item.xM;
      return { id: item.id, kind: item.kind, viewAssetId: item.viewAssetId, xM, heightM: terrain.sample(xM).heightM,
        status: state.cargo.carried.some(cargo => cargo.id === item.id) ? 'carried' as const
          : state.cargo.delivered.some(cargo => cargo.id === item.id) ? 'delivered' as const
          : 'world' as const };
    }),
  });
}

/** Actual settlement metrics, shared with local record validation. */
export function challengePerformance(state: SessionState) {
  const deliveries = state.mission.objectives.filter(o => o.kind === 'deliver');
  return { elapsedSeconds: state.elapsedSeconds, maxTimeSeconds: state.mission.hardLimits.maxTimeSeconds,
    energyRemainingUnits: state.energyRemainingUnits, batteryCapacityUnits: state.parameters.batteryCapacityUnits,
    cargoDelivered: deliveries.length > 0 && deliveries.every(o => o.kind === 'deliver' && o.cargoIds.every(id => state.deliveries.some(d => d.cargoId === id && d.zoneId === o.zoneId))) };
}
