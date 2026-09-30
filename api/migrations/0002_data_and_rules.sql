-- LaneWise schema 0002 — datasets/snapshots, ingestion runs, rule sets/versions
-- (Req 16, 17; P6, P9, P18).

-- ---------------------------------------------------------------------------
-- Dataset / Snapshot. A "dataset" is the logical series per dataset_type; each
-- successful load adds an immutable snapshot and supersedes the previous
-- current one of the same type and provenance. Scenarios pin snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE dataset_snapshot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_type   text NOT NULL CHECK (dataset_type IN ('pos', 'master', 'staff')),
  covers_from    date NOT NULL,
  covers_to      date NOT NULL,
  row_count      integer NOT NULL CHECK (row_count >= 0),
  -- S3 key of the normalised snapshot data (task 9).
  storage_key    text,
  synthetic      boolean NOT NULL DEFAULT false,
  loaded_at      timestamptz NOT NULL DEFAULT now(),
  loaded_by      uuid REFERENCES app_user (id),
  superseded_at  timestamptz,
  -- Deferrable so a load can supersede the current snapshot and insert its
  -- successor in one transaction.
  superseded_by  uuid REFERENCES dataset_snapshot (id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT dataset_snapshot_covers CHECK (covers_to >= covers_from),
  CONSTRAINT dataset_snapshot_superseded_pair CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  CONSTRAINT dataset_snapshot_pin_key UNIQUE (id, dataset_type, synthetic)
);
-- At most one current snapshot per dataset type and provenance.
CREATE UNIQUE INDEX dataset_snapshot_one_current
  ON dataset_snapshot (dataset_type, synthetic) WHERE superseded_at IS NULL;

-- Snapshot contents never change once loaded (P6: results stay reproducible).
-- Only the supersession columns — and clearing the synthetic flag, which is
-- Rules-Steward-only in the API (Req 17.6) — may be updated.
CREATE FUNCTION lw_dataset_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dataset_type IS DISTINCT FROM OLD.dataset_type
     OR NEW.covers_from IS DISTINCT FROM OLD.covers_from
     OR NEW.covers_to IS DISTINCT FROM OLD.covers_to
     OR NEW.row_count IS DISTINCT FROM OLD.row_count
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.loaded_at IS DISTINCT FROM OLD.loaded_at
     OR NEW.loaded_by IS DISTINCT FROM OLD.loaded_by THEN
    RAISE EXCEPTION 'dataset snapshot % is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER dataset_snapshot_immutable BEFORE UPDATE ON dataset_snapshot
  FOR EACH ROW EXECUTE FUNCTION lw_dataset_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- IngestionRun: history of every upload (Req 17.5).
-- ---------------------------------------------------------------------------
CREATE TABLE ingestion_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_type   text NOT NULL CHECK (dataset_type IN ('pos', 'master', 'staff')),
  user_id        uuid NOT NULL REFERENCES app_user (id),
  file_name      text NOT NULL,
  file_key       text,
  file_sha256    text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count      integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  warning_count  integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_count    integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  -- Row-numbered warnings/errors for the downloadable report (Req 17.2).
  issues         jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  status         text NOT NULL DEFAULT 'validating'
                 CHECK (status IN ('validating', 'validated', 'blocked', 'loaded', 'failed', 'cancelled')),
  snapshot_id    uuid REFERENCES dataset_snapshot (id),
  synthetic      boolean NOT NULL DEFAULT false,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  -- A load with errors is blocked and keeps the prior dataset (Req 17.3).
  CONSTRAINT ingestion_run_loaded_clean CHECK (
    status <> 'loaded' OR (error_count = 0 AND snapshot_id IS NOT NULL)
  ),
  CONSTRAINT ingestion_run_blocked_has_errors CHECK (status <> 'blocked' OR error_count > 0)
);
CREATE INDEX ingestion_run_started_idx ON ingestion_run (started_at DESC);

-- ---------------------------------------------------------------------------
-- RuleSet / RuleVersion (Req 16; P6). Cost rules (wages, premium and holiday
-- multipliers) need Finance approval before publishing (Q6).
-- ---------------------------------------------------------------------------
CREATE TABLE rule_set (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_type text NOT NULL UNIQUE CHECK (rule_set_type IN (
    'holidays', 'wages', 'premiums', 'lead_times', 'labor', 'service_levels', 'transport_allowance'
  )),
  name          text NOT NULL,
  is_cost_rule  boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_set_cost_key UNIQUE (id, is_cost_rule)
);

CREATE TABLE rule_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id         uuid NOT NULL,
  is_cost_rule        boolean NOT NULL,
  version             integer NOT NULL CHECK (version > 0),
  effective_from      date NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'submitted', 'changes_requested', 'approved', 'published', 'superseded'
  )),
  payload             jsonb NOT NULL,
  change_note         text NOT NULL DEFAULT '',
  created_by          uuid NOT NULL REFERENCES app_user (id),
  submitted_at        timestamptz,
  finance_approved_by uuid REFERENCES app_user (id),
  finance_approved_at timestamptz,
  published_by        uuid REFERENCES app_user (id),
  published_at        timestamptz,
  synthetic           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_version_set_fk FOREIGN KEY (rule_set_id, is_cost_rule)
    REFERENCES rule_set (id, is_cost_rule),
  CONSTRAINT rule_version_number_key UNIQUE (rule_set_id, version),
  CONSTRAINT rule_version_pin_key UNIQUE (id, rule_set_id, synthetic),
  -- Only cost rules go through Finance approval.
  CONSTRAINT rule_version_approved_is_cost CHECK (status <> 'approved' OR is_cost_rule),
  -- A cost rule is never published without a recorded Finance approval (Req 16.3).
  CONSTRAINT rule_version_cost_needs_finance CHECK (
    NOT is_cost_rule
    OR status NOT IN ('approved', 'published', 'superseded')
    OR (finance_approved_by IS NOT NULL AND finance_approved_at IS NOT NULL)
  ),
  CONSTRAINT rule_version_published_stamp CHECK (
    status NOT IN ('published', 'superseded')
    OR (published_by IS NOT NULL AND published_at IS NOT NULL)
  )
);
-- One published (in-force series head) version per rule set and provenance.
CREATE UNIQUE INDEX rule_version_one_published
  ON rule_version (rule_set_id, synthetic) WHERE status = 'published';
CREATE TRIGGER rule_version_updated_at BEFORE UPDATE ON rule_version
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- Content is editable only while draft/changes_requested; once submitted,
-- approved or published a version is frozen, so publishing never changes
-- existing results (Req 16.2, P6).
CREATE FUNCTION lw_rule_version_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'changes_requested')
     AND (NEW.payload IS DISTINCT FROM OLD.payload
          OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
          OR NEW.version IS DISTINCT FROM OLD.version
          OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
          OR NEW.change_note IS DISTINCT FROM OLD.change_note) THEN
    RAISE EXCEPTION 'rule version % is % and cannot be edited', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER rule_version_frozen BEFORE UPDATE ON rule_version
  FOR EACH ROW EXECUTE FUNCTION lw_rule_version_frozen();
