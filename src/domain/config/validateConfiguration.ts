export const MODULE_CATEGORIES = ['chassis', 'motor', 'battery', 'sensor', 'tool', 'accessory'] as const;

export type ModuleCategory = typeof MODULE_CATEGORIES[number];
export type Capability = 'carryLight' | 'carryHeavy' | 'carryPart' | 'clearCrate' | 'clearDebris';
export type Configuration = Readonly<Record<Exclude<ModuleCategory, 'accessory'>, string | null> & { accessory?: string | null }>;

export interface ModuleDefinition {
  readonly id: string;
  readonly viewAssetId: string;
  readonly category: ModuleCategory;
  readonly massKg: number;
  readonly cost: number;
  readonly referenceCost?: number;
  readonly capabilities: readonly Capability[];
  readonly batteryCapacityUnits?: number;
  readonly payload?: Readonly<{ kind: 'limit' | 'contribution'; massKg: number }>;
  readonly driving?: Readonly<{ maxSpeedMps: number; accelerationMps2: number; driveDrainUnitsPerSecond: number }>;
}

export interface ConfigurationRules {
  readonly baseMassKg: number;
  readonly requiredPayloadLimits: readonly ModuleCategory[];
  readonly requiredCapabilities: readonly Capability[];
  readonly minPayloadKg: number;
  readonly maxMassKg?: number;
  readonly maxCost?: number;
  readonly maxBatteryCapacityUnits?: number;
}

export interface ConfigurationIssue {
  readonly code: 'invalidContent' | 'missingModule' | 'unknownModule' | 'wrongCategory'
    | 'missingCapability' | 'insufficientPayload' | 'massExceeded' | 'costExceeded' | 'batteryCapacityExceeded';
  readonly message: string;
  readonly category?: ModuleCategory;
  readonly actual?: number;
  readonly limit?: number;
}

export interface ConfigurationValidation {
  readonly valid: boolean;
  readonly issues: readonly ConfigurationIssue[];
  readonly summary: Readonly<{
    massKg: number;
    cost: number;
    batteryCapacityUnits: number;
    payloadKg: number;
    capabilities: readonly Capability[];
  }> | null;
}

const CAPABILITIES: readonly Capability[] = ['carryLight', 'carryHeavy', 'carryPart', 'clearCrate', 'clearDebris'];
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;

