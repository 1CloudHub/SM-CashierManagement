-- LaneWise schema 0130 — approval workflow (task 12; Req 9.1–9.7; P7, P10).
--
-- 0003 created `approval_step` with the approver-role, comment, off-system
-- and P10 plan-sequencing checks, and 0120 pauses decisions on a stale
-- Submitted scenario. This migration adds:
--   * who submitted the current submission, and when (SCR-033 header and the
--     "submitter" notification recipient);
--   * decisions are final: a decided step never changes again, and only a
--     pending step of the scenario's current submission, while the scenario
--     is Submitted, can be decided (Req 9.6: a resubmission opens new steps);
--   * P10 at the scenario level: a scenario becomes Approved (and so
--     Published) only when the plan step of its current submission is
--     approved — which the 0003 trigger already allows only when headcount
--     and budget are both secured.

ALTER TABLE scenario
  ADD COLUMN submitted_by uuid REFERENCES app_user (id),
  ADD COLUMN submitted_at timestamptz;

CREATE FUNCTION lw_approval_step_decision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
     OR NEW.submission_no IS DISTINCT FROM OLD.submission_no
     OR NEW.step IS DISTINCT FROM OLD.step THEN
    RAISE EXCEPTION 'approval step % cannot move to another scenario, submission or step', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'approval step % is already % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'pending' THEN
    SELECT status, current_submission_no INTO s FROM scenario WHERE id = NEW.scenario_id;
    IF s.status <> 'submitted' OR s.current_submission_no <> NEW.submission_no THEN
      RAISE EXCEPTION 'only the current submission of a submitted scenario can be decided'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER approval_step_decision_guard BEFORE UPDATE ON approval_step
  FOR EACH ROW EXECUTE FUNCTION lw_approval_step_decision_guard();

CREATE FUNCTION lw_scenario_approved_requires_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NOT EXISTS (
       SELECT 1 FROM approval_step
        WHERE scenario_id = NEW.id
          AND submission_no = NEW.current_submission_no
          AND step = 'plan'
          AND status = 'approved'
     ) THEN
    RAISE EXCEPTION 'scenario % needs an approved plan step before it is approved', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scenario_approved_requires_plan BEFORE UPDATE OF status ON scenario
  FOR EACH ROW EXECUTE FUNCTION lw_scenario_approved_requires_plan();
