/**
 * Export auditing (Req 22.1, P7). Exports change no domain rows, but each one
 * is still recorded as exactly one `export` event.
 */
import { provenanceOf, type AuditEvent } from '@lanewise/shared';
import { audit, type AuditedTx } from '../audit.js';

export interface ExportRecordInput {
  /** Screen the export came from, e.g. `SCR-020`. */
  readonly screen: string;
  readonly format: 'csv' | 'pdf' | 'xlsx';
  readonly objectType: string;
  readonly objectId: string;
  readonly rowCount: number;
  /** URL-encoded filters/sort/scenario that produced it (Req 21.3). */
  readonly query: string;
  /** Carries the sample-data marker (P9); never mixed provenance (P18). */
  readonly synthetic: boolean;
}

export function recordExport(tx: AuditedTx, input: ExportRecordInput): Promise<AuditEvent> {
  return audit.record(tx, {
    action: 'export',
    event: 'export.generated',
    objectType: input.objectType,
    objectId: input.objectId,
    after: {
      screen: input.screen,
      format: input.format,
      rowCount: input.rowCount,
      query: input.query,
      sampleData: input.synthetic,
    },
    synthetic: input.synthetic,
  });
}

/** An export would combine synthetic (demo) and real records (P18). */
export class MixedProvenanceError extends Error {
  constructor() {
    super('an export must be entirely synthetic or entirely real (P18)');
    this.name = 'MixedProvenanceError';
  }
}

/**
 * The `synthetic` flag for an export of `records`: true when all are demo
 * data, false when all are real (or there are none). Throws
 * MixedProvenanceError for a mix, so no export ever combines them (Req 19.3).
 */
export function exportSynthetic(records: readonly { readonly synthetic: boolean }[]): boolean {
  const provenance = provenanceOf(records);
  if (provenance === 'mixed') throw new MixedProvenanceError();
  return provenance === 'synthetic';
}
