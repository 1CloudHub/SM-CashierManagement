-- LaneWise schema 0140 — background planning jobs (task 14.2; Req 10.1,
-- 10.2; NFR-REL-001/002; P6, P18).
--
-- Hiring plans and rosters longer than four weeks run as jobs on the SQS
-- worker. A job is a `scenario_run` (run_type 'hiring' or 'roster') that pins
-- exactly the scenario's snapshots and rule versions when it is requested
-- (P6), so its result is reproducible and cached per scenario version via
-- `idempotency_key`.

-- Job parameters (settings at request time, roster period) and progress in
-- work units (departments): "14 of 24 departments".
ALTER TABLE scenario_run
  ADD COLUMN params      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
  ADD COLUMN units_done  integer NOT NULL DEFAULT 0 CHECK (units_done >= 0),
  ADD COLUMN units_total integer NOT NULL DEFAULT 0 CHECK (units_total >= 0),
  ADD CONSTRAINT scenario_run_units_within_total CHECK (units_total = 0 OR units_done <= units_total);

CREATE INDEX scenario_run_type_idx ON scenario_run (scenario_id, run_type, created_at DESC);

-- Resumable jobs: each finished work unit is checkpointed, so a redelivered
-- message (worker timeout, crash) resumes after the last unit instead of
-- starting over, and a duplicate delivery never redoes or double-counts a
-- unit (primary key). Checkpoints share the run's provenance (P18) and never
-- change once written.
CREATE TABLE scenario_run_checkpoint (
  run_id     uuid NOT NULL,
  unit_key   text NOT NULL CHECK (length(unit_key) > 0),
  synthetic  boolean NOT NULL,
  result     jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, unit_key),
  CONSTRAINT scenario_run_checkpoint_run_fk FOREIGN KEY (run_id, synthetic)
    REFERENCES scenario_run (id, synthetic) ON DELETE CASCADE
);

CREATE FUNCTION lw_scenario_run_checkpoint_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scenario run checkpoints are immutable' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER scenario_run_checkpoint_immutable BEFORE UPDATE ON scenario_run_checkpoint
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_run_checkpoint_immutable();
