import type { EnvironmentDefinition } from '../simulation/environment';
import type { ChallengeRules } from './scoring';
import type { Configuration, ConfigurationRules } from '../config/validateConfiguration';
import type { Cargo } from '../simulation/cargo';
import type { TerrainDefinition } from '../simulation/terrain';

interface PlacedItem {
  readonly id: string;
  readonly xM: number;
  readonly viewAssetId: string;
}

export type MissionItem =
  | (PlacedItem & { readonly kind: 'cargo'; readonly cargo: Cargo; readonly pickupRadiusM: number })
  | (PlacedItem & { readonly kind: 'deliveryZone'; readonly startM: number; readonly endM: number });

export type MissionObjective =
  | { readonly id: string; readonly kind: 'deliver'; readonly optional?: boolean; readonly cargoIds: readonly string[]; readonly zoneId: string }
  | { readonly id: string; readonly kind: 'reach'; readonly xM: number };

export interface MissionDefinition {
  readonly testMode?: boolean;
  readonly environment?: EnvironmentDefinition;
  readonly challenge?: ChallengeRules;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly themeAssetId: string;
  readonly terrain: TerrainDefinition;
  readonly spawnXM: number;
  readonly platforms: readonly Readonly<{ id: string; startM: number; endM: number }>[];
  readonly layout: readonly MissionItem[];
  readonly objectives: readonly MissionObjective[];
  readonly hardLimits: Readonly<{ maxTimeSeconds: number }>;
  readonly configurationRules: ConfigurationRules;
  readonly recommendedConfiguration: Configuration;
}
