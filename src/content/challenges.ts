import type { MissionDefinition } from '../domain/mission/definition';

export const CHALLENGE_RULES_VERSION = 'single-map-v2';
/** The only playable map. Geometry, HUD, validation and scoring consume this definition. */
export const TRANSPORT_MISSION: MissionDefinition = {
  id: 'transport-yard', name: '沙地运输场',
  description: '穿过必经沙地，在中途装货、充能。四足可翻越拱桥，其他底盘走平地旁路。清开一个大碎料箱后，选择交付货物并抵达终点。',
  challenge: { budget: 500, rulesVersion: CHALLENGE_RULES_VERSION },
  environment: { version: 'environment-v2', sections: [
    { id: 'sand', kind: 'soil', label: '必经沙地', startM: 18, endM: 30, extraM: 0, bypass: false, severity: 1 },
    { id: 'charger', kind: 'charger', label: '中途充能', startM: 46, endM: 48, extraM: 0, bypass: false, severity: 0 },
    { id: 'bridge', kind: 'bridge', label: '四足拱桥', startM: 60, endM: 72, extraM: 6, bypassLeadM: 5, bypassExitM: 5, severity: .9 },
    { id: 'debris', kind: 'debris', label: '大碎料箱', startM: 84, endM: 88, extraM: 0, bypass: false, severity: 1, pieces: 1, pieceMassKg: 8 },
  ] },
  themeAssetId: 'environment:logistics-bay',
  terrain: { id: 'transport-yard-ground', maxSlopeDegrees: 0, maxCurvaturePerM: 0,
    points: [{ xM: 0, heightM: 0 }, { xM: 100, heightM: 0 }] },
  spawnXM: 0,
  platforms: [{ id: 'spawn', startM: 0, endM: 5 }, { id: 'loading', startM: 35, endM: 41 }, { id: 'delivery-platform', startM: 91, endM: 100 }],
  layout: [
    { id: 'cargo', kind: 'cargo', xM: 38, viewAssetId: 'item:cargo_light', pickupRadiusM: 1.5, cargo: { id: 'cargo', kind: 'cargo_light', massKg: 8 } },
    { id: 'delivery', kind: 'deliveryZone', xM: 95, startM: 93, endM: 97, viewAssetId: 'item:delivery_zone' },
  ],
  objectives: [
    { id: 'transport', kind: 'deliver', cargoIds: ['cargo'], zoneId: 'delivery', optional: true },
    { id: 'finish', kind: 'reach', xM: 100 },
  ],
  hardLimits: { maxTimeSeconds: 180 },
  configurationRules: {"baseMassKg":20,"requiredPayloadLimits":["tool"],"requiredCapabilities":["carryLight"],"minPayloadKg":8,"maxMassKg":120,"maxCost":500,"maxBatteryCapacityUnits":100},
  recommendedConfiguration: {"chassis":"chassis_wheel","motor":"motor_low","battery":"battery_standard","sensor":"sensor_camera","tool":"tool_arm"},
};

