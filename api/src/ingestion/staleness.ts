/**
 * Which scenarios a load makes stale (task 9.2; Req 8.4, 17.4; P5). Pure.
 *
 * A load supersedes the current snapshot of its dataset type and provenance.
 * Every live scenario (not superseded or archived) that pins that snapshot is
 * then stale; its owner is notified. Stale is a flag, not a state.
 */

export const STALE_ELIGIBLE_STATUSES = ['draft', 'submitted', 'approved', 'published'] as const;

export interface ScenarioPin {
  readonly scenarioId: string;
  readonly snapshotId: string;
  readonly status: string;
  readonly stale: boolean;
}

export interface StaleCandidate {
  readonly scenarioId: string;
  readonly alreadyStale: boolean;
}

export function affectedByLoad(pins: readonly ScenarioPin[], supersededSnapshotId: string | null): StaleCandidate[] {
  if (supersededSnapshotId === null) return [];
  const out = new Map<string, StaleCandidate>();
  for (const pin of pins) {
    if (pin.snapshotId !== supersededSnapshotId) continue;
    if (!(STALE_ELIGIBLE_STATUSES as readonly string[]).includes(pin.status)) continue;
    if (!out.has(pin.scenarioId)) out.set(pin.scenarioId, { scenarioId: pin.scenarioId, alreadyStale: pin.stale });
  }
  return [...out.values()];
}
