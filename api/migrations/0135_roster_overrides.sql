-- LaneWise schema 0135 — store-manager overrides on a published roster
-- (task 13.4; Req 7; P7, P14).
--
-- The `shift_override` table and its published-only trigger come from 0004.
-- This migration adds what the override API records and the database-level
-- guarantees behind P14:
--   * `off_reason`: why a cashier was marked emergency off (emergency offs only);
--   * a blocking labor-rule breach (missed 24-hour rest, overlap) is never
--     stored — the API refuses such a change, and the table refuses it too;
--   * overrides are immutable: no UPDATE, and DELETE only of seeded demo rows
--     (the task 23 demo reset), so the traceability trail cannot be rewritten.

ALTER TABLE shift_override
  ADD COLUMN off_reason text CHECK (off_reason IS NULL OR off_reason IN ('sickCall', 'family', 'other')),
  ADD CONSTRAINT shift_override_off_reason_type CHECK (off_reason IS NULL OR override_type = 'emergency_off'),
  ADD CONSTRAINT shift_override_no_blocking_breach CHECK (
    NOT jsonb_path_exists(rule_breaches, '$[*] ? (@.severity == "block")')
  );

-- ✎ markers: the latest override per shift.
CREATE INDEX shift_override_shift_idx ON shift_override (shift_id, created_at DESC);

CREATE FUNCTION lw_shift_override_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.synthetic THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'shift overrides are append-only (% refused)', TG_OP
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER shift_override_immutable BEFORE UPDATE OR DELETE ON shift_override
  FOR EACH ROW EXECUTE FUNCTION lw_shift_override_immutable();
