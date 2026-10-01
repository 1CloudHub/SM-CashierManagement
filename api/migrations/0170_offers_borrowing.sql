-- ---------------------------------------------------------------------------
-- LaneWise schema 0170 — shift offers and store-to-store borrowing (task 17;
-- Req 13, 14; Q23–Q25; P7, P14, P16, P17).
--
-- `shift_offer`, `transfer_request` and `transfer_request_staff` come from
-- 0004 (with the P17 partial unique index `shift_offer_one_accepted`). This
-- migration adds what the offer and borrowing APIs record and the
-- database-level guarantees behind them:
--
--   * P17 single acceptance: besides "at most one accepted offer per shift",
--     accepting an offer withdraws every other still-sent offer for the
--     shift in the same statement (trigger), so no offer for a filled shift
--     is ever left open; a new offer for a filled shift is refused; an offer
--     leaves `sent` exactly once and final statuses never change; a cashier
--     holds at most one live offer per shift.
--   * Offers carry their terms: pay (₱, the cashier's own pay for the shift)
--     and the travel mode; an index serves the expiry sweep.
--   * Borrow requests name the receiving store's open shifts, the store-to-
--     store travel time, a note and a decline reason; each lent cashier is
--     tied to the shift they fill. A decided request never changes again.
--   * ShiftOverride gains the two task 17 fills of an open shift
--     (`offer_fill`, `borrow_fill`), linked to the offer / borrow request,
--     so every roster change stays traceable (P14).
-- ---------------------------------------------------------------------------

-- ShiftOverride: offer and borrow fills ------------------------------------
ALTER TABLE shift_override DROP CONSTRAINT shift_override_override_type_check;
ALTER TABLE shift_override
  ADD CONSTRAINT shift_override_override_type_check CHECK (
    override_type IN ('emergency_off', 'reassign', 'time_change', 'add', 'remove', 'offer_fill', 'borrow_fill')
  ),
  ADD COLUMN shift_offer_id uuid REFERENCES shift_offer (id),
  ADD COLUMN transfer_request_id uuid REFERENCES transfer_request (id),
  ADD CONSTRAINT shift_override_offer_fill CHECK (
    override_type <> 'offer_fill' OR (shift_offer_id IS NOT NULL AND to_staff_id IS NOT NULL AND from_staff_id IS NULL)
  ),
  ADD CONSTRAINT shift_override_borrow_fill CHECK (
    override_type <> 'borrow_fill' OR (transfer_request_id IS NOT NULL AND to_staff_id IS NOT NULL AND from_staff_id IS NULL)
  );

-- ShiftOffer: terms, one live offer per cashier and shift, lifecycle --------
ALTER TABLE shift_offer
  ADD COLUMN pay_php numeric(10, 2) NOT NULL DEFAULT 0 CHECK (pay_php >= 0),
  ADD COLUMN travel_mode text NOT NULL DEFAULT 'public_transport' CHECK (travel_mode IN ('public_transport', 'car'));

CREATE UNIQUE INDEX shift_offer_one_live ON shift_offer (shift_id, staff_id) WHERE status = 'sent';
CREATE INDEX shift_offer_sent_expiry_idx ON shift_offer (expires_at) WHERE status = 'sent';
CREATE INDEX shift_offer_shift_idx ON shift_offer (shift_id, sent_at);

CREATE FUNCTION lw_shift_offer_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'sent' THEN
      RAISE EXCEPTION 'a new shift offer must be sent (got %)', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM shift_offer WHERE shift_id = NEW.shift_id AND status = 'accepted') THEN
      RAISE EXCEPTION 'the shift is already filled by an accepted offer' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the status (with its stamp) changes, and only out of `sent`.
  IF (NEW.shift_id, NEW.staff_id, NEW.sent_by, NEW.sent_at, NEW.expires_at, NEW.travel_min, NEW.allowance_php, NEW.pay_php,
      NEW.travel_mode, NEW.synthetic)
     IS DISTINCT FROM
     (OLD.shift_id, OLD.staff_id, OLD.sent_by, OLD.sent_at, OLD.expires_at, OLD.travel_min, OLD.allowance_php, OLD.pay_php,
      OLD.travel_mode, OLD.synthetic) THEN
    RAISE EXCEPTION 'shift offer terms are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'sent' THEN
    RAISE EXCEPTION 'shift offer is already % and cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shift_offer_lifecycle BEFORE INSERT OR UPDATE ON shift_offer
  FOR EACH ROW EXECUTE FUNCTION lw_shift_offer_lifecycle();

-- P17: the moment an offer is accepted, every other sent offer for the shift is withdrawn.
CREATE FUNCTION lw_shift_offer_accept_closes_others() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shift_offer
     SET status = 'withdrawn', responded_at = NEW.responded_at
   WHERE shift_id = NEW.shift_id AND status = 'sent' AND id <> NEW.id;
  RETURN NULL;
END
$$;
CREATE TRIGGER shift_offer_accept_closes_others AFTER UPDATE OF status ON shift_offer
  FOR EACH ROW WHEN (NEW.status = 'accepted' AND OLD.status = 'sent')
  EXECUTE FUNCTION lw_shift_offer_accept_closes_others();

-- TransferRequest: shifts to fill, travel, note, decline reason -------------
ALTER TABLE transfer_request
  ADD COLUMN shift_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN travel_min numeric(6, 1) CHECK (travel_min >= 0),
  ADD COLUMN note text CHECK (note IS NULL OR length(note) <= 500),
  ADD COLUMN decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  ADD CONSTRAINT transfer_request_shift_count CHECK (cardinality(shift_ids) = 0 OR cardinality(shift_ids) = requested_count),
  ADD CONSTRAINT transfer_request_override_reason_length CHECK (override_reason IS NULL OR length(override_reason) <= 500);
CREATE INDEX transfer_request_from_idx ON transfer_request (from_store_id, created_at DESC);
CREATE INDEX transfer_request_to_idx ON transfer_request (to_store_id, created_at DESC);

ALTER TABLE transfer_request_staff ADD COLUMN shift_id uuid REFERENCES shift (id);
CREATE UNIQUE INDEX transfer_request_staff_one_shift ON transfer_request_staff (transfer_request_id, shift_id);

CREATE FUNCTION lw_transfer_request_decided_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'borrow request is already % and cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.from_store_id, NEW.to_store_id, NEW.department_id, NEW.window_start, NEW.window_end, NEW.requested_count,
      NEW.requested_by, NEW.shift_ids, NEW.synthetic, NEW.created_at)
     IS DISTINCT FROM
     (OLD.from_store_id, OLD.to_store_id, OLD.department_id, OLD.window_start, OLD.window_end, OLD.requested_count,
      OLD.requested_by, OLD.shift_ids, OLD.synthetic, OLD.created_at) THEN
    RAISE EXCEPTION 'borrow request details are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER transfer_request_decided_once BEFORE UPDATE ON transfer_request
  FOR EACH ROW EXECUTE FUNCTION lw_transfer_request_decided_once();
