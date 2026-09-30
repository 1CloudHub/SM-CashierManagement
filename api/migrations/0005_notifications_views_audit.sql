-- LaneWise schema 0005 — notifications, preferences, saved views and the
-- append-only audit log (Req 20, 21, 22; P7, P12).

CREATE TABLE notification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  object_type text NOT NULL,
  object_id   text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  -- Message parameters; text is rendered per the user's language (Req 20.5).
  params      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
  synthetic   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
CREATE INDEX notification_unread_idx ON notification (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preference (
  user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  event   text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  channel text NOT NULL CHECK (channel IN ('email', 'in_app')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event, channel)
);

CREATE TABLE saved_view (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  screen     text NOT NULL CHECK (screen ~ '^SCR-[0-9]{3}$'),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  -- URL-encoded filters/sort/scenario (Req 21.3).
  query      text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_view_name_key UNIQUE (user_id, screen, name)
);
-- One default view per user per screen (Req 21.5).
CREATE UNIQUE INDEX saved_view_one_default ON saved_view (user_id, screen) WHERE is_default;
CREATE TRIGGER saved_view_updated_at BEFORE UPDATE ON saved_view
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- ---------------------------------------------------------------------------
-- AuditEvent — immutable, append-only (Req 22; P7, P12). Written by
-- audit.record(...) in the same transaction as the mutation it describes.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic insertion order (timestamps can tie within a transaction).
  seq         bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid NOT NULL REFERENCES app_user (id),
  -- The role active when the action was taken (P12).
  active_role text NOT NULL CHECK (active_role IN ('ADM','EXE','PLN','STM','HR','FIN','RST','STF')),
  action      text NOT NULL CHECK (action IN (
    'create', 'edit', 'submit', 'decision', 'publish', 'ingestion', 'export', 'role_change'
  )),
  event       text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  object_type text NOT NULL CHECK (length(object_type) > 0),
  object_id   text NOT NULL CHECK (length(object_id) > 0),
  before      jsonb,
  after       jsonb,
  request_id  text,
  synthetic   boolean NOT NULL DEFAULT false,
  CONSTRAINT audit_event_create_has_no_before CHECK (action <> 'create' OR before IS NULL)
);
CREATE INDEX audit_event_at_idx ON audit_event (at DESC);
CREATE INDEX audit_event_object_idx ON audit_event (object_type, object_id, seq);
CREATE INDEX audit_event_user_idx ON audit_event (user_id, at DESC);

-- Append-only: UPDATE is always rejected. DELETE is rejected except the
-- retention purge (Q13: 5 years), which must opt in per transaction with
--   SET LOCAL lanewise.audit_retention_purge = 'on'
-- and can only remove events older than 5 years.
CREATE FUNCTION lw_audit_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('lanewise.audit_retention_purge', true) = 'on'
     AND OLD.at < now() - interval '5 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION lw_audit_event_append_only();

CREATE FUNCTION lw_audit_event_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (TRUNCATE rejected)'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION lw_audit_event_no_truncate();

-- The application role may only read and append.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM lanewise_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM PUBLIC;
