-- LaneWise schema 0003 — scenarios, input pins, runs and approval steps
-- (Req 8, 9; P3, P4, P5, P6, P10, P18).

CREATE TABLE scenario (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Planning season key, e.g. 'christmas-2026'.
  season                text NOT NULL CHECK (season ~ '^[a-z0-9][a-z0-9-]*$'),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'submitted', 'approved', 'published', 'superseded', 'archived'
  )),
  stale                 boolean NOT NULL DEFAULT false,
  stale_reason          text,
  owner_id              uuid NOT NULL REFERENCES app_user (id),
  -- All prototype v3 inputs (service target, shrinkage, horizon, ...).
  settings              jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  settings_changed_at   timestamptz NOT NULL DEFAULT now(),
  last_run_at           timestamptz,
  parent_scenario_id    uuid REFERENCES scenario (id),
  current_submission_no integer NOT NULL DEFAULT 0 CHECK (current_submission_no >= 0),
  published_at          timestamptz,
  synthetic             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scenario_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT scenario_stale_reason CHECK (NOT stale OR stale_reason IS NOT NULL),
  CONSTRAINT scenario_published_stamp CHECK (
    status NOT IN ('published', 'superseded') OR published_at IS NOT NULL
  )
);
-- P3: at most one Published scenario per season (per provenance, so seeded
-- demo plans never block or replace real ones — P18).
CREATE UNIQUE INDEX scenario_one_published_per_season
  ON scenario (season, synthetic) WHERE status = 'published';
