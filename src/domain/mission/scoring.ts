export const SCORE_WEIGHTS = Object.freeze({ time: 1000, energy: 1000, cargo: 2000, budget: 1000 });
export interface ChallengeRules {
  readonly budget: number;
  readonly rulesVersion: string;
}
export interface ChallengeSnapshot extends ChallengeRules {
  readonly missionId: string;
  readonly configurationCost: number;
  readonly remainingBudget: number;
  readonly testMode: boolean;
}
export interface ChallengePerformance {
  readonly elapsedSeconds: number;
  readonly maxTimeSeconds: number;
  readonly energyRemainingUnits: number;
  readonly batteryCapacityUnits: number;
  readonly cargoDelivered: boolean;
}
export interface ChallengeScore {
  readonly formalScore: number | null;
  readonly timeBonus: number;
  readonly energyBonus: number;
  readonly cargoBonus: number;
  readonly budgetBonus: number;
}
export function validChallengeRules(value: ChallengeRules): boolean {
  return Number.isSafeInteger(value.budget) && value.budget > 0
    && typeof value.rulesVersion === 'string' && /^[a-zA-Z0-9._-]+$/.test(value.rulesVersion);
}
export function createChallengeSnapshot(missionId: string, rules: ChallengeRules, cost: number, testMode: boolean): ChallengeSnapshot {
  if (!missionId.trim() || !validChallengeRules(rules) || typeof testMode !== 'boolean'
    || !Number.isSafeInteger(cost) || cost < 0 || (!testMode && cost > rules.budget)) throw new RangeError('挑战预算或成本无效。');
  return Object.freeze({ ...rules, missionId, configurationCost: cost, remainingBudget: rules.budget - cost, testMode });
}
export function scoreChallenge(snapshot: ChallengeSnapshot, outcome: 'succeeded' | 'failed', performance?: ChallengePerformance): ChallengeScore {
  createChallengeSnapshot(snapshot.missionId, snapshot, snapshot.configurationCost, snapshot.testMode);
  if (snapshot.remainingBudget !== snapshot.budget - snapshot.configurationCost
    || !['succeeded', 'failed'].includes(outcome)) throw new RangeError('挑战结算快照无效。');
  const zero = { formalScore: snapshot.testMode ? null : 0, timeBonus: 0, energyBonus: 0, cargoBonus: 0, budgetBonus: 0 };
  if (snapshot.testMode || outcome === 'failed') return Object.freeze(zero);
  const p = performance;
  if (!p || ![p.elapsedSeconds, p.maxTimeSeconds, p.energyRemainingUnits, p.batteryCapacityUnits].every(Number.isFinite)
    || p.maxTimeSeconds <= 0 || p.batteryCapacityUnits <= 0 || p.elapsedSeconds < 0 || p.elapsedSeconds > p.maxTimeSeconds
    || p.energyRemainingUnits <= 0 || p.energyRemainingUnits > p.batteryCapacityUnits || typeof p.cargoDelivered !== 'boolean') throw new RangeError('评分数据无效。');
  const timeBonus = Math.floor(SCORE_WEIGHTS.time * (1 - p.elapsedSeconds / p.maxTimeSeconds));
  const energyBonus = Math.floor(SCORE_WEIGHTS.energy * p.energyRemainingUnits / p.batteryCapacityUnits);
  const cargoBonus = p.cargoDelivered ? SCORE_WEIGHTS.cargo : 0;
  const budgetBonus = Math.floor(SCORE_WEIGHTS.budget * snapshot.remainingBudget / snapshot.budget);
  return Object.freeze({ formalScore: timeBonus + energyBonus + cargoBonus + budgetBonus, timeBonus, energyBonus, cargoBonus, budgetBonus });
}
