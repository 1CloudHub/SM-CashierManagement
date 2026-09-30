/**
 * Seeded demo snapshot: master data + synthetic history + learned models,
 * packaged as a PlanningContext for the pipeline and the parity suite.
 */
import { learnForecastModels } from '../forecast.js';
import type { PlanningContext } from '../pipeline.js';
import { DEFAULT_SETTINGS, DEMO_RULE_SET, type RuleSet, type ScenarioSettings } from '../rules.js';
import type { HourlyHistoryRow } from '../types.js';
import { DEMO_SEED, DEMO_SNAPSHOT_ID, generateDemoHistory } from './generator.js';
import { DEMO_DEPARTMENTS, DEMO_STORES } from './master.js';

export * from './generator.js';
export * from './master.js';
export * from './prng.js';
export * from './staff.js';

export interface DemoSnapshot {
  readonly snapshotId: string;
  readonly seed: number;
  readonly history: readonly HourlyHistoryRow[];
}

export function createDemoSnapshot(seed: number = DEMO_SEED): DemoSnapshot {
  return { snapshotId: seed === DEMO_SEED ? DEMO_SNAPSHOT_ID : `snapshot-demo-seed-${seed}`, seed, history: generateDemoHistory(seed) };
}

export function createDemoContext(
  options: { snapshot?: DemoSnapshot; rules?: RuleSet; settings?: Partial<ScenarioSettings> } = {},
): PlanningContext {
  const snapshot = options.snapshot ?? createDemoSnapshot();
  return {
    stores: DEMO_STORES,
    departments: DEMO_DEPARTMENTS,
    models: learnForecastModels(DEMO_DEPARTMENTS, snapshot.history),
    rules: options.rules ?? DEMO_RULE_SET,
    settings: { ...DEFAULT_SETTINGS, ...options.settings },
    snapshotId: snapshot.snapshotId,
  };
}
