import { bypassBounds } from '../simulation/environment';
import { validChallengeRules } from './scoring';
import type { AssetDefinition } from '../../content/assets';
import { MODULE_CATEGORIES, validateConfiguration } from '../config/validateConfiguration';
import type { Capability, ModuleDefinition } from '../config/validateConfiguration';
import { createTerrainSampler } from '../simulation/terrain';
import type { CargoKind } from '../simulation/cargo';
import type { MissionDefinition } from './definition';

export interface MissionIssue {
  readonly code: 'invalidDefinition' | 'invalidTerrain' | 'invalidLayout' | 'invalidObjective'
    | 'invalidAsset' | 'invalidConfiguration' | 'impossibleCargo';
  readonly objectId: string;
  readonly message: string;
}

export const CARGO_CAPABILITY: Readonly<Record<CargoKind, Capability>> = {
  cargo_light: 'carryLight', cargo_heavy: 'carryHeavy', part: 'carryPart',
};

export function validateMission(
  mission: MissionDefinition, catalog: readonly ModuleDefinition[], assets: readonly AssetDefinition[],
): Readonly<{ valid: boolean; issues: readonly MissionIssue[] }> {
  const issues: MissionIssue[] = [];
  const issue = (code: MissionIssue['code'], objectId: string, message: string) => issues.push({ code, objectId, message });
  const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;
  const limits = mission.hardLimits;
  if (!mission.id.trim() || !mission.name.trim() || !mission.description.trim()
    || !Number.isFinite(limits.maxTimeSeconds) || limits.maxTimeSeconds <= 0) {
    issue('invalidDefinition', mission.id, '任务信息或硬限制无效。');
  }
  if (mission.challenge && (!validChallengeRules(mission.challenge)
    || (!mission.testMode && mission.configurationRules.maxCost !== mission.challenge.budget)
    || mission.objectives.filter(o=>o.kind==='reach').length !== 1
    || !mission.objectives.some(o=>o.kind==='deliver'))) issue('invalidDefinition', mission.id, '挑战规则、预算或目标无效。');
  let lengthM: number;
  try {
    lengthM = createTerrainSampler(mission.terrain).lengthM;
  } catch (error) {
    issue('invalidTerrain', mission.terrain.id, error instanceof Error ? error.message : '地形无效。');
    return { valid: false, issues };
  }
  if (mission.challenge) {
    const finish = mission.objectives.find(o=>o.kind==='reach');
    if (!finish || finish.kind !== 'reach' || finish.xM !== lengthM
      || mission.layout.some(item=>item.kind==='deliveryZone' && item.endM >= finish.xM)) {
      issue('invalidDefinition', mission.id, '挑战终点必须位于路线末端，卸货区必须在终点之前。');
    }
  }
  const positionValid = (xM: number) => nonnegative(xM) && xM <= lengthM;
  const rangeValid = (startM: number, endM: number) => positionValid(startM) && positionValid(endM) && startM < endM;
  const flatRange = (startM: number, endM: number) => mission.terrain.points.every((point, index, points) => {
    const next = points[index + 1];
    return !next || next.xM <= startM || point.xM >= endM || point.heightM === next.heightM;
  });
  const coveredByPlatform = (startM: number, endM: number) => mission.platforms.some(platform =>
    rangeValid(platform.startM, platform.endM) && flatRange(platform.startM, platform.endM)
    && platform.startM <= startM && platform.endM >= endM);
  const ids = new Set<string>();
  const register = (id: string, code: MissionIssue['code']) => {
    if (!id.trim() || ids.has(id)) issue(code, id, '对象 ID 必须非空且在任务内唯一。');
    ids.add(id);
  };
  for (const platform of mission.platforms) {
    register(platform.id, 'invalidLayout');
    if (!rangeValid(platform.startM, platform.endM) || !flatRange(platform.startM, platform.endM)) {
      issue('invalidLayout', platform.id, '平台必须处于关卡内且整个区间平坦。');
    }
  }
  if (!positionValid(mission.spawnXM) || !coveredByPlatform(mission.spawnXM, mission.spawnXM)) {
    issue('invalidLayout', mission.id, '出生位置必须位于平坦平台。');
  }
  const assetMap = new Map<string, AssetDefinition>();
  for (const asset of assets) {
    if (!asset.id.trim() || assetMap.has(asset.id) || !asset.source.recipeId.trim()
      || asset.sizeM.length !== 3 || !asset.sizeM.every(size => Number.isFinite(size) && size > 0)
      || (asset.required && asset.fallback !== 'error') || !['planned-placeholder', 'procedural-preview'].includes(asset.status)
      || asset.source.kind !== 'procedural' || asset.authorization !== 'project-authored-procedure') {
      issue('invalidAsset', asset.id, '素材声明重复、尺寸无效或缺少明确的来源/占位状态。');
    }
    assetMap.set(asset.id, asset);
  }
  const assetReference = (id: string, kind: AssetDefinition['kind'], objectId: string) => {
    const asset = assetMap.get(id);
    if (!asset || asset.kind !== kind || !asset.required) issue('invalidAsset', objectId, `缺少必要的 ${kind} 素材声明：${id}`);
  };
  assetReference(mission.themeAssetId, 'environment', mission.id);
  for (const module of catalog) assetReference(module.viewAssetId, 'module', module.id);
  for (const item of mission.layout) {
    const itemId = item.id;
    register(item.id, 'invalidLayout');
    assetReference(item.viewAssetId, 'item', item.id);
    if (!positionValid(item.xM)) issue('invalidLayout', item.id, '物品坐标不在关卡内。');
    if (item.kind === 'deliveryZone') {
      if (!rangeValid(item.startM, item.endM) || item.xM < item.startM || item.xM > item.endM
        || !coveredByPlatform(item.startM, item.endM)) issue('invalidLayout', item.id, '卸货区必须完整落在平坦平台内。');
    } else {
      if (!Number.isFinite(item.pickupRadiusM) || item.pickupRadiusM <= 0) issue('invalidLayout', item.id, '交互半径必须为正数。');
      if (item.kind === 'cargo') {
        if (item.cargo.id !== item.id || !Object.hasOwnProperty.call(CARGO_CAPABILITY, item.cargo.kind)
          || !Number.isFinite(item.cargo.massKg) || item.cargo.massKg <= 0) issue('invalidLayout', item.id, '货物 ID、种类或质量无效。');
        if (!coveredByPlatform(item.xM - item.pickupRadiusM, item.xM + item.pickupRadiusM)) {
          issue('invalidLayout', item.id, '装货交互区必须完整落在平坦平台内。');
        }
      } else issue('invalidLayout', itemId, '未知物品种类。');
    }
  }
  if (mission.environment) {
    const sections=mission.environment.sections;
    if(mission.environment.version!=='environment-v2'||!sections.length) issue('invalidDefinition',mission.id,'环境版本或路段无效。');
    for(const [index,section] of sections.entries()) {
      register(section.id,'invalidLayout');
      if(!['soil','bridge','debris','charger'].includes(section.kind)||!rangeValid(section.startM,section.endM)||!nonnegative(section.extraM)||!nonnegative(section.severity)||!section.label.trim()||(index>0&&section.startM<sections[index-1].endM)
        ||(section.kind==='debris'&&(!Number.isSafeInteger(section.pieces)||section.pieces!<=0||!Number.isFinite(section.pieceMassKg)||section.pieceMassKg!<=0))) issue('invalidLayout',section.id,'环境路段几何或碎料定义无效。');
      const bounds = bypassBounds(section);
      const previous = index > 0 ? bypassBounds(sections[index-1]) : undefined;
      if (bounds.startM < 0 || bounds.endM > lengthM || (previous && bounds.startM - previous.endM < 4))
        issue('invalidLayout', section.id, '路段连同旁路至少留出4m间隔，且不能超出地图。');
      if (mission.platforms.some(p => bounds.startM < p.endM + 2 && bounds.endM > p.startM - 2))
        issue('invalidLayout', section.id, '障碍与作业平台至少留出2m间隔。');
      if(mission.layout.some(i=>i.kind==='cargo'&&i.xM>section.startM&&i.xM<section.endM))issue('invalidLayout',section.id,'障碍不得覆盖装载平台。');
    }
  }
  const configuration = validateConfiguration(mission.recommendedConfiguration, catalog, mission.configurationRules);
  if (!configuration.valid || !configuration.summary || configuration.summary.batteryCapacityUnits <= 0) {
    issue('invalidConfiguration', mission.id, '推荐配置必须合法且有可用电池容量。');
  }
  if (!mission.objectives.length) issue('invalidObjective', mission.id, '任务必须定义完成目标。');
  const assignedCargoIds = new Set<string>();
  for (const objective of mission.objectives) {
    const objectiveId = objective.id;
    register(objective.id, 'invalidObjective');
    if (objective.kind === 'reach') {
      if (!positionValid(objective.xM) || objective.xM <= mission.spawnXM) issue('invalidObjective', objective.id, '抵达目标必须位于出生点前方且不超界。');
    } else if (objective.kind === 'deliver') {
      const zone = mission.layout.find(item => item.id === objective.zoneId && item.kind === 'deliveryZone');
      if (!zone || !objective.cargoIds.length || new Set(objective.cargoIds).size !== objective.cargoIds.length) {
        issue('invalidObjective', objective.id, '运输目标缺少卸货区或唯一的实际货物。');
      }
      for (const cargoId of objective.cargoIds) {
        const item = mission.layout.find(candidate => candidate.id === cargoId && candidate.kind === 'cargo');
        if (!item || item.kind !== 'cargo' || assignedCargoIds.has(cargoId)) {
          issue('invalidObjective', objective.id, `货物缺失或重复分配：${cargoId}`);
          continue;
        }
        assignedCargoIds.add(cargoId);
        const capability = CARGO_CAPABILITY[item.cargo.kind];
        if (!mission.configurationRules.requiredCapabilities.includes(capability)
          || mission.configurationRules.minPayloadKg < item.cargo.massKg
          || !configuration.summary?.capabilities.includes(capability)
          || configuration.summary.payloadKg < item.cargo.massKg) {
          issue('impossibleCargo', cargoId, '运输需求必须同时受配置能力和实际货物质量约束，且推荐配置可搬运。');
        }
      }
    } else issue('invalidObjective', objectiveId, '未知完成目标种类。');
  }
  for (const category of MODULE_CATEGORIES) {
    if (category !== 'accessory' && !catalog.some(module => module.category === category)) issue('invalidConfiguration', category, '模块清单缺少必需类别。');
  }
  return { valid: issues.length === 0, issues };
}
