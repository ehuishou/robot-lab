import { carriedMassKg } from '../simulation/cargo';
import type { SessionInteraction, SessionState } from './session';
import { CARGO_CAPABILITY } from './validateMission';

export function findNearbyInteraction(state: SessionState): SessionInteraction | null {
  if (state.environment && (state.environment.work || Math.abs(state.speedMps)>.25 || Math.abs(state.environment.zM)>.5)) return null;
  if (state.phase !== 'running') return null;
  for (const zone of state.mission.layout) {
    if (zone.kind !== 'deliveryZone' || state.xM < zone.startM || state.xM > zone.endM) continue;
    const cargoIds = state.cargo.carried.filter(cargo => !state.mission.objectives.some(objective => objective.kind === 'deliver'
      && objective.cargoIds.includes(cargo.id) && objective.zoneId !== zone.id)).map(cargo => cargo.id);
    if (cargoIds.length) return Object.freeze({ kind: 'deliver', zoneId: zone.id, cargoIds: Object.freeze(cargoIds) });
  }
  const candidates = state.mission.layout.filter(item => {
    if (item.kind === 'deliveryZone' || Math.abs(state.xM - (state.stagedCargo[item.id]??item.xM)) > item.pickupRadiusM) return false;
    return !state.cargo.carried.some(cargo => cargo.id === item.id) && !state.cargo.delivered.some(cargo => cargo.id === item.id)
      && state.parameters.capabilities.includes(CARGO_CAPABILITY[item.cargo.kind])
      && carriedMassKg(state.cargo) + item.cargo.massKg <= state.cargo.capacityKg;
  }).sort((first, second) => Math.abs(state.xM - (state.stagedCargo[first.id]??first.xM)) - Math.abs(state.xM - (state.stagedCargo[second.id]??second.xM)));
  const item = candidates[0];
  return item ? Object.freeze({ kind: 'pickup' as const, objectId: item.id }) : null;
}
