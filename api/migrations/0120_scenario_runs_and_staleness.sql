-- LaneWise schema 0120 — scenario run results and the stale pause
-- (task 11; Req 8.1, 8.4, 8.5; P5, P6, P18).

-- Summary results of a scenario run, computed by the domain engine. The run
-- row keeps `results_ref` pointing here (`db:scenario_run_result/<run id>`);
-- full per-day detail can move to S3 with the job worker (task 14). Results
-- never change once written (P6: reproducible), and share the run's
-- provenance (P18).
CREATE TABLE scenario_run_result (
  run_id     uuid PRIMARY KEY,
  synthetic  boolean NOT NULL,
  results    jsonb NOT NULL CHECK (jsonb_typeof(results) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scenario_run_result_run_fk FOREIGN KEY (run_id, synthetic)
    REFERENCES scenario_run (id, synthetic) ON DELETE CASCADE
);

CREATE FUNCTION lw_scenario_run_result_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scenario run results are immutable' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER scenario_run_result_immutable BEFORE UPDATE ON scenario_run_result
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_run_result_immutable();

-- Req 8.5: a Submitted scenario that becomes stale (a newer snapshot or rule
-- version, from any source) is paused and its approvers — HR, Finance and
-- the Executive — are notified. "Paused" is the stale flag on a Submitted
-- scenario: no approval decision is accepted until it is refreshed.
CREATE FUNCTION lw_scenario_pause_on_stale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stale AND NOT OLD.stale AND NEW.status = 'submitted' THEN
    INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
    SELECT DISTINCT ra.user_id, 'scenario.paused', 'scenario', NEW.id::text, 'warning',
           jsonb_build_object('reason', coalesce(NEW.stale_reason, 'stale'), 'name', NEW.name), NEW.synthetic
      FROM role_assignment ra
      JOIN app_user u ON u.id = ra.user_id
     WHERE ra.role IN ('HR', 'FIN', 'EXE') AND u.status = 'active';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scenario_pause_on_stale AFTER UPDATE OF stale ON scenario
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_pause_on_stale();

CREATE FUNCTION lw_approval_step_not_paused() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_stale boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT stale INTO is_stale FROM scenario WHERE id = NEW.scenario_id;
    IF is_stale THEN
      RAISE EXCEPTION 'scenario % is stale; approvals are paused until it is recalculated', NEW.scenario_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER approval_step_not_paused BEFORE UPDATE ON approval_step
  FOR EACH ROW EXECUTE FUNCTION lw_approval_step_not_paused();
