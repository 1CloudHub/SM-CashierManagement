-- LaneWise schema 0110 — rule-set versioning and the Finance gate
-- (task 10; Req 16; P6, P7). Builds on rule_set / rule_version (0002).

-- The cost flag follows the rule-set type (Req 16.3, Q6, Q23), mirroring
-- COST_RULE_SET_TYPES in @lanewise/shared.
ALTER TABLE rule_set ADD CONSTRAINT rule_set_cost_matches_type CHECK (
  is_cost_rule = (rule_set_type IN ('wages', 'premiums', 'transport_allowance'))
);

-- At most one open (unpublished) version per rule set and provenance: a new
-- draft starts only once the previous one is published (SCR-060 "Draft").
CREATE UNIQUE INDEX rule_version_one_open
  ON rule_version (rule_set_id, synthetic)
  WHERE status IN ('draft', 'submitted', 'changes_requested', 'approved');

CREATE INDEX rule_version_set_idx ON rule_version (rule_set_id, version DESC);

-- Finance's comment when it requests changes (required, Req 16.6 / SCR-061).
-- Kept after the author edits the draft so the request stays visible.
ALTER TABLE rule_version ADD COLUMN review_comment text;
ALTER TABLE rule_version ADD CONSTRAINT rule_version_changes_requested_comment CHECK (
  status <> 'changes_requested' OR length(btrim(coalesce(review_comment, ''))) > 0
);

-- Lifecycle guard, mirroring ruleVersionTransition in @lanewise/shared:
--   draft             -> submitted | published (non-cost)
--   changes_requested -> draft | submitted
--   submitted         -> approved | changes_requested (cost) | published (non-cost)
--   approved          -> published
--   published         -> superseded
-- Publishing also keeps effective dates in publish order, so a new version can
-- never take effect before the version it replaces (P6).
CREATE FUNCTION lw_rule_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'             AND NEW.status = 'submitted')
    OR (OLD.status = 'draft'             AND NEW.status = 'published' AND NOT OLD.is_cost_rule)
    OR (OLD.status = 'changes_requested' AND NEW.status IN ('draft', 'submitted'))
    OR (OLD.status = 'submitted'         AND NEW.status IN ('approved', 'changes_requested') AND OLD.is_cost_rule)
    OR (OLD.status = 'submitted'         AND NEW.status = 'published' AND NOT OLD.is_cost_rule)
    OR (OLD.status = 'approved'          AND NEW.status = 'published')
    OR (OLD.status = 'published'         AND NEW.status = 'superseded')
  ) THEN
    RAISE EXCEPTION 'rule version % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'published' AND OLD.status <> 'published' AND EXISTS (
    SELECT 1 FROM rule_version v
     WHERE v.rule_set_id = NEW.rule_set_id
       AND v.synthetic = NEW.synthetic
       AND v.id <> NEW.id
       AND v.status IN ('published', 'superseded')
       AND v.effective_from > NEW.effective_from
  ) THEN
    RAISE EXCEPTION 'rule version % takes effect before an already published version', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER rule_version_guard BEFORE UPDATE ON rule_version
  FOR EACH ROW EXECUTE FUNCTION lw_rule_version_guard();

-- Every real version is kept (Req 16.1): only an unsubmitted draft may be
-- deleted. Synthetic (demo) versions are exempt so the demo reset (task 23,
-- Req 19) can replace the whole demo series; real rows never are.
CREATE FUNCTION lw_rule_version_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND NOT OLD.synthetic THEN
    RAISE EXCEPTION 'rule version % is % and is kept for history', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER rule_version_keep BEFORE DELETE ON rule_version
  FOR EACH ROW EXECUTE FUNCTION lw_rule_version_keep();
