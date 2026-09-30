/**
 * Audit event shape (Requirement 22; P7 audit completeness, P12 active-role
 * enforcement). Events are immutable and append-only (task 5.2).
 */
import type { IsoDateTime } from './entities.js';
import type { RoleCode } from './roles.js';

/** Every action class that must produce exactly one audit event (P7). */
export const AUDIT_ACTIONS = [
  'create',
  'edit',
  'submit',
  'decision',
  'publish',
  'ingestion',
  'export',
  'role_change',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** JSON-serialisable snapshot of an object before/after a change. */
export type AuditSnapshot = Readonly<Record<string, unknown>> | null;

export interface AuditEvent {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly userId: string;
  /** The role active when the action was taken (P12). */
  readonly activeRole: RoleCode;
  readonly action: AuditAction;
  /** Specific event name, e.g. `scenario.submitted`. */
  readonly event: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly before: AuditSnapshot;
  readonly after: AuditSnapshot;
  readonly requestId: string | null;
}
