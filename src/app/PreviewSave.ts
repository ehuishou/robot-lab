import { TEST_MODE } from '../testing/TestMode';
import { MODULE_CATEGORIES } from '../domain/config/validateConfiguration';
import type { Configuration, ModuleDefinition } from '../domain/config/validateConfiguration';

export const PREVIEW_SAVE_KEY = TEST_MODE ? 'robot_lab_preview_test_v1' : 'robot_lab_preview_v1';

export interface ConfigurationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type SaveRejection = 'storageUnavailable' | 'invalidJson' | 'invalidFormat' | 'unsupportedVersion' | 'invalidConfiguration';
export type ConfigurationReadResult =
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'loaded'; configuration: Configuration }>
  | Readonly<{ status: 'rejected'; reason: SaveRejection }>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConfiguration(value: unknown, catalog: readonly ModuleDefinition[]): Configuration | null {
  if (!record(value) || Object.keys(value).some(key => !MODULE_CATEGORIES.includes(key as typeof MODULE_CATEGORIES[number]))) return null;
  const parsed = {} as Record<typeof MODULE_CATEGORIES[number], string | null>;
  for (const category of MODULE_CATEGORIES) {
    if (!Object.prototype.hasOwnProperty.call(value, category) && category !== 'accessory') return null;
    const selection = value[category] ?? null;
    if (selection !== null && (typeof selection !== 'string'
      || !catalog.some(module => module.id === selection && module.category === category))) return null;
    parsed[category] = selection as string | null;
  }
  return Object.freeze(parsed);
}

function readRecord(storage: Pick<ConfigurationStorage, 'getItem'>, key: string):
  { status: 'record'; value: unknown } | Exclude<ConfigurationReadResult, { status: 'loaded' }> {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: 'rejected', reason: 'storageUnavailable' };
  }
  if (raw === null) return { status: 'empty' };
  try {
    return { status: 'record', value: JSON.parse(raw) as unknown };
  } catch {
    return { status: 'rejected', reason: 'invalidJson' };
  }
}

export function readPreviewConfiguration(storage: Pick<ConfigurationStorage, 'getItem'>, catalog: readonly ModuleDefinition[]): ConfigurationReadResult {
  const result = readRecord(storage, PREVIEW_SAVE_KEY);
  if (result.status !== 'record') return result;
  if (!record(result.value) || !Object.prototype.hasOwnProperty.call(result.value, 'version')) return { status: 'rejected', reason: 'invalidFormat' };
  if (result.value.version !== 1) return { status: 'rejected', reason: 'unsupportedVersion' };
  if (Object.keys(result.value).length !== 2) return { status: 'rejected', reason: 'invalidFormat' };
  const configuration = parseConfiguration(result.value.configuration, catalog);
  return configuration ? { status: 'loaded', configuration } : { status: 'rejected', reason: 'invalidConfiguration' };
}

export function savePreviewConfiguration(storage: Pick<ConfigurationStorage, 'setItem'>, selection: Configuration,
  catalog: readonly ModuleDefinition[]): Readonly<{ saved: true } | { saved: false; reason: SaveRejection }> {
  const configuration = parseConfiguration(selection, catalog);
  if (!configuration) return { saved: false, reason: 'invalidConfiguration' };
  try {
    storage.setItem(PREVIEW_SAVE_KEY, JSON.stringify({ version: 1, configuration }));
    return { saved: true };
  } catch {
    return { saved: false, reason: 'storageUnavailable' };
  }
}
