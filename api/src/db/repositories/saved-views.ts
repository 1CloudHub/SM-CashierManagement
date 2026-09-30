/**
 * Saved views (task 20; requirement 21.5). A view belongs to one user and is
 * only ever read or changed through that user's id: every query here filters
 * by `user_id`. Each change records exactly one audit event (P7); setting a
 * view as the default clears the previous default for that screen in the same
 * transaction, which is part of the one change (migration 0005 enforces one
 * default per user per screen).
 */
import type { AuditSnapshot, SavedView, SavedViewScreen } from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe } from '../rows.js';

interface SavedViewRow extends pg.QueryResultRow {
  id: string;
  screen: SavedViewScreen;
  name: string;
  query: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, screen, name, query, is_default, created_at, updated_at';

function toView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    screen: row.screen,
    name: row.name,
    query: row.query,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function snapshot(view: SavedView): AuditSnapshot {
  return { screen: view.screen, name: view.name, query: view.query, isDefault: view.isDefault };
}

/** The user's views, optionally for one screen: defaults first, then by name. */
export async function listSavedViews(db: Queryable, userId: string, screen?: SavedViewScreen): Promise<SavedView[]> {
  const { rows } = await db.query<SavedViewRow>(
    `SELECT ${COLUMNS} FROM saved_view
      WHERE user_id = $1 AND ($2::text IS NULL OR screen = $2)
      ORDER BY screen, is_default DESC, name`,
    [userId, screen ?? null],
  );
  return rows.map(toView);
}

/** One of the user's views (row-locked inside a transaction), or `null`. */
async function getOwnedForUpdate(tx: Queryable, userId: string, id: string): Promise<SavedView | null> {
  const row = await queryMaybe<SavedViewRow>(
    tx,
    `SELECT ${COLUMNS} FROM saved_view WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId],
  );
  return row && toView(row);
}

async function clearDefault(tx: Queryable, userId: string, screen: SavedViewScreen, exceptId: string | null): Promise<void> {
  await tx.query(
    `UPDATE saved_view SET is_default = false
      WHERE user_id = $1 AND screen = $2 AND is_default AND ($3::uuid IS NULL OR id <> $3)`,
    [userId, screen, exceptId],
  );
}

export interface CreateSavedViewInput {
  readonly screen: SavedViewScreen;
  readonly name: string;
  /** Already normalised (canonical view query). */
  readonly query: string;
  readonly isDefault: boolean;
}

/** Creates a view owned by the acting user. A duplicate name raises the driver's 23505. */
export async function createSavedView(tx: AuditedTx, input: CreateSavedViewInput): Promise<SavedView> {
  const userId = tx.actor.userId;
  if (input.isDefault) await clearDefault(tx, userId, input.screen, null);
  const { rows } = await tx.query<SavedViewRow>(
    `INSERT INTO saved_view (user_id, screen, name, query, is_default)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [userId, input.screen, input.name, input.query, input.isDefault],
  );
  const view = toView(rows[0] as SavedViewRow);
  await audit.record(tx, {
    action: 'create',
    event: 'saved_view.created',
    objectType: 'saved_view',
    objectId: view.id,
    after: snapshot(view),
  });
  return view;
}

export interface UpdateSavedViewInput {
  readonly name?: string | undefined;
  readonly query?: string | undefined;
  readonly isDefault?: boolean | undefined;
}

export class SavedViewNotFound extends Error {}
export class SavedViewUnchanged extends Error {
  constructor(readonly view: SavedView) {
    super('unchanged');
  }
}

/**
 * Renames / re-filters / (un)sets the default of one of the acting user's
 * views. Throws `SavedViewNotFound` for a view they don't own and
 * `SavedViewUnchanged` (rolling back, so nothing is audited) for a no-op.
 */
export async function updateSavedView(tx: AuditedTx, id: string, input: UpdateSavedViewInput): Promise<SavedView> {
  const userId = tx.actor.userId;
  const before = await getOwnedForUpdate(tx, userId, id);
  if (!before) throw new SavedViewNotFound();
  const next = {
    name: input.name ?? before.name,
    query: input.query ?? before.query,
    isDefault: input.isDefault ?? before.isDefault,
  };
  if (next.name === before.name && next.query === before.query && next.isDefault === before.isDefault) {
    throw new SavedViewUnchanged(before);
  }
  if (next.isDefault && !before.isDefault) await clearDefault(tx, userId, before.screen, id);
  const { rows } = await tx.query<SavedViewRow>(
    `UPDATE saved_view SET name = $3, query = $4, is_default = $5
      WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId, next.name, next.query, next.isDefault],
  );
  const view = toView(rows[0] as SavedViewRow);
  await audit.record(tx, {
    action: 'edit',
    event: 'saved_view.updated',
    objectType: 'saved_view',
    objectId: id,
    before: snapshot(before),
    after: snapshot(view),
  });
  return view;
}

/** Deletes one of the acting user's views; `SavedViewNotFound` otherwise. */
export async function deleteSavedView(tx: AuditedTx, id: string): Promise<SavedView> {
  const before = await getOwnedForUpdate(tx, tx.actor.userId, id);
  if (!before) throw new SavedViewNotFound();
  await tx.query('DELETE FROM saved_view WHERE id = $1 AND user_id = $2', [id, tx.actor.userId]);
  await audit.record(tx, {
    action: 'edit',
    event: 'saved_view.deleted',
    objectType: 'saved_view',
    objectId: id,
    before: snapshot(before),
    after: null,
  });
  return before;
}