export function validateConfiguration(
  configuration: Configuration,
  catalog: readonly ModuleDefinition[],
  rules: ConfigurationRules,
): ConfigurationValidation {
  const issues: ConfigurationIssue[] = [];
  const modules = new Map<string, ModuleDefinition>();
  const ruleValues = [rules.baseMassKg, rules.minPayloadKg,
    rules.maxMassKg ?? 0, rules.maxCost ?? 0, rules.maxBatteryCapacityUnits ?? 0];
  if (!ruleValues.every(nonnegative)
    || !rules.requiredPayloadLimits.every(category => MODULE_CATEGORIES.includes(category))
    || !rules.requiredCapabilities.every(capability => CAPABILITIES.includes(capability))) {
    issues.push({ code: 'invalidContent', message: '配置约束含有无效字段或数值。' });
  }
  for (const module of catalog) {
    if (!module.id || !module.viewAssetId?.trim() || modules.has(module.id) || !MODULE_CATEGORIES.includes(module.category)
      || !nonnegative(module.massKg) || !nonnegative(module.cost) || (module.referenceCost !== undefined && !nonnegative(module.referenceCost))
      || !module.capabilities.every(capability => CAPABILITIES.includes(capability))
      || (module.category === 'battery' && (module.batteryCapacityUnits === undefined || !nonnegative(module.batteryCapacityUnits)))
      || (module.category !== 'battery' && module.batteryCapacityUnits !== undefined)
      || (module.driving !== undefined && (!['chassis', 'motor'].includes(module.category)
        || !Number.isFinite(module.driving.maxSpeedMps) || module.driving.maxSpeedMps <= 0
        || !Number.isFinite(module.driving.accelerationMps2) || module.driving.accelerationMps2 <= 0
        || !nonnegative(module.driving.driveDrainUnitsPerSecond)))
      || (module.payload !== undefined && (!['limit', 'contribution'].includes(module.payload.kind) || !nonnegative(module.payload.massKg)))) {
      issues.push({ code: 'invalidContent', message: `模块定义无效或 ID 重复：${module.id}` });
    }
    modules.set(module.id, module);
  }
  const selected: ModuleDefinition[] = [];
  for (const category of MODULE_CATEGORIES) {
    const id = configuration[category];
    const module = id ? modules.get(id) : undefined;
    if (!id && category === 'accessory') continue;
    if (!id) {
      issues.push({ code: 'missingModule', category, message: `尚未选择 ${category} 模块。` });
    } else if (!module) {
      issues.push({ code: 'unknownModule', category, message: `模块不存在：${id}` });
    } else if (module.category !== category) {
      issues.push({ code: 'wrongCategory', category, message: `${id} 不能安装到 ${category} 槽位。` });
    } else {
      selected.push(module);
      if (rules.requiredPayloadLimits.includes(category) && module.payload?.kind !== 'limit') {
        issues.push({ code: 'invalidContent', category, message: `${id} 缺少明确的独立载重上限。` });
      }
    }
  }
  if (issues.some(issue => issue.code === 'invalidContent')) return { valid: false, issues, summary: null };

  const limits = selected.filter(module => module.category !== 'accessory').flatMap(module => module.payload?.kind === 'limit' ? [module.payload.massKg] : []);
  const contributions = selected.filter(module => module.category !== 'accessory').flatMap(module => module.payload?.kind === 'contribution' ? [module.payload.massKg] : []);
  if (contributions.length) limits.push(contributions.reduce((total, massKg) => total + massKg, 0));
  if (!limits.every(nonnegative)) {
    return { valid: false, issues: [{ code: 'invalidContent', message: '载重贡献汇总超出有限数值范围。' }], summary: null };
  }
  const summary = {
    massKg: rules.baseMassKg + selected.reduce((total, module) => total + module.massKg, 0),
    cost: selected.reduce((total, module) => total + module.cost, 0),
    batteryCapacityUnits: selected.reduce((total, module) => total + (module.batteryCapacityUnits ?? 0), 0),
    payloadKg: limits.length ? Math.min(...limits) : 0,
    capabilities: [...new Set(selected.flatMap(module => [...module.capabilities]))],
  };
  if (!Object.values(summary).filter(value => typeof value === 'number').every(value => nonnegative(value as number))) {
    return { valid: false, issues: [{ code: 'invalidContent', message: '配置汇总超出有限数值范围。' }], summary: null };
  }
  for (const capability of rules.requiredCapabilities) {
    if (!summary.capabilities.includes(capability)) {
      issues.push({ code: 'missingCapability', message: `缺少操作能力：${capability}` });
    }
  }
  if (summary.payloadKg < rules.minPayloadKg) {
    issues.push({ code: 'insufficientPayload', message: '有效载重不足。', actual: summary.payloadKg, limit: rules.minPayloadKg });
  }
  const constraints = [
    ['massExceeded', `总质量 ${summary.massKg} kg 超过 ${rules.maxMassKg} kg 上限。`, summary.massKg, rules.maxMassKg],
    ['costExceeded', '配置成本超限。', summary.cost, rules.maxCost],
    ['batteryCapacityExceeded', '电池容量超限。', summary.batteryCapacityUnits, rules.maxBatteryCapacityUnits],
  ] as const;
  for (const [code, message, actual, limit] of constraints) {
    if (limit !== undefined && actual > limit) issues.push({ code, message, actual, limit });
  }
  return { valid: issues.length === 0, issues, summary };
}
