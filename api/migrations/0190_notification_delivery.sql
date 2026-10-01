-- LaneWise schema 0190 — notification delivery and preferences (task 19;
-- Req 20; P1, P11).
--
-- 1. Email outbox. Every notification row carries its email delivery state, so
--    rows written by any path (repositories, the scenario-pause trigger in
--    0120) are emailed by one dispatcher (api/src/notifications/dispatch.ts),
--    immediately after the request that raised them (Req 20.2: no digest).
--    The dispatcher decides per row from the catalogue in @lanewise/shared
--    and the recipient's preferences: `sent`, `skipped` (preference off,
--    in-app-only event, demo persona) or, after repeated SES errors, `failed`.
--    Rows that existed before this migration are history, not news: they are
--    marked `skipped` so the first deploy does not email them.
ALTER TABLE notification
  ADD COLUMN email_status text NOT NULL DEFAULT 'skipped'
    CHECK (email_status IN ('pending', 'sent', 'skipped', 'failed')),
  ADD COLUMN email_attempts smallint NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
  ADD COLUMN email_updated_at timestamptz;
ALTER TABLE notification ALTER COLUMN email_status SET DEFAULT 'pending';
CREATE INDEX notification_email_pending_idx ON notification (created_at) WHERE email_status = 'pending';

-- 2. A notification's content is fixed once raised: only its read stamp and
--    delivery state change, and a read notification stays read. (Rows are
--    still deleted with their user, and by the demo reset for synthetic rows.)
CREATE FUNCTION lw_notification_content_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.event IS DISTINCT FROM OLD.event
     OR NEW.object_type IS DISTINCT FROM OLD.object_type
     OR NEW.object_id IS DISTINCT FROM OLD.object_id
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.params IS DISTINCT FROM OLD.params
     OR NEW.synthetic IS DISTINCT FROM OLD.synthetic
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notification content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'a read notification stays read' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notification_content_immutable BEFORE UPDATE ON notification
  FOR EACH ROW EXECUTE FUNCTION lw_notification_content_immutable();

-- 3. Preferences are kept per category (`event` holds the category key of the
--    catalogue). Approvals and security notices cannot be turned off on any
--    channel (Req 20.3); the API refuses it too.
ALTER TABLE notification_preference
  ADD CONSTRAINT notification_preference_mandatory_on
    CHECK (enabled OR event NOT IN ('approvals', 'security'));
CREATE TRIGGER notification_preference_updated_at BEFORE UPDATE ON notification_preference
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();
