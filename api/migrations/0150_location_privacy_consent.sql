-- LaneWise schema 0150 — location privacy and home-area consent (task 15;
-- Req 12, P15; RA 10173; SEC-001).
--
--   * consent_text: versioned, immutable consent wording per purpose/locale.
--   * staff_consent: every grant and withdrawal (the consent history). At most
--     one active grant per staff member and purpose.
--   * A staff_home_area row may exist only while an active home-area consent
--     exists; withdrawing consent (or deactivating the staff record) deletes
--     it in the same transaction.
--   * home_area_matchable: the single read path for map aggregation and
--     travel-based matching. It carries barangay code/name/city only (no
--     centroid) and only consented, active staff.

-- ---------------------------------------------------------------------------
-- Consent text (versioned). A new version is a new set of rows; published
-- rows never change. `requires_reconsent` marks a version whose change is
-- material: grants to earlier versions stop counting once it takes effect.
-- ---------------------------------------------------------------------------
CREATE TABLE consent_text (
  purpose            text NOT NULL CHECK (purpose IN ('home_area')),
  version            integer NOT NULL CHECK (version > 0),
  locale             text NOT NULL CHECK (locale IN ('en', 'fil')),
  body               text NOT NULL CHECK (length(btrim(body)) > 0),
  requires_reconsent boolean NOT NULL DEFAULT true,
  effective_from     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purpose, version, locale)
);

CREATE FUNCTION lw_consent_text_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_text is immutable (% rejected); publish a new version instead', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER consent_text_immutable BEFORE UPDATE OR DELETE ON consent_text
  FOR EACH ROW EXECUTE FUNCTION lw_consent_text_immutable();

-- Version 1 (baseline). Effective from the epoch so it is in force at once.
INSERT INTO consent_text (purpose, version, locale, body, requires_reconsent, effective_from) VALUES
('home_area', 1, 'en',
 'I agree that SM Retail may use my home barangay (never my address or live location) and my maximum travel time to match me to open cashier shifts at nearby SM stores. My barangay is shown only as a barangay: to my own store''s manager and HR, and in travel-based matching. Managers of other stores see my staff ID, home store and barangay, and see my name only after I accept their offer. Planners see only how many cashiers live in each barangay. I can stop sharing at any time in my profile: my home area is deleted immediately and I am no longer matched by travel. My consent record (without my barangay) is kept for 5 years as proof of consent. This is processed under the Data Privacy Act of 2012 (RA 10173).',
 true, 'epoch'),
('home_area', 1, 'fil',
 'Pumapayag ako na gamitin ng SM Retail ang aking home barangay (hindi kailanman ang aking address o live na lokasyon) at ang pinakamahabang oras ng biyahe ko para itugma ako sa mga bakanteng shift bilang cashier sa mga kalapit na SM store. Barangay lamang ang ipinapakita: sa manager ng sarili kong store at sa HR, at sa pagtutugma batay sa biyahe. Ang mga manager ng ibang store ay makikita ang aking staff ID, home store at barangay, at makikita lamang ang aking pangalan kapag tinanggap ko ang kanilang alok. Ang mga planner ay makikita lamang kung ilang cashier ang nakatira sa bawat barangay. Maaari akong tumigil sa pagbabahagi anumang oras sa aking profile: agad na buburahin ang aking home area at hindi na ako itutugma batay sa biyahe. Ang tala ng aking pahintulot (walang barangay) ay itatago nang 5 taon bilang patunay. Ito ay pinoproseso alinsunod sa Data Privacy Act of 2012 (RA 10173).',
 true, 'epoch');

