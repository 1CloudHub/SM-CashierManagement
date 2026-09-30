-- LaneWise schema 0230 — demo-data seed and isolation (task 23; Req 19, P18).
--
-- 1. Rule versions are numbered per provenance. The seeded demo series
--    (synthetic) and the real series of the same rule set no longer share one
--    counter, so the demo seed always produces v1 of each demo rule set
--    (Req 19.6 determinism) and never collides with, renumbers or blocks a
--    real version.
ALTER TABLE rule_version DROP CONSTRAINT rule_version_number_key;
ALTER TABLE rule_version
  ADD CONSTRAINT rule_version_number_key UNIQUE (rule_set_id, synthetic, version);

-- 2. Barangay reference rows seeded for the demo network are flagged too, so a
--    demo reset can remove exactly the rows it added and never a real
--    (PSGC-loaded) barangay. Demo barangays use the reserved code prefix '99',
--    which is not a PSGC region code.
ALTER TABLE barangay ADD COLUMN synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE barangay
  ADD CONSTRAINT barangay_demo_code_prefix CHECK (synthetic = (psgc_code LIKE '99%'));

-- 3. An ingestion run and the snapshot it loaded share provenance at load
--    time (P18): a real upload can never produce (or point at) a demo
--    snapshot, and vice versa. Enforced by a trigger on the run rather than an
--    FK, so the Rules Steward may still reclassify the snapshot afterwards
--    (Req 17.6) while the run keeps the provenance of what was uploaded
--    (immutable, task 9). snapshot_id is null for blocked runs.
CREATE FUNCTION ingestion_run_snapshot_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  snap_synthetic boolean;
  snap_type text;
BEGIN
  IF NEW.snapshot_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.snapshot_id IS NOT DISTINCT FROM OLD.snapshot_id) THEN
    RETURN NEW;
  END IF;
  SELECT synthetic, dataset_type::text INTO snap_synthetic, snap_type FROM dataset_snapshot WHERE id = NEW.snapshot_id;
  IF snap_synthetic IS DISTINCT FROM NEW.synthetic OR snap_type IS DISTINCT FROM NEW.dataset_type::text THEN
    RAISE EXCEPTION 'ingestion run % and snapshot % differ in provenance or dataset type', NEW.id, NEW.snapshot_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- An AFTER constraint trigger (like an FK check), so row CHECK constraints are
-- evaluated first.
CREATE CONSTRAINT TRIGGER ingestion_run_snapshot_provenance
  AFTER INSERT OR UPDATE OF snapshot_id ON ingestion_run
  FOR EACH ROW EXECUTE FUNCTION ingestion_run_snapshot_provenance();
