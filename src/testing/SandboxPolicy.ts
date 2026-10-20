import type { ModuleDefinition } from '../domain/config/validateConfiguration';
import type { MissionDefinition } from '../domain/mission/definition';

export function sandboxCatalog(catalog: readonly ModuleDefinition[]): readonly ModuleDefinition[] {
  return catalog.map(module => ({ ...module, referenceCost: module.referenceCost ?? module.cost, cost: 0,
    capabilities: ['carryLight', 'carryHeavy', 'carryPart', 'clearCrate', 'clearDebris'],
    payload: { kind: 'limit', massKg: 1_000_000 },
  }));
}

export function sandboxMission(mission: MissionDefinition): MissionDefinition {
  return { ...mission, testMode: true,
    configurationRules: { ...mission.configurationRules, maxCost: undefined, maxMassKg: undefined, maxBatteryCapacityUnits: undefined },
  };
}
