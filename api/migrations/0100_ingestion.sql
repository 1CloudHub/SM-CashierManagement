-- LaneWise schema 0100 — data ingestion workflow, snapshot content pinning and
-- the synthetic flag audit trail (task 9; Req 17, 18; P5, P9, P18).
--
-- An ingestion now runs in two steps: validate (the run is 'validated' or
-- 'blocked'), then load after review (the run becomes 'loaded' and supersedes
-- the current snapshot) or cancel. Migration range 0100-0109 is task 9's.

-- ---------------------------------------------------------------------------
-- IngestionRun: validation details kept for the report and the load step.
-- ---------------------------------------------------------------------------
ALTER TABLE ingestion_run
  ADD COLUMN valid_row_count    integer NOT NULL DEFAULT 0 CHECK (valid_row_count >= 0),
  ADD COLUMN covers_from        date,
  ADD COLUMN covers_to          date,
  -- Canonical field -> source header chosen in SCR-051 step 2.
  ADD COLUMN column_mapping     jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(column_mapping) = 'object'),
  ADD COLUMN file_size_bytes    bigint CHECK (file_size_bytes >= 0),
  -- Normalised records written at validation, pinned by the snapshot on load.
  ADD COLUMN normalized_key     text,
  ADD COLUMN normalized_sha256  text CHECK (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  -- The snapshot that was current when the file was validated. Loading is
  -- refused if another load superseded it since (the impact shown would be wrong).
  ADD COLUMN base_snapshot_id   uuid REFERENCES dataset_snapshot (id),
  ADD COLUMN stale_scenario_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN loaded_by          uuid REFERENCES app_user (id),
  ADD CONSTRAINT ingestion_run_covers CHECK (covers_to >= covers_from),
  -- Only a clean file can be waiting to load (Req 17.3).
  ADD CONSTRAINT ingestion_run_validated_clean CHECK (status <> 'validated' OR error_count = 0),
  ADD CONSTRAINT ingestion_run_valid_rows CHECK (valid_row_count <= row_count),
  ADD CONSTRAINT ingestion_run_normalized_pair CHECK ((normalized_key IS NULL) = (normalized_sha256 IS NULL));

CREATE INDEX ingestion_run_type_idx ON ingestion_run (dataset_type, started_at DESC);

-- Lifecycle: validating -> validated | blocked | failed; validated -> loaded |
-- cancelled. Everything else is terminal, and the validation outcome (counts,
-- issues, file, provenance) never changes after validation.
CREATE FUNCTION lw_ingestion_run_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'validating' AND NEW.status IN ('validated', 'blocked', 'failed'))
    OR (OLD.status = 'validated'  AND NEW.status IN ('loaded', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'ingestion run % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'validating' AND (
       NEW.dataset_type IS DISTINCT FROM OLD.dataset_type
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.file_name IS DISTINCT FROM OLD.file_name
    OR NEW.file_key IS DISTINCT FROM OLD.file_key
    OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
    OR NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.valid_row_count IS DISTINCT FROM OLD.valid_row_count
    OR NEW.warning_count IS DISTINCT FROM OLD.warning_count
    OR NEW.error_count IS DISTINCT FROM OLD.error_count
    OR NEW.issues IS DISTINCT FROM OLD.issues
    OR NEW.synthetic IS DISTINCT FROM OLD.synthetic
    OR NEW.normalized_key IS DISTINCT FROM OLD.normalized_key
    OR NEW.normalized_sha256 IS DISTINCT FROM OLD.normalized_sha256
    OR NEW.base_snapshot_id IS DISTINCT FROM OLD.base_snapshot_id
  ) THEN
    RAISE EXCEPTION 'ingestion run % validation outcome is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ingestion_run_guard BEFORE UPDATE ON ingestion_run
  FOR EACH ROW EXECUTE FUNCTION lw_ingestion_run_guard();

-- ---------------------------------------------------------------------------
-- DatasetSnapshot: content hash (a pinned snapshot is provably unchanged),
-- its source run, and who last changed the synthetic flag.
-- ---------------------------------------------------------------------------
ALTER TABLE dataset_snapshot
  ADD COLUMN content_sha256       text CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN source_run_id        uuid,
  ADD COLUMN synthetic_changed_at timestamptz,
  ADD COLUMN synthetic_changed_by uuid REFERENCES app_user (id),
  ADD CONSTRAINT dataset_snapshot_synthetic_change_pair
    CHECK ((synthetic_changed_at IS NULL) = (synthetic_changed_by IS NULL));

CREATE OR REPLACE FUNCTION lw_dataset_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dataset_type IS DISTINCT FROM OLD.dataset_type
     OR NEW.covers_from IS DISTINCT FROM OLD.covers_from
     OR NEW.covers_to IS DISTINCT FROM OLD.covers_to
     OR NEW.row_count IS DISTINCT FROM OLD.row_count
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
     OR NEW.loaded_at IS DISTINCT FROM OLD.loaded_at
     OR NEW.loaded_by IS DISTINCT FROM OLD.loaded_by THEN
    RAISE EXCEPTION 'dataset snapshot % is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- A flag change must be stamped (the API records who, Req 17.6).
  IF NEW.synthetic IS DISTINCT FROM OLD.synthetic
     AND (NEW.synthetic_changed_at IS NOT DISTINCT FROM OLD.synthetic_changed_at
          OR NEW.synthetic_changed_by IS NULL) THEN
    RAISE EXCEPTION 'changing the synthetic flag of snapshot % must record who and when', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Staleness lookup on load: which scenarios pin the snapshot being superseded.
CREATE INDEX scenario_snapshot_snapshot_idx ON scenario_snapshot (snapshot_id);
