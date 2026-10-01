-- ---------------------------------------------------------------------------
-- LaneWise schema 0180 — staff time-off and swap requests (task 18;
-- Req 15.3–15.7, 7.3/7.4; Q18; P7, P11, P14, P19).
--
-- `staff_request` and the `staff_request_id` links on `staff_availability`
-- and `shift_override` come from 0004. This migration adds what the request
-- API records and the database-level guarantees behind P19:
--
--   * Routing: each request names the store whose manager decides it (the
--     cashier's home store for time off, the offered shift's store for a
--     swap); a swap also records the colleague who held the target shift
--     when it was asked for (null = an open shift), so approval can tell the
--     roster moved since.
--   * Lifecycle: a request leaves `pending` exactly once (approved, declined
--     or cancelled, each stamped); its details never change; at most one
--     pending request per offered shift. Rows are append-only except the demo
--     reset (task 23) deleting seeded ones.
--   * ShiftOverride gains the two task 18 changes an approval applies —
--     `swap` (the shift changes hands) and `time_off` (an approved time-off
--     request leaves the cashier's shift open) — each tied to its request, so
--     only an approved request ever changes the roster (P19) and every
--     change stays traceable (P14).
-- ---------------------------------------------------------------------------

-- StaffRequest: routing, reason, colleague, stamps ---------------------------
ALTER TABLE staff_request
  ADD COLUMN store_id uuid,
  ADD COLUMN time_off_reason text CHECK (time_off_reason IS NULL OR time_off_reason IN ('family', 'medical', 'personal', 'other')),
  ADD COLUMN target_staff_id uuid REFERENCES staff (id),
  ADD COLUMN cancelled_at timestamptz;

UPDATE staff_request r SET store_id = s.store_id FROM staff s WHERE s.id = r.staff_id AND r.store_id IS NULL;

ALTER TABLE staff_request
  ALTER COLUMN store_id SET NOT NULL,
  ADD CONSTRAINT staff_request_store_fk FOREIGN KEY (store_id, synthetic) REFERENCES store (id, synthetic),
  ADD CONSTRAINT staff_request_reason_type CHECK (time_off_reason IS NULL OR request_type = 'time_off'),
  ADD CONSTRAINT staff_request_target_staff_type CHECK (target_staff_id IS NULL OR request_type = 'swap'),
  ADD CONSTRAINT staff_request_target_not_self CHECK (target_staff_id IS DISTINCT FROM staff_id),
  ADD CONSTRAINT staff_request_cancel_stamp CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT staff_request_note_length CHECK (note IS NULL OR length(note) <= 500),
  ADD CONSTRAINT staff_request_decision_note_length CHECK (decision_note IS NULL OR length(decision_note) <= 500);

CREATE INDEX staff_request_store_idx ON staff_request (store_id, status, created_at DESC);
CREATE INDEX staff_request_staff_idx ON staff_request (staff_id, created_at DESC);
-- One open question per shift: a shift is offered in at most one pending swap.
CREATE UNIQUE INDEX staff_request_one_pending_swap ON staff_request (offered_shift_id) WHERE status = 'pending';

CREATE FUNCTION lw_staff_request_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.synthetic THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'staff requests are append-only (DELETE refused)' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'a new staff request must be pending (got %)', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the decision (status and its stamps) changes, and only out of `pending`.
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'staff request is already % and cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.staff_id, NEW.store_id, NEW.request_type, NEW.date_from, NEW.date_to, NEW.offered_shift_id, NEW.target_shift_id,
      NEW.target_staff_id, NEW.time_off_reason, NEW.note, NEW.synthetic, NEW.created_at)
     IS DISTINCT FROM
     (OLD.staff_id, OLD.store_id, OLD.request_type, OLD.date_from, OLD.date_to, OLD.offered_shift_id, OLD.target_shift_id,
      OLD.target_staff_id, OLD.time_off_reason, OLD.note, OLD.synthetic, OLD.created_at) THEN
    RAISE EXCEPTION 'staff request details are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_request_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON staff_request
  FOR EACH ROW EXECUTE FUNCTION lw_staff_request_lifecycle();

-- ShiftOverride: approved swaps and time off --------------------------------
ALTER TABLE shift_override DROP CONSTRAINT shift_override_override_type_check;
ALTER TABLE shift_override
  ADD CONSTRAINT shift_override_override_type_check CHECK (
    override_type IN ('emergency_off', 'reassign', 'time_change', 'add', 'remove', 'offer_fill', 'borrow_fill', 'swap', 'time_off')
  ),
  -- P19: a request-driven change exists only for (and is tied to) its request.
  ADD CONSTRAINT shift_override_request_type CHECK ((override_type IN ('swap', 'time_off')) = (staff_request_id IS NOT NULL)),
  ADD CONSTRAINT shift_override_swap_staff CHECK (
    override_type <> 'swap' OR (from_staff_id IS DISTINCT FROM to_staff_id AND (from_staff_id IS NOT NULL OR to_staff_id IS NOT NULL))
  ),
  ADD CONSTRAINT shift_override_time_off_staff CHECK (override_type <> 'time_off' OR (from_staff_id IS NOT NULL AND to_staff_id IS NULL));

-- Only an approved request applies a change (P19).
CREATE FUNCTION lw_shift_override_request_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF NEW.staff_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO s FROM staff_request WHERE id = NEW.staff_request_id;
  IF s IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'a staff request changes the roster only once approved (request is %)', coalesce(s, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shift_override_request_approved BEFORE INSERT ON shift_override
  FOR EACH ROW EXECUTE FUNCTION lw_shift_override_request_approved();

CREATE FUNCTION lw_staff_availability_request_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF NEW.staff_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO s FROM staff_request WHERE id = NEW.staff_request_id;
  IF s IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'time off applies only once the request is approved (request is %)', coalesce(s, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_availability_request_approved BEFORE INSERT ON staff_availability
  FOR EACH ROW EXECUTE FUNCTION lw_staff_availability_request_approved();