CREATE INDEX scenario_owner_idx ON scenario (owner_id);
CREATE TRIGGER scenario_updated_at BEFORE UPDATE ON scenario
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- Lifecycle guard, mirroring SCENARIO_TRANSITIONS in @lanewise/shared, plus
-- P4 (settings read-only unless Draft) and P5 (a stale scenario cannot be
-- submitted).
CREATE FUNCTION lw_scenario_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'      AND NEW.status IN ('submitted', 'archived'))
    OR (OLD.status = 'submitted'  AND NEW.status IN ('draft', 'approved'))
    OR (OLD.status = 'approved'   AND NEW.status IN ('published', 'draft'))
    OR (OLD.status = 'published'  AND NEW.status = 'superseded')
    OR (OLD.status = 'superseded' AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'scenario % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'draft'
     AND (NEW.settings IS DISTINCT FROM OLD.settings
          OR NEW.season IS DISTINCT FROM OLD.season
          OR NEW.synthetic IS DISTINCT FROM OLD.synthetic) THEN
    RAISE EXCEPTION 'scenario % is % and its settings are read-only', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'submitted' AND NEW.stale THEN
    RAISE EXCEPTION 'scenario % is stale and cannot be submitted', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.settings IS DISTINCT FROM OLD.settings THEN
    NEW.settings_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scenario_guard BEFORE UPDATE ON scenario
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_guard();

-- Scenario input pins: one snapshot per dataset type and one version per rule
-- set (Req 8.1, 4.3). Composite FKs keep inputs the same provenance as the
-- scenario (P18).
CREATE TABLE scenario_snapshot (
  scenario_id  uuid NOT NULL,
  dataset_type text NOT NULL,
  snapshot_id  uuid NOT NULL,
  synthetic    boolean NOT NULL,
  PRIMARY KEY (scenario_id, dataset_type),
  CONSTRAINT scenario_snapshot_scenario_fk FOREIGN KEY (scenario_id, synthetic)
    REFERENCES scenario (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT scenario_snapshot_snapshot_fk FOREIGN KEY (snapshot_id, dataset_type, synthetic)
    REFERENCES dataset_snapshot (id, dataset_type, synthetic)
);

CREATE TABLE scenario_rule_version (
  scenario_id     uuid NOT NULL,
  rule_set_id     uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  synthetic       boolean NOT NULL,
  PRIMARY KEY (scenario_id, rule_set_id),
  CONSTRAINT scenario_rule_version_scenario_fk FOREIGN KEY (scenario_id, synthetic)
    REFERENCES scenario (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT scenario_rule_version_version_fk FOREIGN KEY (rule_version_id, rule_set_id, synthetic)
    REFERENCES rule_version (id, rule_set_id, synthetic)
);

-- Pins of a non-Draft scenario are read-only too (P4).
CREATE FUNCTION lw_scenario_pins_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  SELECT status INTO s FROM scenario
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.scenario_id ELSE NEW.scenario_id END;
  -- s is null when the scenario itself is being deleted (cascade).
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'scenario inputs are read-only while %', s
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER scenario_snapshot_frozen BEFORE INSERT OR UPDATE OR DELETE ON scenario_snapshot
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_pins_frozen();
CREATE TRIGGER scenario_rule_version_frozen BEFORE INSERT OR UPDATE OR DELETE ON scenario_rule_version
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_pins_frozen();

-- ---------------------------------------------------------------------------
-- ScenarioRun. Each run records the exact snapshots and rule versions it used
-- (P6) in the *_input tables below; results live in S3 (results_ref).
-- ---------------------------------------------------------------------------
CREATE TABLE scenario_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid NOT NULL,
  run_type        text NOT NULL CHECK (run_type IN ('network', 'department', 'roster', 'hiring')),
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress        numeric(5, 4) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  results_ref     text,
  error_message   text,
  -- Idempotent job submission (task 14.2).
  idempotency_key text UNIQUE,
  requested_by    uuid NOT NULL REFERENCES app_user (id),
  synthetic       boolean NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  CONSTRAINT scenario_run_id_synthetic_key UNIQUE (id, synthetic),
  CONSTRAINT scenario_run_scenario_fk FOREIGN KEY (scenario_id, synthetic)
    REFERENCES scenario (id, synthetic),
  CONSTRAINT scenario_run_succeeded_has_results CHECK (status <> 'succeeded' OR results_ref IS NOT NULL),
  CONSTRAINT scenario_run_failed_has_reason CHECK (status <> 'failed' OR error_message IS NOT NULL)
);
CREATE INDEX scenario_run_scenario_idx ON scenario_run (scenario_id, created_at DESC);

CREATE TABLE scenario_run_snapshot (
  run_id       uuid NOT NULL,
  dataset_type text NOT NULL,
  snapshot_id  uuid NOT NULL,
  synthetic    boolean NOT NULL,
  PRIMARY KEY (run_id, dataset_type),
  CONSTRAINT scenario_run_snapshot_run_fk FOREIGN KEY (run_id, synthetic)
    REFERENCES scenario_run (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT scenario_run_snapshot_snapshot_fk FOREIGN KEY (snapshot_id, dataset_type, synthetic)
    REFERENCES dataset_snapshot (id, dataset_type, synthetic)
);

CREATE TABLE scenario_run_rule_version (
  run_id          uuid NOT NULL,
  rule_set_id     uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  synthetic       boolean NOT NULL,
  PRIMARY KEY (run_id, rule_set_id),
  CONSTRAINT scenario_run_rule_version_run_fk FOREIGN KEY (run_id, synthetic)
    REFERENCES scenario_run (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT scenario_run_rule_version_version_fk FOREIGN KEY (rule_version_id, rule_set_id, synthetic)
    REFERENCES rule_version (id, rule_set_id, synthetic)
);

-- ---------------------------------------------------------------------------
-- ApprovalStep (Req 9; Q3, Q19; P10).
-- ---------------------------------------------------------------------------
CREATE TABLE approval_step (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id      uuid NOT NULL REFERENCES scenario (id),
  submission_no    integer NOT NULL CHECK (submission_no > 0),
  step             text NOT NULL CHECK (step IN ('headcount', 'budget', 'plan')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'changes_requested', 'rejected', 'secured_outside'
  )),
  decided_by       uuid REFERENCES app_user (id),
  decided_as_role  text CHECK (decided_as_role IN ('ADM','EXE','PLN','STM','HR','FIN','RST','STF')),
  decided_at       timestamptz,
  comment          text,
  -- Off-system record (Executive only): reference + note, visible to HR/FIN.
  outside_reference text,
  outside_note      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_step_key UNIQUE (scenario_id, submission_no, step),
  CONSTRAINT approval_step_decision_stamp CHECK (
    (status = 'pending') = (decided_by IS NULL AND decided_as_role IS NULL AND decided_at IS NULL)
  ),
  -- Each in-system decision is made by that step's approver role (Q3).
  CONSTRAINT approval_step_approver_role CHECK (
    status NOT IN ('approved', 'changes_requested', 'rejected')
    OR decided_as_role = CASE step WHEN 'headcount' THEN 'HR' WHEN 'budget' THEN 'FIN' ELSE 'EXE' END
  ),
  -- Only the Executive rejects the plan; others request changes (Req 9.6).
  CONSTRAINT approval_step_reject_plan_only CHECK (status <> 'rejected' OR step = 'plan'),
  CONSTRAINT approval_step_comment_required CHECK (
    status NOT IN ('changes_requested', 'rejected') OR length(btrim(coalesce(comment, ''))) > 0
  ),
  -- Only the Executive records headcount/budget as secured outside (Q19).
  CONSTRAINT approval_step_secured_outside CHECK (
    status <> 'secured_outside' OR (
      step IN ('headcount', 'budget')
      AND decided_as_role = 'EXE'
      AND length(btrim(coalesce(outside_reference, ''))) > 0
    )
  )
);

-- P10: the plan step is approved only when headcount and budget of the same
-- submission are each approved or secured outside the system.
CREATE FUNCTION lw_approval_plan_sequencing() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  secured integer;
BEGIN
  IF NEW.step = 'plan' AND NEW.status = 'approved' THEN
    SELECT count(*) INTO secured FROM approval_step
     WHERE scenario_id = NEW.scenario_id
       AND submission_no = NEW.submission_no
       AND step IN ('headcount', 'budget')
       AND status IN ('approved', 'secured_outside');
    IF secured < 2 THEN
      RAISE EXCEPTION 'plan approval requires headcount and budget to be secured'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER approval_step_plan_sequencing BEFORE INSERT OR UPDATE ON approval_step
  FOR EACH ROW EXECUTE FUNCTION lw_approval_plan_sequencing();
