import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TRANSPORT_MISSION } from '../src/content/challenges';
import { MODULES } from '../src/content/modules';
import { MODULE_CATEGORIES, validateConfiguration, type Configuration } from '../src/domain/config/validateConfiguration';
import { createChallengeSnapshot, scoreChallenge, type ChallengePerformance } from '../src/domain/mission/scoring';
import { normalizeNickname } from '../src/domain/identity/nickname';

interface Entry {
  id: string; nickname: string; key: string; score: number; achievedAt: string; updatedAt: string;
  performance: ChallengePerformance | null; configuration: Configuration | null; manual: boolean;
}
interface Store { version: 1; rulesVersion: string; revision: number; entries: Entry[]; receipts: string[] }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const directory = resolve(process.env.ROBOT_DATA_DIR ?? 'data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = join(directory, 'leaderboard.json');
const rules = TRANSPORT_MISSION.challenge!;
let store: Store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, rulesVersion: rules.rulesVersion, revision: 0, entries: [], receipts: [] };
// Fail closed on malformed data or a rules upgrade; never silently replace existing scores.
if (store.version !== 1 || store.rulesVersion !== rules.rulesVersion || !Number.isSafeInteger(store.revision)
  || !Array.isArray(store.entries) || !Array.isArray(store.receipts)
  || store.entries.some(e => !e.id || normalizeNickname(e.nickname).key !== e.key || !Number.isSafeInteger(e.score) || (e.manual !== true && (e.score < 0 || e.score > 5000)))
  || new Set(store.entries.map(e => e.key)).size !== store.entries.length) throw new Error('Invalid or incompatible leaderboard data; restore backup or migrate explicitly.');
