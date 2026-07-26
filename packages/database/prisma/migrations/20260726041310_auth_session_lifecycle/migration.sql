-- Roll-forward: deploy the additive columns before code that enforces idle expiry.
-- Existing sessions receive the migration timestamp and therefore fail closed as idle-expired;
-- users must authenticate again after this security-boundary release.
-- Application rollback: the previous application ignores both additive columns. Do not drop them
-- during an incident rollback; a later reviewed contract migration may remove them after retention.
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="idle expiry and last-seen are required for every persisted session; existing sessions intentionally expire at migration time" rollback="roll back application code while retaining additive columns; users reauthenticate and no canonical user data is lost"
-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "idle_expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idle_expires_at_idx" ON "auth_sessions"("user_id", "idle_expires_at");
