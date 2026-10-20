import type { Configuration } from '../domain/config/validateConfiguration';
import { MODULE_CATEGORIES } from '../domain/config/validateConfiguration';
import { createChallengeSnapshot, scoreChallenge } from '../domain/mission/scoring';
import type { ChallengeRules, ChallengeSnapshot } from '../domain/mission/scoring';
import { challengePerformance } from '../domain/mission/session';
import type { ChallengePerformance } from '../domain/mission/scoring';
import type { SessionState } from '../domain/mission/session';
import type { ConfigurationStorage } from './PreviewSave';
export const CHALLENGE_RECORDS_KEY = 'robot_lab_challenge_records_v2';
export interface ChallengeRecord {
  readonly sessionId: string;
  readonly snapshot: ChallengeSnapshot;
  readonly configuration: Configuration;
  readonly score: number;
  readonly performance: ChallengePerformance;
}
const key = (missionId: string, rules: ChallengeRules) => JSON.stringify([missionId,rules.rulesVersion]);
function read(storage: Pick<ConfigurationStorage, 'getItem'>): ChallengeRecord[] {
  const raw = storage.getItem(CHALLENGE_RECORDS_KEY);
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (value?.version !== 2 || !Array.isArray(value.records)) return [];
  return value.records.filter((record: ChallengeRecord) => {
    try {
      const s=record.snapshot;
      createChallengeSnapshot(s.missionId,s,s.configurationCost,s.testMode);
      return !s.testMode && s.remainingBudget===s.budget-s.configurationCost
        && typeof record.sessionId==='string' && record.sessionId.length>0
        && record.score===scoreChallenge(s,'succeeded',record.performance).formalScore
        && record.configuration && [5,6].includes(Object.keys(record.configuration).length)
        && Object.keys(record.configuration).every(c=>MODULE_CATEGORIES.includes(c as typeof MODULE_CATEGORIES[number]))
        && MODULE_CATEGORIES.every(c=>c==='accessory' ? record.configuration[c]==null || record.configuration[c]==='tool_blade' : typeof record.configuration[c]==='string' && !!record.configuration[c]);
    } catch { return false; }
  });
}
export function readBestScore(storage: Pick<ConfigurationStorage,'getItem'>, missionId: string, rules: ChallengeRules): number | null {
  const records=read(storage).filter(r=>key(r.snapshot.missionId,r.snapshot)===key(missionId,rules));
  return records.length?Math.max(...records.map(r=>r.score)):null;
}
export function saveChallengeResult(storage: ConfigurationStorage, state: SessionState): 'saved'|'unchanged'|'excluded'|'unavailable' {
  const s=state.challenge;
  if(!s || s.testMode || state.phase!=='succeeded' || state.result?.outcome!=='succeeded')return 'excluded';
  const performance=challengePerformance(state);
  const score=scoreChallenge(s,'succeeded',performance).formalScore!;
  if(state.result.score?.formalScore!==score)return 'excluded';
  try {
    const records=read(storage), id=key(s.missionId,s);
    if(records.some(r=>key(r.snapshot.missionId,r.snapshot)===id && r.score>=score))return 'unchanged';
    storage.setItem(CHALLENGE_RECORDS_KEY,JSON.stringify({version:2,records:[...records.filter(r=>key(r.snapshot.missionId,r.snapshot)!==id),
      {sessionId:state.sessionId,snapshot:s,configuration:state.configuration,performance,score}]}));
    return 'saved';
  } catch { return 'unavailable'; }
}
