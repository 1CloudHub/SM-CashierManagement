-- LaneWise schema 0001 — foundation, identity and organisation (task 5.1).
--
-- Conventions (api/migrations/README section in api/src/db/migrate.ts):
--   * Plain, forward-only SQL; each file runs in one transaction.
--   * uuid primary keys (gen_random_uuid(), built in since PostgreSQL 13).
--   * Enumerations are text + CHECK (cheaper to evolve than CREATE TYPE ... ENUM).
--   * `synthetic` marks seeded demo records (Req 18/19, P18). Where a child row
--     belongs to a parent, a composite FK on (parent_id, synthetic) makes the DB
--     reject any child whose provenance differs from its parent, so a snapshot,
--     scenario or run can never mix demo and real records.
--   * Timestamps are timestamptz; `updated_at` is maintained by trigger.

-- ---------------------------------------------------------------------------
-- Application role. The API connects as (a login role granted) lanewise_app;
-- migrations run as the owner. Privileges on the append-only audit table are
-- narrowed in 0005. Task 24 creates the login role on Aurora.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE ROLE lanewise_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL; -- cluster-wide; may already exist
END
$$;

GRANT USAGE ON SCHEMA public TO lanewise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lanewise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lanewise_app;

CREATE FUNCTION lw_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Identity: User, Passkey, RoleAssignment
-- ---------------------------------------------------------------------------
CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cognito `sub` (task 7); null until first sign-in links the identity.
  cognito_sub     text UNIQUE,
  email           text NOT NULL UNIQUE,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_sign_in_at timestamptz,
  -- Demo role switcher (task 8.2); always re-authorised server-side (P12).
  active_role     text CHECK (active_role IN ('ADM','EXE','PLN','STM','HR','FIN','RST','STF')),
  language        text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fil')),
  synthetic       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Emails are stored normalised (lower-case) so uniqueness is case-insensitive.
  CONSTRAINT app_user_email_lower CHECK (email = lower(email)),
  -- Domain allowlist, defence in depth behind the pre-sign-up Lambda (Req 1.1, P13).
  CONSTRAINT app_user_email_domain CHECK (
    email ~ '^[^@\s]+@(smretail\.com|1cloudhub\.com)$'
  )
);
CREATE TRIGGER app_user_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- Mirror of the passkeys registered in Cognito, listed on SCR-080.
CREATE TABLE passkey (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  device_label  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkey_user_idx ON passkey (user_id);

-- ---------------------------------------------------------------------------
-- Organisation: Region, Store, Department, StoreLocation, Barangay
-- ---------------------------------------------------------------------------
CREATE TABLE region (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  synthetic  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  format     text NOT NULL CHECK (format IN ('sm_supermarket', 'sm_hypermarket', 'savemore', 'sm_store')),
  region_id  uuid NOT NULL REFERENCES region (id),
  active     boolean NOT NULL DEFAULT true,
  synthetic  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_id_synthetic_key UNIQUE (id, synthetic)
);
CREATE INDEX store_region_idx ON store (region_id);
CREATE TRIGGER store_updated_at BEFORE UPDATE ON store
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

CREATE TABLE department (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 uuid NOT NULL,
  name                     text NOT NULL CHECK (length(btrim(name)) > 0),
  installed_lanes          integer NOT NULL CHECK (installed_lanes >= 0),
  default_handle_time_min  numeric(6, 3) NOT NULL CHECK (default_handle_time_min > 0),
  trading_open             time NOT NULL,
  trading_close            time NOT NULL,
  active                   boolean NOT NULL DEFAULT true,
  synthetic                boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT department_store_name_key UNIQUE (store_id, name),
  CONSTRAINT department_id_store_key UNIQUE (id, store_id),
  CONSTRAINT department_id_synthetic_key UNIQUE (id, synthetic),
  -- P18: a department has its store's provenance.
  CONSTRAINT department_store_fk FOREIGN KEY (store_id, synthetic)
    REFERENCES store (id, synthetic)
);
CREATE TRIGGER department_updated_at BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();

-- Store position for the network map (SCR-026). Demo positions are approximate.
CREATE TABLE store_location (
  store_id    uuid PRIMARY KEY,
  lat         numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         numeric(9, 6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
  geocoded_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL CHECK (source IN ('amazon_location', 'manual', 'demo_approximate')),
  synthetic   boolean NOT NULL DEFAULT false,
  CONSTRAINT store_location_store_fk FOREIGN KEY (store_id, synthetic)
    REFERENCES store (id, synthetic) ON DELETE CASCADE
);

-- Barangay reference list (PSGC). Staff home areas reference a barangay, so
-- the only coordinates ever associated with a person are the barangay's public
-- centroid — finer location cannot be stored (Req 12.1, P15).
CREATE TABLE barangay (
  psgc_code    text PRIMARY KEY CHECK (psgc_code ~ '^[0-9]{9,10}$'),
  name         text NOT NULL,
  city         text NOT NULL,
  centroid_lat numeric(8, 5) NOT NULL CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lon numeric(8, 5) NOT NULL CHECK (centroid_lon BETWEEN -180 AND 180)
);

-- ---------------------------------------------------------------------------
-- RoleAssignment. Scope ids are region ids, store ids or the single staff id
-- depending on scope_type (element FKs are checked in the data-access layer).
-- ---------------------------------------------------------------------------
CREATE TABLE role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('ADM','EXE','PLN','STM','HR','FIN','RST','STF')),
  scope_type  text NOT NULL CHECK (scope_type IN ('global', 'region', 'store', 'self')),
  scope_ids   uuid[] NOT NULL DEFAULT '{}',
  granted_by  uuid REFERENCES app_user (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- One assignment per role per user; multiple scope ids combine within it.
  CONSTRAINT role_assignment_user_role_key UNIQUE (user_id, role),
  CONSTRAINT role_assignment_scope_shape CHECK (
    (scope_type = 'global' AND cardinality(scope_ids) = 0)
    OR (scope_type IN ('region', 'store') AND cardinality(scope_ids) > 0)
    OR (scope_type = 'self' AND cardinality(scope_ids) = 1)
  ),
  -- Staff (and only Staff) is self-scoped (P11).
  CONSTRAINT role_assignment_staff_self CHECK ((role = 'STF') = (scope_type = 'self'))
);
CREATE TRIGGER role_assignment_updated_at BEFORE UPDATE ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION lw_set_updated_at();