-- ---------------------------------------------------------------------------
-- StaffConsent: grant + withdrawal history. No location is stored here, so
-- the record can outlive the home area as proof of consent (SEC-001).
-- ---------------------------------------------------------------------------
CREATE TABLE staff_consent (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id          uuid NOT NULL,
  purpose           text NOT NULL,
  text_version      integer NOT NULL,
  text_locale       text NOT NULL,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  -- The user who granted (the staff member themself); null only for seeded
  -- demo records (task 23).
  granted_by        uuid REFERENCES app_user (id),
  withdrawn_at      timestamptz,
  withdrawn_by      uuid REFERENCES app_user (id),
  withdrawal_reason text CHECK (withdrawal_reason IN ('staff_withdrew', 'staff_inactive', 'superseded')),
  synthetic         boolean NOT NULL DEFAULT false,
  CONSTRAINT staff_consent_staff_fk FOREIGN KEY (staff_id, synthetic)
    REFERENCES staff (id, synthetic) ON DELETE CASCADE,
  CONSTRAINT staff_consent_text_fk FOREIGN KEY (purpose, text_version, text_locale)
    REFERENCES consent_text (purpose, version, locale),
  CONSTRAINT staff_consent_withdrawal_shape CHECK (
    (withdrawn_at IS NULL) = (withdrawal_reason IS NULL)
    AND (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
  )
);
CREATE UNIQUE INDEX staff_consent_one_active ON staff_consent (staff_id, purpose) WHERE withdrawn_at IS NULL;
CREATE INDEX staff_consent_withdrawn_idx ON staff_consent (withdrawn_at) WHERE withdrawn_at IS NOT NULL;

-- A grant is immutable except for being withdrawn once.
CREATE FUNCTION lw_staff_consent_withdraw_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn consent cannot change; record a new grant instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.staff_id, NEW.purpose, NEW.text_version, NEW.text_locale, NEW.granted_at, NEW.granted_by, NEW.synthetic)
     IS DISTINCT FROM
     (OLD.id, OLD.staff_id, OLD.purpose, OLD.text_version, OLD.text_locale, OLD.granted_at, OLD.granted_by, OLD.synthetic) THEN
    RAISE EXCEPTION 'a consent grant is immutable; only its withdrawal may be recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_consent_withdraw_only BEFORE UPDATE ON staff_consent
  FOR EACH ROW EXECUTE FUNCTION lw_staff_consent_withdraw_only();

-- Withdrawing home-area consent deletes the home area immediately (Req 12.3).
-- A grant superseded by a new grant to a newer text version (same statement)
-- leaves an active grant behind, so the home area stays.
CREATE FUNCTION lw_staff_consent_withdrawn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'home_area' AND NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM staff_consent
        WHERE staff_id = NEW.staff_id AND purpose = 'home_area' AND withdrawn_at IS NULL
     ) THEN
    DELETE FROM staff_home_area WHERE staff_id = NEW.staff_id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER staff_consent_withdrawn AFTER UPDATE ON staff_consent
  FOR EACH ROW EXECUTE FUNCTION lw_staff_consent_withdrawn();

-- A home area can be stored only under an active home-area consent (Req 12.2).
-- (A NULL consent_at is left to the column's NOT NULL constraint.)
CREATE FUNCTION lw_staff_home_area_requires_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consent_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM staff_consent
     WHERE staff_id = NEW.staff_id AND purpose = 'home_area' AND withdrawn_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a home area needs an active home-area consent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_home_area_requires_consent BEFORE INSERT OR UPDATE ON staff_home_area
  FOR EACH ROW EXECUTE FUNCTION lw_staff_home_area_requires_consent();

-- Deactivating a staff record withdraws their home-area consent, which in
-- turn deletes the home area (retention: SEC-001).
CREATE FUNCTION lw_staff_deactivated_withdraws_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    UPDATE staff_consent
       SET withdrawn_at = greatest(now(), granted_at), withdrawal_reason = 'staff_inactive'
     WHERE staff_id = NEW.id AND withdrawn_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER staff_deactivated_withdraws_consent AFTER UPDATE OF active ON staff
  FOR EACH ROW EXECUTE FUNCTION lw_staff_deactivated_withdraws_consent();

-- ---------------------------------------------------------------------------
-- The only read path for map aggregation and travel-based matching (P15):
-- active staff with an active consent to a still-valid text version.
-- ---------------------------------------------------------------------------
CREATE VIEW home_area_matchable AS
SELECT h.staff_id,
       s.store_id AS home_store_id,
       h.barangay_code,
       b.name     AS barangay_name,
       b.city     AS barangay_city,
       c.granted_at AS consent_at,
       c.text_version AS consent_version,
       h.max_travel_min,
       h.cross_store_offers,
       h.synthetic
  FROM staff_home_area h
  JOIN staff s ON s.id = h.staff_id AND s.active
  JOIN barangay b ON b.psgc_code = h.barangay_code
  JOIN staff_consent c
    ON c.staff_id = h.staff_id AND c.purpose = 'home_area' AND c.withdrawn_at IS NULL
 WHERE c.text_version >= (
         SELECT coalesce(max(t.version), 1) FROM consent_text t
          WHERE t.purpose = 'home_area' AND t.requires_reconsent AND t.effective_from <= now()
       );
