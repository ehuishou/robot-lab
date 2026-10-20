import type { Capability } from '../config/validateConfiguration';

export type CargoKind = 'cargo_light' | 'cargo_heavy' | 'part';

export interface Cargo {
  readonly id: string;
  readonly kind: CargoKind;
  readonly massKg: number;
}

export interface CargoState {
  readonly sessionId: string;
  readonly capacityKg: number;
  readonly capabilities: readonly Capability[];
  readonly carried: readonly Cargo[];
  readonly delivered: readonly Cargo[];
}

export type CargoResult =
  | { readonly accepted: true; readonly state: CargoState }
  | { readonly accepted: false; readonly state: CargoState; readonly reason:
    'staleSession' | 'invalidCargo' | 'duplicateCargo' | 'missingCapability' | 'capacityExceeded' | 'notCarried' };

const REQUIRED_CAPABILITY: Record<CargoKind, Capability> = {
  cargo_light: 'carryLight',
  cargo_heavy: 'carryHeavy',
  part: 'carryPart',
};

export function createCargoState(sessionId: string, capacityKg: number, capabilities: readonly Capability[]): CargoState {
  if (!sessionId || !Number.isFinite(capacityKg) || capacityKg < 0) {
    throw new RangeError('会话 ID 和载重容量必须有效。');
  }
  return { sessionId, capacityKg, capabilities: [...capabilities], carried: [], delivered: [] };
}

export function carriedMassKg(state: CargoState): number {
  return state.carried.reduce((total, cargo) => total + cargo.massKg, 0);
}

export function pickUpCargo(state: CargoState, sessionId: string, cargo: Cargo): CargoResult {
  const reject = (reason: Extract<CargoResult, { accepted: false }>['reason']): CargoResult => ({ accepted: false, state, reason });
  if (sessionId !== state.sessionId) return reject('staleSession');
  if (!cargo.id || !Object.hasOwnProperty.call(REQUIRED_CAPABILITY, cargo.kind)
    || !Number.isFinite(cargo.massKg) || cargo.massKg <= 0) return reject('invalidCargo');
  if ([...state.carried, ...state.delivered].some(existing => existing.id === cargo.id)) return reject('duplicateCargo');
  if (!state.capabilities.includes(REQUIRED_CAPABILITY[cargo.kind])) return reject('missingCapability');
  const nextMassKg = carriedMassKg(state) + cargo.massKg;
  if (!Number.isFinite(nextMassKg) || nextMassKg > state.capacityKg) return reject('capacityExceeded');
  return { accepted: true, state: { ...state, carried: [...state.carried, { ...cargo }] } };
}

export function deliverCargo(state: CargoState, sessionId: string, cargoIds: readonly string[]): CargoResult {
  if (sessionId !== state.sessionId) return { accepted: false, state, reason: 'staleSession' };
  const selected = new Set(cargoIds);
  if (!selected.size || selected.size !== cargoIds.length
    || cargoIds.some(id => !state.carried.some(cargo => cargo.id === id))) {
    return { accepted: false, state, reason: 'notCarried' };
  }
  return {
    accepted: true,
    state: {
      ...state,
      carried: state.carried.filter(cargo => !selected.has(cargo.id)),
      delivered: [...state.delivered, ...state.carried.filter(cargo => selected.has(cargo.id))],
    },
  };
}
