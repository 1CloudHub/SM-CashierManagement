-- LaneWise schema 0004 — staff and availability, rosters and overrides, staff
-- requests, home areas and travel times, shift offers and store-to-store
-- transfers (Req 6, 7, 11–15; P11, P14, P15, P17, P18, P19).

-- ---------------------------------------------------------------------------
-- Staff / Availability
-- ---------------------------------------------------------------------------
CREATE TABLE staff (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           uuid NOT NULL,
  department_id      uuid NOT NULL,
  employee_no        text NOT NULL,
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Work email links a Staff user (Q16); demo cashiers use demo.local.
  email              text CHECK (email IS NULL OR email = lower(email)),
  user_id            uuid UNIQUE REFERENCES app_user (id),
  employment_type    text NOT NULL CHECK (employment_type IN ('regular', 'seasonal', 'part_time')),
  preferred_rest_day smallint CHECK (preferred_rest_day BETWEEN 0 AND 6), -- 0 = Sunday
  -- Recurring weekly availability pattern (v3 inputs).
  weekly_pattern     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(weekly_pattern) = 'object'),
  active             boolean NOT NULL DEFAULT true,
  synthetic          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_employee_no_key UNIQUE (store_id, employee_no),
  CONSTRAINT staff_email_key UNIQUE (email),
  CONSTRAINT staff_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT staff_store_fk FOREIGN KEY (store_id, synthetic) REFERENCES store (id, synthetic),
  -- Home department belongs to the home store.
  CONSTRAINT staff_department_fk FOREIGN KEY (department_id, store_id)
    REFERENCES department (id, store_id)
);
CREATE INDEX staff_store_idx ON staff (store_id);
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- Departments a cashier is trained on (offer eligibility, P16).
CREATE TABLE staff_training (
  staff_id      uuid NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES department (id),
  trained_at    date,
  PRIMARY KEY (staff_id, department_id)
);

