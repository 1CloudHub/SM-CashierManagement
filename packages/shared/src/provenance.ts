/**
 * Data provenance (Requirements 18/19; P9 provenance, P18 demo-data isolation).
 */

export type Provenance = 'synthetic' | 'real' | 'mixed' | 'empty';

/**
 * Classifies a record set by its `synthetic` flags. A snapshot, run or export
 * must never be `mixed` (P18).
 */
export function provenanceOf(records: readonly { readonly synthetic: boolean }[]): Provenance {
  if (records.length === 0) return 'empty';
  let synthetic = 0;
  for (const r of records) if (r.synthetic) synthetic += 1;
  if (synthetic === records.length) return 'synthetic';
  if (synthetic === 0) return 'real';
  return 'mixed';
}
