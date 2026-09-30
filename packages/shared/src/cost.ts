/**
 * Cost visibility (task 21; requirement 25; design.md › RBAC matrix "Cost
 * figures (₱)"; P1, P11).
 *
 * One policy, used by the API to shape every response and by the SPA to
 * decide whether to render a ₱ figure or the "hidden for your role" state:
 *
 *  - EXE, PLN, HR and FIN see cost at every level, within their scope. The
 *    network level needs a global or region scope (a region-scoped role's
 *    "network" figure is the total over its own regions, computed by the
 *    endpoint from in-scope stores only).
 *  - A Store Manager sees store, department and individual cost for their own
 *    store(s) only, and never network cost (25.1).
 *  - Staff never see any cost figure, not even for their own shifts (25.3,
 *    P11); ADM and RST have no cost access (matrix "—").
 *
 * The API never relies on the UI hiding a figure: handlers build cost values
 * with `costFigure(target, value)` and `shapeCost` removes every figure the
 * viewer may not see from the response before it is serialised. A number
 * under a key containing "cost" that is not wrapped in `costFigure` is a
 * programming error and makes `shapeCost` throw (fail closed), and an
 * unshaped `CostFigure` serialises to nothing.
 */
import { can } from './rbac.js';
import { isStoreInScope, type RoleCode, type Scope, type StoreRef } from './roles.js';

/** The levels a ₱ figure can be reported at, widest first. */
export const COST_LEVELS = ['network', 'store', 'department', 'individual'] as const;
export type CostLevel = (typeof COST_LEVELS)[number];

/** Levels a Store Manager may see (own store only). */
const STORE_MANAGER_LEVELS: readonly CostLevel[] = ['store', 'department', 'individual'];

/**
 * What a figure is the cost of. Every level except `network` names the store
 * whose cost it is: for `department` the department's store, for
 * `individual` (one cashier's shifts or pay) the store where the cost is
 * incurred. A figure without a store is only ever shown at network level.
 */
export type CostTarget =
  | { readonly level: 'network' }
  | { readonly level: 'store' | 'department' | 'individual'; readonly store: StoreRef };

/** Who is looking: the active role and its scope (either `null` sees nothing). */
export interface CostViewer {
  readonly role: RoleCode | null;
  readonly scope: Scope | null;
}

/**
 * The levels at which `role` may ever see cost, before scope is applied.
 * Empty for Staff, ADM, RST and no role.
 */
export function costLevelsFor(role: RoleCode | null): CostLevel[] {
  if (role === null || role === 'STF' || !can(role, 'cost_figures', 'view')) return [];
  return role === 'STM' ? [...STORE_MANAGER_LEVELS] : [...COST_LEVELS];
}

/** Whether `viewer` may see a ₱ figure for `target` (requirement 25). */
export function canSeeCost(viewer: CostViewer, target: CostTarget): boolean {
  const { role, scope } = viewer;
  if (scope === null || scope.type === 'self') return false;
  if (!costLevelsFor(role).includes(target.level)) return false;
  if (target.level === 'network') return scope.type === 'global' || scope.type === 'region';
  return isStoreInScope(scope, target.store);
}

/**
 * A ₱ figure awaiting `shapeCost`. Serialises to nothing (`toJSON` returns
 * `undefined`, so `JSON.stringify` drops the key), so a figure that skipped
 * shaping can never leak.
 */
export class CostFigure {
  constructor(
    readonly target: CostTarget,
    readonly value: number,
  ) {}

  toJSON(): undefined {
    return undefined;
  }
}

/** Wraps a ₱ amount with what it is the cost of. Use for every cost field. */
export function costFigure(target: CostTarget, value: number): CostFigure {
  return new CostFigure(target, value);
}

/**
 * A response body as built by a handler: any number may instead be a
 * `CostFigure`, and optional cost fields stay optional because `shapeCost`
 * removes the ones the viewer may not see.
 */
export type CostDraft<T> = T extends number
  ? number | CostFigure
  : T extends readonly (infer U)[]
    ? readonly CostDraft<U>[]
    : T extends object
      ? { readonly [K in keyof T]: CostDraft<T[K]> }
      : T;

/** Keys that hold a ₱ figure and so must be wrapped in `costFigure`. */
const COST_KEY = /cost/i;

/** Thrown when a response carries a cost-named number that was not wrapped. */
export class UntaggedCostFieldError extends Error {
  constructor(readonly path: string) {
    super(`Cost field "${path}" is not a costFigure(); wrap it so cost visibility applies.`);
    this.name = 'UntaggedCostFieldError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shape(value: unknown, viewer: CostViewer, path: string): unknown {
  if (value instanceof CostFigure) {
    throw new Error(`Cost figure at "${path}" must be an object property, not an array element.`);
  }
  if (Array.isArray(value)) return value.map((item, i) => shape(item, viewer, `${path}[${i}]`));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    if (child instanceof CostFigure) {
      if (canSeeCost(viewer, child.target)) out[key] = child.value;
      continue; // Not permitted: the field is removed, not blanked.
    }
    if (typeof child === 'number' && COST_KEY.test(key)) throw new UntaggedCostFieldError(childPath);
    out[key] = shape(child, viewer, childPath);
  }
  return out;
}

/**
 * Resolves every `CostFigure` in `body` for `viewer`: a permitted figure
 * becomes its number, any other is removed with its key. Returns a new value
 * (the input is not changed). Throws `UntaggedCostFieldError` for a raw
 * number under a cost-named key.
 */
export function shapeCost<T>(body: CostDraft<T>, viewer: CostViewer): T {
  return shape(body, viewer, '') as T;
}
