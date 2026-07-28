-- Roll-forward: add optimistic profile concurrency and the account-state session-revocation
-- invariant before enabling the authenticated account-management endpoints. Existing profiles
-- safely start at version 1; every application-managed profile update increments it.
-- Application rollback: the previous application ignores the additive column. Retain the trigger
-- because revoking sessions after a status/deletion change is safe for both application versions;
-- do not drop profile or session data during incident response.
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="constant default backfills existing profiles without table rewrite on supported PostgreSQL" rollback="previous application ignores the additive version column"
ALTER TABLE "user_profiles"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Account availability is an authentication invariant, so enforce revocation even if a later
-- administrative workflow changes the user row through a different application service.
CREATE FUNCTION "revoke_auth_sessions_on_user_state_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "auth_sessions"
     SET "revoked_at" = COALESCE(NEW."deleted_at", statement_timestamp())
   WHERE "user_id" = NEW."id"
     AND "revoked_at" IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_revoke_sessions_after_state_change"
AFTER UPDATE OF "status", "deleted_at" ON "users"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
)
EXECUTE FUNCTION "revoke_auth_sessions_on_user_state_change"();