function persist(next: Store) {
  const temporary = file + '.next';
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
  if (existsSync(file)) writeFileSync(file + '.bak', readFileSync(file), { mode: 0o600 });
  renameSync(temporary, file); store = next;
}
const passwordFile = process.env.ROBOT_ADMIN_PASSWORD_FILE;
const password = passwordFile ? readFileSync(passwordFile, 'utf8').trim() : process.env.ROBOT_ADMIN_PASSWORD;
if (!password || password.length < 16) throw new Error('Set ROBOT_ADMIN_PASSWORD_FILE with a password of at least 16 characters.');
const salt = randomBytes(16), passwordHash = scryptSync(password, salt, 32);
const sessions = new Map<string, number>();
const limits = new Map<string, { count: number; until: number }>();
function rate(key: string, maximum: number) {
  const now = Date.now();
  if (limits.size > 10000) for (const [k,v] of limits) if (v.until < now) limits.delete(k);
  const current = limits.get(key);
  if (!current || current.until <= now) { limits.set(key, { count: 1, until: now + 60000 }); return; }
  if (++current.count > maximum) throw new HttpError(429, '请稍后再试。');
}
function isAdmin(req: IncomingMessage) {
  const token = /(?:^|;\s*)robot_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
  return !!token && (sessions.get(token) ?? 0) > Date.now();
}
function auth(req: IncomingMessage) { if (!isAdmin(req)) throw new HttpError(401, '请先登录管理。'); }
function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON required');
  // Nginx supplies original scheme and host; the API port is private in production.
  const origin = req.headers.origin;
  const expected = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
  if (origin && origin !== expected) throw new HttpError(403, 'Origin rejected');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 16384) throw new HttpError(413, 'Request too large'); chunks.push(buffer); }
  const text = Buffer.concat(chunks).toString('utf8');
  try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; }
  catch { throw new HttpError(400, '请求数据无效。'); }
}
function manualScore(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new HttpError(400, '分数必须是可精确保存的整数。');
  return value as number;
}
function validateRun(input: Record<string, unknown>) {
  const { nickname, key } = normalizeNickname(input.nickname);
  if (typeof input.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.sessionId) || input.rulesVersion !== rules.rulesVersion
    || input.testMode !== false || input.outcome !== 'succeeded') throw new HttpError(400, '只接受当前规则的正式通关成绩。');
  const config = input.configuration as Configuration;
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !MODULE_CATEGORIES.includes(k as typeof MODULE_CATEGORIES[number]))) throw new HttpError(400, 'Invalid configuration');
  const valid = validateConfiguration(config, MODULES, TRANSPORT_MISSION.configurationRules);
  if (!valid.valid || !valid.summary) throw new HttpError(400, 'Invalid configuration');
  const p = input.performance as ChallengePerformance;
  if (!p || typeof p !== 'object' || p.maxTimeSeconds !== TRANSPORT_MISSION.hardLimits?.maxTimeSeconds
    || p.batteryCapacityUnits !== valid.summary.batteryCapacityUnits || p.elapsedSeconds < 10) throw new HttpError(400, 'Invalid performance');
  const snapshot = createChallengeSnapshot(TRANSPORT_MISSION.id, rules, valid.summary.cost, false);
  const score = scoreChallenge(snapshot, 'succeeded', p).formalScore!;
  if (input.score !== score) throw new HttpError(400, 'Score mismatch');
  // Persist only approved fields, never arbitrary client data.
  const performance: ChallengePerformance = { elapsedSeconds: p.elapsedSeconds, maxTimeSeconds: p.maxTimeSeconds,
    energyRemainingUnits: p.energyRemainingUnits, batteryCapacityUnits: p.batteryCapacityUnits, cargoDelivered: p.cargoDelivered };
  const configuration = Object.fromEntries(MODULE_CATEGORIES.filter(c => config[c] != null).map(c => [c, config[c]])) as Configuration;
  return { nickname, key, score, performance, configuration, sessionId: input.sessionId };
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname, method = req.method;
    const ip = req.socket.remoteAddress + ':' + (req.headers['x-real-ip'] ?? '');
    if (path === '/api/health' && method === 'GET') { reply(res, 200, { ok: true, rulesVersion: rules.rulesVersion }); return; }
    if (path === '/api/leaderboard' && method === 'GET') {
      const entries = [...store.entries].sort((a,b) => b.score-a.score || a.achievedAt.localeCompare(b.achievedAt) || a.id.localeCompare(b.id));
      reply(res, 200, { rulesVersion: rules.rulesVersion, revision: store.revision, entries: entries.map(({ key: _key, ...entry },i) => ({ ...entry, rank: i+1 })) }); return;
    }
    if (path === '/api/admin/session' && method === 'GET') { reply(res, 200, { authenticated: isAdmin(req) }); return; }
    if (method === 'POST' && path === '/api/admin/login') {
      rate('login:'+ip, 8); const input = await body(req);
      const candidate = typeof input.password === 'string' && input.password.length <= 256 ? input.password : '';
      if (!timingSafeEqual(scryptSync(candidate, salt, 32), passwordHash)) throw new HttpError(401, '管理密码不正确。');
      for (const [t,expires] of sessions) if (expires < Date.now()) sessions.delete(t);
      if (sessions.size > 100) throw new HttpError(429, 'Too many sessions');
      const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now()+8*3600000);
      res.setHeader('Set-Cookie', `robot_admin=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      reply(res, 200, { ok: true }); return;
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      await body(req); const token = /robot_admin=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1]; if (token) sessions.delete(token);
      res.setHeader('Set-Cookie','robot_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'); reply(res,200,{ok:true}); return;
    }
    if (path === '/api/scores' && method === 'POST') {
      rate('scores:'+ip, 60); const run = validateRun(await body(req));
      if (store.receipts.includes(run.sessionId)) { reply(res, 200, { status: 'duplicate' }); return; }
      if (store.receipts.length >= 100000) throw new HttpError(503, 'Submission capacity reached; contact administrator');
      const prior = store.entries.find(e => e.key === run.key);
      const improved = !prior || run.score > prior.score;
      const now = new Date().toISOString();
      const entry: Entry = { id: prior?.id ?? randomUUID(), nickname: run.nickname, key: run.key, score: run.score,
        achievedAt: now, updatedAt: now, performance: run.performance, configuration: run.configuration, manual: false };
      persist({ ...store, revision: store.revision+1, receipts: [...store.receipts,run.sessionId],
        entries: improved ? [...store.entries.filter(e => e.key !== run.key),entry] : store.entries });
      reply(res,200,{status:improved?'saved':'unchanged',bestScore:improved?run.score:prior!.score}); return;
    }
    if (path === '/api/admin/entries' && method === 'POST') {
      auth(req); const input = await body(req);
      if (input.revision !== store.revision) throw new HttpError(409, '榜单已更新，请刷新后重试。');
      const name = normalizeNickname(input.nickname), score = manualScore(input.score);
      if (store.entries.some(e => e.key === name.key)) throw new HttpError(409, '昵称已有成绩，请使用修改功能。');
      const now = new Date().toISOString();
      const entry: Entry = { id: randomUUID(), ...name, score, achievedAt: now, updatedAt: now,
        performance: null, configuration: null, manual: true };
      persist({ ...store, revision: store.revision+1, entries: [...store.entries, entry] });
      reply(res, 200, { ok: true }); return;
    }
    const match = /^\/api\/admin\/entries\/([a-f0-9-]{36})$/.exec(path);
    if (match && (method === 'PATCH' || method === 'DELETE')) {
      auth(req); const input = await body(req);
      if (input.revision !== store.revision) throw new HttpError(409, '榜单已更新，请刷新后重试。');
      const entry = store.entries.find(e => e.id === match[1]);
      if (!entry) throw new HttpError(404, '记录已删除。');
      let entries = store.entries.filter(e => e.id !== entry.id);
      if (method === 'PATCH') {
        const name = normalizeNickname(input.nickname);
        if (entries.some(e => e.key === name.key)) throw new HttpError(409, '昵称已有成绩，请使用其他昵称或先删除重复记录。');
        const score = manualScore(input.score);
        entries = [...entries,{ ...entry, ...name, score, manual:true, updatedAt:new Date().toISOString() }];
      }
      persist({ ...store, revision:store.revision+1, entries }); reply(res,200,{ok:true}); return;
    }
    throw new HttpError(404, 'Not found');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof RangeError || error instanceof TypeError ? 400 : 500;
    // Validation errors contain no personal or secret data. Never log request bodies.
    if (status === 500) console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    reply(res,status,{error:status===500?'保存失败，请稍后重试。':(error as Error).message});
  }
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(Number(process.env.PORT ?? 3002), process.env.HOST ?? '127.0.0.1', () => console.log('Score API ready'));
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