-- Availability exceptions on top of the weekly pattern.
CREATE TABLE staff_availability (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('unavailable', 'available')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  reason           text,
  source           text NOT NULL CHECK (source IN ('manual', 'staff_request', 'import')),
  staff_request_id uuid,
  created_by       uuid REFERENCES app_user (id),
  synthetic        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_range CHECK (ends_at > starts_at),
  CONSTRAINT staff_availability_staff_fk FOREIGN KEY (staff_id, synthetic)
    REFERENCES staff (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT staff_availability_request CHECK ((source = 'staff_request') = (staff_request_id IS NOT NULL))
);
CREATE INDEX staff_availability_staff_idx ON staff_availability (staff_id, starts_at);

-- ---------------------------------------------------------------------------
-- Roster and Shift (supporting tables: ShiftOverride, ShiftOffer and
-- StaffRequest reference shifts on a roster).
-- ---------------------------------------------------------------------------
CREATE TABLE roster (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid,
  scenario_run_id uuid,
  store_id        uuid NOT NULL,
  department_id   uuid NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  published_at    timestamptz,
  synthetic       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_period CHECK (period_end >= period_start),
  CONSTRAINT roster_published_stamp CHECK (status = 'draft' OR published_at IS NOT NULL),
  CONSTRAINT roster_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT roster_store_fk FOREIGN KEY (store_id, synthetic) REFERENCES store (id, synthetic),
  CONSTRAINT roster_department_fk FOREIGN KEY (department_id, store_id) REFERENCES department (id, store_id),
  CONSTRAINT roster_scenario_fk FOREIGN KEY (scenario_id, synthetic) REFERENCES scenario (id, synthetic),
  CONSTRAINT roster_run_fk FOREIGN KEY (scenario_run_id, synthetic) REFERENCES scenario_run (id, synthetic)
);
CREATE UNIQUE INDEX roster_one_published
  ON roster (department_id, period_start, synthetic) WHERE status = 'published';

CREATE TABLE shift (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id     uuid NOT NULL,
  -- Null = open (unfilled) shift. May be a borrowed cashier from another store.
  staff_id      uuid,
  department_id uuid NOT NULL REFERENCES department (id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  -- Activity segments (lanes, breaks, ...) within the shift.
  activities    jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(activities) = 'array'),
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  synthetic     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_range CHECK (ends_at > starts_at),
  CONSTRAINT shift_roster_key UNIQUE (id, roster_id),
  CONSTRAINT shift_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT shift_roster_fk FOREIGN KEY (roster_id, synthetic)
    REFERENCES roster (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT shift_staff_fk FOREIGN KEY (staff_id, synthetic) REFERENCES staff (id, synthetic)
);
CREATE INDEX shift_roster_idx ON shift (roster_id, starts_at);
CREATE INDEX shift_staff_idx ON shift (staff_id, starts_at) WHERE staff_id IS NOT NULL;
CREATE TRIGGER shift_updated_at BEFORE UPDATE ON shift
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- ShiftOverride: store-manager change to a published roster (Req 7, P14).
CREATE TABLE shift_override (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id      uuid NOT NULL,
  shift_id       uuid NOT NULL,
  override_type  text NOT NULL CHECK (override_type IN ('emergency_off', 'reassign', 'time_change', 'add', 'remove')),
  from_staff_id  uuid REFERENCES staff (id),
  to_staff_id    uuid REFERENCES staff (id),
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  -- Labor-rule breaches this change causes; each needs a reason (Q17).
  rule_breaches  jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rule_breaches) = 'array'),
  staff_request_id uuid,
  created_by     uuid NOT NULL REFERENCES app_user (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  synthetic      boolean NOT NULL DEFAULT false,
  CONSTRAINT shift_override_shift_fk FOREIGN KEY (shift_id, roster_id) REFERENCES shift (id, roster_id),
  CONSTRAINT shift_override_roster_fk FOREIGN KEY (roster_id, synthetic) REFERENCES roster (id, synthetic),
  CONSTRAINT shift_override_breach_reason CHECK (
    jsonb_array_length(rule_breaches) = 0 OR length(btrim(coalesce(reason, ''))) > 0
  ),
  CONSTRAINT shift_override_reassign_staff CHECK (
    override_type <> 'reassign' OR (from_staff_id IS NOT NULL AND to_staff_id IS NOT NULL AND from_staff_id <> to_staff_id)
  ),
  CONSTRAINT shift_override_emergency_off_staff CHECK (override_type <> 'emergency_off' OR from_staff_id IS NOT NULL)
);
CREATE INDEX shift_override_roster_idx ON shift_override (roster_id, created_at);

-- Overrides may only be recorded against a published roster (Req 7.1).
CREATE FUNCTION lw_shift_override_published_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  SELECT status INTO s FROM roster WHERE id = NEW.roster_id;
  IF s IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'shift overrides apply only to a published roster (roster is %)', coalesce(s, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shift_override_published_only BEFORE INSERT ON shift_override
  FOR EACH ROW EXECUTE FUNCTION lw_shift_override_published_only();

-- StaffRequest: time-off / swap self-service (Q18, P19).
CREATE TABLE staff_request (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         uuid NOT NULL,
  request_type     text NOT NULL CHECK (request_type IN ('time_off', 'swap')),
  date_from        date,
  date_to          date,
  offered_shift_id uuid REFERENCES shift (id),
  target_shift_id  uuid REFERENCES shift (id),
  note             text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by       uuid REFERENCES app_user (id),
  decided_at       timestamptz,
  decision_note    text,
  synthetic        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_request_staff_fk FOREIGN KEY (staff_id, synthetic) REFERENCES staff (id, synthetic),
  CONSTRAINT staff_request_time_off_range CHECK (
    request_type <> 'time_off' OR (date_from IS NOT NULL AND date_to IS NOT NULL AND date_to >= date_from)
  ),
  CONSTRAINT staff_request_swap_shifts CHECK (
    request_type <> 'swap' OR (offered_shift_id IS NOT NULL AND target_shift_id IS NOT NULL
                               AND offered_shift_id <> target_shift_id)
  ),
  CONSTRAINT staff_request_decision_stamp CHECK (
    status NOT IN ('approved', 'declined') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);
CREATE INDEX staff_request_pending_idx ON staff_request (staff_id) WHERE status = 'pending';

ALTER TABLE staff_availability
  ADD CONSTRAINT staff_availability_request_fk FOREIGN KEY (staff_request_id) REFERENCES staff_request (id);
ALTER TABLE shift_override
  ADD CONSTRAINT shift_override_request_fk FOREIGN KEY (staff_request_id) REFERENCES staff_request (id);

-- ---------------------------------------------------------------------------
-- StaffHomeArea (Req 12, P15). Barangay-level only: the row references the
-- barangay reference list and has no address/coordinate columns of its own.
-- A row exists only with opt-in consent; withdrawing consent deletes it.
-- ---------------------------------------------------------------------------
CREATE TABLE staff_home_area (
  staff_id           uuid PRIMARY KEY,
  barangay_code      text NOT NULL REFERENCES barangay (psgc_code),
  consent_at         timestamptz NOT NULL,
  max_travel_min     integer NOT NULL CHECK (max_travel_min BETWEEN 5 AND 180),
  cross_store_offers boolean NOT NULL DEFAULT false,
  synthetic          boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_home_area_staff_fk FOREIGN KEY (staff_id, synthetic)
    REFERENCES staff (id, synthetic) ON DELETE CASCADE
);
CREATE INDEX staff_home_area_barangay_idx ON staff_home_area (barangay_code);
CREATE TRIGGER staff_home_area_updated_at BEFORE UPDATE ON staff_home_area
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- TravelTime: precomputed barangay → store matrix (Q22). Keyed by barangay,
-- never by person.
CREATE TABLE travel_time (
  barangay_code text NOT NULL REFERENCES barangay (psgc_code),
  store_id      uuid NOT NULL REFERENCES store (id) ON DELETE CASCADE,
  mode          text NOT NULL CHECK (mode IN ('public_transport', 'car')),
  time_window   text NOT NULL CHECK (time_window ~ '^[a-z0-9_]+$'),
  minutes       numeric(6, 1) NOT NULL CHECK (minutes >= 0),
  source        text NOT NULL CHECK (source IN ('amazon_location', 'speed_factor_estimate', 'straight_line')),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (barangay_code, store_id, mode, time_window)
);

-- ---------------------------------------------------------------------------
-- ShiftOffer (Req 13; Q25; P17).
-- ---------------------------------------------------------------------------
CREATE TABLE shift_offer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid NOT NULL,
  staff_id      uuid NOT NULL,
  sent_by       uuid NOT NULL REFERENCES app_user (id),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'accepted', 'declined', 'expired', 'withdrawn')),
  responded_at  timestamptz,
  travel_min    numeric(6, 1) CHECK (travel_min >= 0),
  allowance_php numeric(10, 2) NOT NULL DEFAULT 0 CHECK (allowance_php >= 0),
  synthetic     boolean NOT NULL DEFAULT false,
  CONSTRAINT shift_offer_expiry CHECK (expires_at > sent_at),
  CONSTRAINT shift_offer_response_stamp CHECK (status NOT IN ('accepted', 'declined') OR responded_at IS NOT NULL),
  CONSTRAINT shift_offer_shift_fk FOREIGN KEY (shift_id, synthetic) REFERENCES shift (id, synthetic),
  CONSTRAINT shift_offer_staff_fk FOREIGN KEY (staff_id, synthetic) REFERENCES staff (id, synthetic)
);
-- P17: at most one accepted offer per shift.
CREATE UNIQUE INDEX shift_offer_one_accepted ON shift_offer (shift_id) WHERE status = 'accepted';
CREATE INDEX shift_offer_staff_idx ON shift_offer (staff_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- TransferRequest: store-to-store borrowing (Req 14; Q24).
-- ---------------------------------------------------------------------------
CREATE TABLE transfer_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_store_id   uuid NOT NULL,
  to_store_id     uuid NOT NULL,
  department_id   uuid REFERENCES department (id),
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  requested_count integer NOT NULL CHECK (requested_count > 0),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined', 'overridden', 'cancelled')),
  requested_by    uuid NOT NULL REFERENCES app_user (id),
  decided_by      uuid REFERENCES app_user (id),
  decided_at      timestamptz,
  -- Planner override of the lending manager, with a recorded reason (Q24).
  override_reason text,
  synthetic       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_request_distinct_stores CHECK (from_store_id <> to_store_id),
  CONSTRAINT transfer_request_window CHECK (window_end > window_start),
  CONSTRAINT transfer_request_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT transfer_request_from_fk FOREIGN KEY (from_store_id, synthetic) REFERENCES store (id, synthetic),
  CONSTRAINT transfer_request_to_fk FOREIGN KEY (to_store_id, synthetic) REFERENCES store (id, synthetic),
  CONSTRAINT transfer_request_decision_stamp CHECK (
    status NOT IN ('approved', 'declined', 'overridden') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT transfer_request_override_reason CHECK (
    status <> 'overridden' OR length(btrim(coalesce(override_reason, ''))) > 0
  )
);

CREATE TABLE transfer_request_staff (
  transfer_request_id uuid NOT NULL,
  staff_id            uuid NOT NULL,
  synthetic           boolean NOT NULL,
  PRIMARY KEY (transfer_request_id, staff_id),
  CONSTRAINT transfer_request_staff_request_fk FOREIGN KEY (transfer_request_id, synthetic)
    REFERENCES transfer_request (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT transfer_request_staff_staff_fk FOREIGN KEY (staff_id, synthetic)
    REFERENCES staff (id, synthetic)
);
