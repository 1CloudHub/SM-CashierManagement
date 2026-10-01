/**
 * `GET /me` and `PUT /me/active-role` (task 8.1/8.2): the caller's identity,
 * assignments, active role, effective permissions and visible nav for the
 * SPA, and the demo role switcher's persisted choice.
 */
import { randomUUID } from 'node:crypto';
import {
  ROLE_CODES,
  costLevelsFor,
  effectivePermissions,
  resolveActiveRole,
  selectableRoles,
  visibleNav,
  type MeResponse,
  type RoleCode,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import type { RbacConfig } from '../auth/config.js';
import { authenticated } from '../auth/guards.js';
import { ACTIVE_ROLE_HEADER_KEY, resolvePrincipal } from '../auth/principal.js';
import { resolveScope } from '../auth/scope.js';
import { requireIdentity, type Identity, type Principal } from '../context.js';
import { withAuditedTransaction } from '../db/audit.js';
import { queryMaybe } from '../db/rows.js';
import { NoChange as NoActivation, activateInvitedUser } from '../db/repositories/admin-users.js';
import { provisionUser, setActiveRole } from '../db/repositories/users.js';
import { ApiError, errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface MeDeps {
  readonly db: () => pg.Pool;
  readonly rbac: RbacConfig;
}

async function ownStaff(db: pg.Pool, staffId: string): Promise<MeResponse['staff']> {
  const row = await queryMaybe<{ id: string; name: string } & pg.QueryResultRow>(
    db,
    'SELECT id, name FROM staff WHERE id = $1',
    [staffId],
  );
  return row && { id: row.id, name: row.name };
}

function displayName(identity: Identity): string {
  return identity.name ?? identity.email.slice(0, identity.email.indexOf('@'));
}

async function buildMe(
  db: pg.Pool,
  identity: Identity,
  principal: Principal | null,
  header: string | undefined,
  rbac: RbacConfig,
): Promise<MeResponse> {
  const demoMode = rbac.demoRoleSwitcher;
  let activeRole: RoleCode | null;
  let scope: MeResponse['scope'];
  if (principal) {
    activeRole = principal.activeRole;
    scope = principal.scope;
  } else {
    const active = resolveActiveRole({ header, assignments: [], demoMode });
    activeRole = active.ok ? active.role : null;
    scope = activeRole === null ? null : await resolveScope(db, activeRole, [], rbac);
  }
  const assignments = principal?.assignments ?? [];
  return {
    user: { id: principal?.userId ?? null, email: identity.email, name: principal?.name ?? displayName(identity) },
    provisioned: principal !== null,
    demoMode,
    assignments: assignments.map((a) => ({ role: a.role, scope: a.scope })),
    selectableRoles: selectableRoles(assignments, demoMode),
    activeRole,
    scope,
    permissions: effectivePermissions(activeRole),
    nav: visibleNav(activeRole),
    costLevels: costLevelsFor(activeRole),
    // Staff: only their own record, never another cashier's (P11).
    staff: scope?.type === 'self' ? await ownStaff(db, scope.staffId) : null,
  };
}

/**
 * The first signed-in `GET /me` of an invited user (SCR-071) makes them
 * active and links their Cognito identity — one `user.activated` event,
 * recorded as the user themselves.
 */
async function activateIfInvited(db: pg.Pool, userId: string, role: RoleCode, sub: string, requestId: string): Promise<void> {
  const row = await queryMaybe<{ status: string } & pg.QueryResultRow>(db, 'SELECT status FROM app_user WHERE id = $1', [userId]);
  if (row?.status !== 'invited') return;
  try {
    await withAuditedTransaction(db, { userId, activeRole: role, requestId }, (tx) => activateInvitedUser(tx, userId, sub));
  } catch (err) {
    // A concurrent request activated them first.
    if (!(err instanceof NoActivation)) throw err;
  }
}

const setActiveRoleBody = z.object({ role: z.enum(ROLE_CODES) }).strict();

class NoChange extends Error {}

export function registerMeRoutes(router: Router, deps: MeDeps): Router {
  return router
    .get('/me', authenticated(), async (request, context) => {
      const identity = requireIdentity(context);
      const principal = context.principal;
      if (principal !== null && principal.activeRole !== null) {
        await activateIfInvited(deps.db(), principal.userId, principal.activeRole, identity.sub, context.requestId);
      }
      const body = await buildMe(deps.db(), identity, principal, request.headers[ACTIVE_ROLE_HEADER_KEY], deps.rbac);
      return { statusCode: 200, body };
    })
    .put('/me/active-role', authenticated(), async (request, context) => {
      const identity = requireIdentity(context);
      const { role } = parseInput(setActiveRoleBody, request.body, 'body');
      const db = deps.db();
      const principal = context.principal;
      if (!selectableRoles(principal?.assignments ?? [], deps.rbac.demoRoleSwitcher).includes(role)) {
        throw errors.forbidden();
      }

      if (principal === null) {
        // First role choice after demo self sign-up: provision the user (one audit event).
        const id = randomUUID();
        try {
          await withAuditedTransaction(db, { userId: id, activeRole: role, requestId: context.requestId }, (tx) =>
            provisionUser(tx, { id, email: identity.email, name: displayName(identity), cognitoSub: identity.sub, activeRole: role }),
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new ApiError('conflict', 'Your account was just set up in another request. Try again.');
          }
          throw err;
        }
      } else {
        try {
          await withAuditedTransaction(
            db,
            { userId: principal.userId, activeRole: role, requestId: context.requestId },
            async (tx) => {
              // Locked re-read: concurrent identical switches audit once, not twice.
              const locked = await queryMaybe<{ active_role: RoleCode | null } & pg.QueryResultRow>(
                tx,
                'SELECT active_role FROM app_user WHERE id = $1 FOR UPDATE',
                [principal.userId],
              );
              if (locked?.active_role === role) throw new NoChange();
              return setActiveRole(tx, principal.userId, role);
            },
          );
        } catch (err) {
          if (!(err instanceof NoChange)) throw err;
        }
      }

      const updated = await resolvePrincipal(db, identity, role, deps.rbac);
      return { statusCode: 200, body: await buildMe(db, identity, updated, role, deps.rbac) };
    });
}
