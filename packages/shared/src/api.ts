/**
 * API wire contracts shared by the API service and the SPA: the JSON error
 * model, the health-check response and the identity/RBAC contracts.
 */
import type { IsoDateTime, StoreFormat } from './entities.js';
import type { NavKey, PermissionAction, RbacResource } from './rbac.js';
import type { RoleCode, Scope } from './roles.js';

export const API_ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'conflict',
  'payload_too_large',
  'unsupported_media_type',
  'internal_error',
  'service_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal_error: 500,
  service_unavailable: 503,
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** One field-level validation problem. `path` is dot-joined (e.g. `settings.serviceLevel`). */
export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Error response body. `message` is safe to show to users; internals (stack
 * traces, SQL, object attributes outside scope) are never included. The
 * `requestId` is the reference ID shown on the 500/503 page.
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly ApiErrorDetail[];
  };
}

export const API_SERVICE_NAME = 'lanewise-api';

/** `GET /health` response contract (walking skeleton, task 3.5). */
export interface HealthResponse {
  readonly status: 'ok';
  readonly service: typeof API_SERVICE_NAME;
  readonly env: string;
  readonly time: IsoDateTime;
}

/**
 * Message for a deep link to an object that doesn't exist **or** is outside
 * the caller's scope. Both cases return the identical 404 body, so a response
 * never reveals whether an out-of-scope object exists (requirement 2.4, P1).
 */
export const NOT_FOUND_OR_NO_ACCESS_MESSAGE = "This item doesn't exist or you don't have access to it.";

/** Request header carrying the demo role switcher's choice (requirement 3.2). */
export const ACTIVE_ROLE_HEADER = 'X-Active-Role';

/** `GET /me` — who the caller is and what the active role lets them do (task 8.1). */
export interface MeResponse {
  readonly user: {
    /** `null` until the user is provisioned (first role choice in demo mode). */
    readonly id: string | null;
    readonly email: string;
    readonly name: string;
  };
  readonly provisioned: boolean;
  readonly demoMode: boolean;
  readonly assignments: readonly { readonly role: RoleCode; readonly scope: Scope }[];
  /** Roles the switcher may offer: all 8 in demo mode, else the assigned ones. */
  readonly selectableRoles: readonly RoleCode[];
  readonly activeRole: RoleCode | null;
  /** The active role's data scope; `null` without an active role. */
  readonly scope: Scope | null;
  readonly permissions: Partial<Record<RbacResource, PermissionAction[]>>;
  readonly nav: readonly NavKey[];
  /** Staff (self scope) only: the caller's own staff record, never anyone else's (P11). */
  readonly staff: { readonly id: string; readonly name: string } | null;
}

/** `PUT /me/active-role` request body. */
export interface SetActiveRoleRequest {
  readonly role: RoleCode;
}

/** A store as listed on SCR-052 and in scope pickers. */
export interface StoreSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly regionId: string;
  readonly active: boolean;
  readonly synthetic: boolean;
}

/** `GET /stores` — only stores in the active role's scope (P1). */
export interface StoreListResponse {
  readonly stores: readonly StoreSummary[];
}
