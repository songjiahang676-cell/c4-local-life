-- AUTH-004: opt-in password authentication and cooldown recovery evidence.
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="Existing users safely begin with zero failed password attempts" rollback="Old application versions ignore the additive counter"
CREATE TYPE "PasswordAuthAttemptOutcome" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE');

ALTER TABLE "users"
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "password_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "password_locked_until" TIMESTAMPTZ(6);

-- The scaffold never authenticated password hashes, but preserve any pre-existing imported value
-- and give it provenance. The format constraint remains NOT VALID until those values are audited.
-- migration-safety: allow UPDATE_DATA reason="Backfill provenance for any pre-existing imported verifier before enforcing coherent password state" rollback="Retain the timestamp because clearing it would make an imported verifier fail the additive state constraint"
UPDATE "users"
SET "password_changed_at" = "updated_at"
WHERE "password_hash" IS NOT NULL AND "password_changed_at" IS NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_password_state_check" CHECK (
    (
      "password_hash" IS NULL
      AND "password_changed_at" IS NULL
      AND "password_failed_attempts" = 0
      AND "password_locked_until" IS NULL
    )
    OR (
      "password_hash" IS NOT NULL
      AND "password_changed_at" IS NOT NULL
      AND "password_failed_attempts" BETWEEN 0 AND 20
    )
  ),
  ADD CONSTRAINT "users_password_hash_format_check" CHECK (
    "password_hash" IS NULL
    OR "password_hash" ~ '^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{86}$'
  ) NOT VALID;

CREATE TABLE "password_auth_attempts" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "identifier_hash" VARCHAR(128) NOT NULL,
  "ip_hash" VARCHAR(128) NOT NULL,
  "device_hash" VARCHAR(128) NOT NULL,
  "outcome" "PasswordAuthAttemptOutcome" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "password_auth_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_auth_attempts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "password_auth_attempts_state_check" CHECK (
    ("outcome" = 'PENDING' AND "completed_at" IS NULL)
    OR ("outcome" IN ('SUCCESS', 'FAILURE') AND "completed_at" IS NOT NULL)
  )
);

CREATE TABLE "password_recovery_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "channel" "OtpChannel" NOT NULL,
  "destination_hash" VARCHAR(128) NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "ip_hash" VARCHAR(128) NOT NULL,
  "device_hash" VARCHAR(128) NOT NULL,
  "available_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ(6),
  "superseded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_recovery_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_recovery_requests_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "password_recovery_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "password_recovery_requests_window_check" CHECK (
    "available_at" > "created_at" AND "expires_at" > "available_at"
  ),
  CONSTRAINT "password_recovery_requests_attempts_check"
    CHECK ("failed_attempts" BETWEEN 0 AND 20),
  CONSTRAINT "password_recovery_requests_consumed_check"
    CHECK ("consumed_at" IS NULL OR "consumed_at" >= "available_at"),
  CONSTRAINT "password_recovery_requests_superseded_check"
    CHECK ("superseded_at" IS NULL OR "superseded_at" >= "created_at"),
  CONSTRAINT "password_recovery_requests_terminal_check"
    CHECK ("consumed_at" IS NULL OR "superseded_at" IS NULL)
);

CREATE INDEX "password_auth_attempts_identifier_hash_created_at_idx"
  ON "password_auth_attempts"("identifier_hash", "created_at" DESC);
CREATE INDEX "password_auth_attempts_ip_hash_created_at_idx"
  ON "password_auth_attempts"("ip_hash", "created_at" DESC);
CREATE INDEX "password_auth_attempts_device_hash_created_at_idx"
  ON "password_auth_attempts"("device_hash", "created_at" DESC);
CREATE INDEX "password_auth_attempts_user_id_created_at_idx"
  ON "password_auth_attempts"("user_id", "created_at" DESC);
CREATE INDEX "password_recovery_requests_destination_hash_created_at_idx"
  ON "password_recovery_requests"("destination_hash", "created_at" DESC);
CREATE INDEX "password_recovery_requests_ip_hash_created_at_idx"
  ON "password_recovery_requests"("ip_hash", "created_at" DESC);
CREATE INDEX "password_recovery_requests_device_hash_created_at_idx"
  ON "password_recovery_requests"("device_hash", "created_at" DESC);
CREATE INDEX "password_recovery_requests_user_id_expires_at_idx"
  ON "password_recovery_requests"("user_id", "expires_at");
