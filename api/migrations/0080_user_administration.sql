-- User administration (SCR-070 Users, SCR-071 Invite / edit user; Req 1, 2,
-- 22; P7, P13).
--
-- An administrator invites a user by work email: the app user is created as
-- `invited` with its role assignments, and the Cognito invitation email is
-- sent. The first verified sign-in makes the user `active`; deactivation sets
-- `disabled` (the API refuses every request from a disabled user).

ALTER TABLE app_user DROP CONSTRAINT app_user_status_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_status_check
  CHECK (status IN ('invited', 'active', 'disabled'));

ALTER TABLE app_user
  ADD COLUMN invited_at     timestamptz,
  ADD COLUMN invited_by     uuid REFERENCES app_user (id),
  ADD COLUMN deactivated_at timestamptz;

-- An invited user always records when the (latest) invitation was sent, and
-- a disabled user when they were deactivated (rows disabled before this
-- migration keep a null timestamp).
ALTER TABLE app_user ADD CONSTRAINT app_user_invited_at
  CHECK (status <> 'invited' OR invited_at IS NOT NULL);

CREATE INDEX app_user_status_idx ON app_user (status);
