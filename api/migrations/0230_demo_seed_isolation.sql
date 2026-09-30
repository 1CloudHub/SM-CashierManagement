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

-- 3. An ingestion run and the snapshot it loaded share provenance (P18): a
--    real upload can never produce (or point at) a demo snapshot, and vice
--    versa. snapshot_id is null for blocked runs (MATCH SIMPLE skips those).
ALTER TABLE ingestion_run
  ADD CONSTRAINT ingestion_run_snapshot_provenance_fk FOREIGN KEY (snapshot_id, dataset_type, synthetic)
    REFERENCES dataset_snapshot (id, dataset_type, synthetic);
