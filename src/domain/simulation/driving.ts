import type { Configuration, ModuleDefinition } from '../config/validateConfiguration';
import type { TerrainSampler } from './terrain';

export interface DrivingIntent {
  readonly throttle: -1 | 0 | 1;
  readonly brake: boolean;
}

export interface DrivingParameters {
  readonly maxForwardSpeedMps: number;
  readonly maxReverseSpeedMps: number;
  readonly accelerationMps2: number;
  readonly brakeDecelerationMps2: number;
  readonly coastDecelerationMps2: number;
  readonly idleDrainUnitsPerSecond: number;
  readonly driveDrainUnitsPerSecond: number;
  readonly drainUnitsPerM: number;
  readonly referenceMassKg: number;
  readonly gradeResistanceFactor: number;
}

export const DRIVING_STEP_SECONDS = 1 / 60;

export function deriveDrivingParameters(configuration: Configuration, catalog: readonly ModuleDefinition[]): DrivingParameters {
  const chassis = catalog.find(module => module.id === configuration.chassis && module.category === 'chassis')?.driving;
  const motor = catalog.find(module => module.id === configuration.motor && module.category === 'motor')?.driving;
  if (!chassis || !motor) throw new RangeError('底盘和电机必须声明米制驾驶参数。');
  if (![chassis, motor].every(specification => Number.isFinite(specification.maxSpeedMps) && specification.maxSpeedMps > 0
    && Number.isFinite(specification.accelerationMps2) && specification.accelerationMps2 > 0
    && Number.isFinite(specification.driveDrainUnitsPerSecond) && specification.driveDrainUnitsPerSecond >= 0)) {
    throw new RangeError('底盘或电机驾驶参数无效。');
  }
  const maxForwardSpeedMps = Math.min(chassis.maxSpeedMps, motor.maxSpeedMps);
  const parameters: DrivingParameters = {
    maxForwardSpeedMps, maxReverseSpeedMps: maxForwardSpeedMps * 0.5,
    accelerationMps2: Math.min(chassis.accelerationMps2, motor.accelerationMps2),
    brakeDecelerationMps2: 5, coastDecelerationMps2: 0.8, idleDrainUnitsPerSecond: 0.08,
    driveDrainUnitsPerSecond: chassis.driveDrainUnitsPerSecond + motor.driveDrainUnitsPerSecond,
    drainUnitsPerM: 0.12, referenceMassKg: 60, gradeResistanceFactor: 4,
  };
  if (!validDrivingParameters(parameters)) throw new RangeError('驾驶参数无效。');
  return Object.freeze(parameters);
}

export function validDrivingIntent(intent: unknown): intent is DrivingIntent {
  if (!intent || typeof intent !== 'object') return false;
  const candidate = intent as DrivingIntent;
  return [-1, 0, 1].includes(candidate.throttle) && typeof candidate.brake === 'boolean';
}

function validDrivingParameters(parameters: DrivingParameters): boolean {
  return [parameters.maxForwardSpeedMps, parameters.maxReverseSpeedMps, parameters.accelerationMps2,
    parameters.brakeDecelerationMps2, parameters.coastDecelerationMps2, parameters.referenceMassKg]
    .every(value => Number.isFinite(value) && value > 0)
    && [parameters.idleDrainUnitsPerSecond, parameters.driveDrainUnitsPerSecond, parameters.drainUnitsPerM,
      parameters.gradeResistanceFactor].every(value => Number.isFinite(value) && value >= 0);
}

export function simulateDrivingStep(
  state: Readonly<{ xM: number; speedMps: number; dryMassKg: number; cargoMassKg: number }>,
  intent: DrivingIntent, parameters: DrivingParameters, terrain: TerrainSampler, deltaSeconds: number,
): Readonly<{ xM: number; speedMps: number; energyConsumedUnits: number }> {
  const massKg = state.dryMassKg + state.cargoMassKg;
  if (!validDrivingIntent(intent) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 1 / 30
    || !Number.isFinite(state.xM) || state.xM < 0 || state.xM > terrain.lengthM || !Number.isFinite(state.speedMps)
    || !Number.isFinite(state.dryMassKg) || state.dryMassKg <= 0 || !Number.isFinite(state.cargoMassKg) || state.cargoMassKg < 0
    || !Number.isFinite(massKg) || !validDrivingParameters(parameters)) {
    throw new RangeError('驾驶步长、意图、质量或参数无效。');
  }
  const massFactor = Math.min(1, parameters.referenceMassKg / massKg);
  const speedFactor = Math.sqrt(massFactor);
  const forwardLimit = parameters.maxForwardSpeedMps * speedFactor;
  const reverseLimit = parameters.maxReverseSpeedMps * speedFactor;
  const initialSpeed = Math.max(-reverseLimit, Math.min(forwardLimit, state.speedMps));
  const grade = terrain.sample(state.xM).slope;
  const uphill = Math.max(0, grade * intent.throttle);
  const targetSpeed = intent.brake ? 0 : intent.throttle > 0 ? forwardLimit : intent.throttle < 0 ? -reverseLimit : 0;
  const reversing = initialSpeed * intent.throttle < 0;
  const rate = intent.brake || reversing ? parameters.brakeDecelerationMps2
    : intent.throttle === 0 ? parameters.coastDecelerationMps2
    : parameters.accelerationMps2 * massFactor / (1 + uphill * parameters.gradeResistanceFactor);
  const desired = reversing && !intent.brake ? 0 : targetSpeed;
  const speedDelta = Math.max(-rate * deltaSeconds, Math.min(rate * deltaSeconds, desired - initialSpeed));
  let speedMps = initialSpeed + speedDelta;
  const travelledM = (initialSpeed + speedMps) * 0.5 * deltaSeconds;
  const xM = Math.max(0, Math.min(terrain.lengthM, state.xM + travelledM));
  if (xM === 0 && speedMps < 0 || xM === terrain.lengthM && speedMps > 0) speedMps = 0;
  const powered = !intent.brake && intent.throttle !== 0 && !reversing && !(xM === state.xM && speedMps === 0);
  const loadFactor = massKg / parameters.referenceMassKg;
  const energyConsumedUnits = parameters.idleDrainUnitsPerSecond * deltaSeconds
    + (powered ? parameters.driveDrainUnitsPerSecond * deltaSeconds * loadFactor * (1 + uphill * parameters.gradeResistanceFactor) : 0)
    + Math.abs(xM - state.xM) * parameters.drainUnitsPerM * loadFactor;
  if (![xM, speedMps, energyConsumedUnits].every(Number.isFinite)) throw new RangeError('驾驶结果数值溢出。');
  return Object.freeze({ xM, speedMps: speedMps === 0 ? 0 : speedMps, energyConsumedUnits });
}
