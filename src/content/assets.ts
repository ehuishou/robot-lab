import { MODULES } from './modules';

export interface AssetDefinition {
  readonly id: string;
  readonly kind: 'module' | 'item' | 'environment';
  readonly source: Readonly<{ kind: 'procedural'; recipeId: string }>;
  readonly sizeM: readonly [number, number, number];
  readonly required: boolean;
  readonly fallback: 'error' | 'omit';
  readonly status: 'planned-placeholder' | 'procedural-preview';
  readonly authorization: 'project-authored-procedure';
}

const moduleSizes: Record<string, readonly [number, number, number]> = {
  chassis: [2.4, 0.8, 1.4], motor: [0.6, 0.5, 0.5], battery: [0.8, 0.5, 0.6],
  sensor: [0.4, 0.5, 0.4], tool: [1.2, 1.4, 0.8], accessory: [1.2, 1.4, 0.8],
};

export const PREVIEW_ASSETS: readonly AssetDefinition[] = [
  ...MODULES.map(module => ({
    id: module.viewAssetId, kind: 'module' as const,
    source: { kind: 'procedural' as const, recipeId: module.id }, sizeM: moduleSizes[module.category],
    required: true, fallback: 'error' as const, status: 'procedural-preview' as const,
    authorization: 'project-authored-procedure' as const,
  })),
  ...[
    { id: 'item:cargo_light', recipeId: 'transport-crate', sizeM: [0.8, 0.8, 0.8] as const },
    { id: 'item:delivery_zone', recipeId: 'delivery-pad', sizeM: [4, 0.1, 2.4] as const },
  ].map(asset => ({
    id: asset.id, kind: 'item' as const, source: { kind: 'procedural' as const, recipeId: asset.recipeId },
    sizeM: asset.sizeM, required: true, fallback: 'error' as const, status: 'procedural-preview' as const,
    authorization: 'project-authored-procedure' as const,
  })),
  {
    id: 'environment:logistics-bay', kind: 'environment',
    source: { kind: 'procedural', recipeId: 'logistics-bay' }, sizeM: [100, 12, 20],
    required: true, fallback: 'error', status: 'procedural-preview', authorization: 'project-authored-procedure',
  },
];
