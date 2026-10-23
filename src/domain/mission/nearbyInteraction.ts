import { beginWork } from '../simulation/environment';
import { carriedMassKg } from '../simulation/cargo';
import type { SessionInteraction, SessionState } from './session';
import { CARGO_CAPABILITY } from './validateMission';

export type NearbyInteraction = SessionInteraction
  | Readonly<{ kind: 'work'; workKind: 'charge' | 'clear'; duration: number }>
  | Readonly<{ kind: 'stage'; cargoIds: readonly string[] }>;

/** One priority order for both the driving button and keyboard input. */
export function findNearbyInteraction(state: SessionState): NearbyInteraction | null {
  if (state.environment && (state.environment.work || Math.abs(state.speedMps)>.25 || Math.abs(state.environment.zM)>.5)) return null;
  if (state.phase !== 'running') return null;
  for (const zone of state.mission.layout) {
    if (zone.kind !== 'deliveryZone' || state.xM < zone.startM || state.xM > zone.endM) continue;
    const cargoIds = state.cargo.carried.filter(cargo => !state.mission.objectives.some(objective => objective.kind === 'deliver'
      && objective.cargoIds.includes(cargo.id) && objective.zoneId !== zone.id)).map(cargo => cargo.id);
    if (cargoIds.length) return Object.freeze({ kind: 'deliver', zoneId: zone.id, cargoIds: Object.freeze(cargoIds) });
  }
  if (state.environment && state.mission.environment) {
    const ready = beginWork(state.mission.environment, state.environment, state.configuration, state.xM,
      state.speedMps, carriedMassKg(state.cargo), state.parameters.payloadKg,
      state.parameters.batteryCapacityUnits - state.energyRemainingUnits);
    if (ready?.work && (ready.work.kind === 'charge' || ready.work.kind === 'clear')) {
      return Object.freeze({ kind: 'work', workKind: ready.work.kind, duration: ready.work.duration });
    }
  }
  const candidates = state.mission.layout.filter(item => {
    if (item.kind === 'deliveryZone' || Math.abs(state.xM - (state.stagedCargo[item.id]??item.xM)) > item.pickupRadiusM) return false;
    return !state.cargo.carried.some(cargo => cargo.id === item.id) && !state.cargo.delivered.some(cargo => cargo.id === item.id)
      && state.parameters.capabilities.includes(CARGO_CAPABILITY[item.cargo.kind])
      && carriedMassKg(state.cargo) + item.cargo.massKg <= state.cargo.capacityKg;
  }).sort((first, second) => Math.abs(state.xM - (state.stagedCargo[first.id]??first.xM)) - Math.abs(state.xM - (state.stagedCargo[second.id]??second.xM)));
  const item = candidates[0];
  if (item) return Object.freeze({ kind: 'pickup', objectId: item.id });
  if (state.environment && state.cargo.carried.length
    && state.mission.platforms.some(platform => state.xM >= platform.startM && state.xM <= platform.endM)) {
    return Object.freeze({ kind: 'stage', cargoIds: Object.freeze(state.cargo.carried.map(cargo => cargo.id)) });
  }
  return null;
}
