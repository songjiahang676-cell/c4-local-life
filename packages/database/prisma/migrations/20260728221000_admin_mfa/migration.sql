-- AUTH-005: additive MFA credentials and authentication-strength session metadata.
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="Existing sessions are safely backfilled as PRIMARY by an immutable default" rollback="Old application versions ignore both additive session columns"
CREATE TYPE "AuthenticationStrength" AS ENUM ('PRIMARY', 'MFA');
CREATE TYPE "MfaCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

ALTER TABLE "auth_sessions"
  ADD COLUMN "authentication_strength" "AuthenticationStrength" NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "mfa_verified_at" TIMESTAMPTZ(6);

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_mfa_strength_check" CHECK (
    ("authentication_strength" = 'PRIMARY' AND "mfa_verified_at" IS NULL)
    OR ("authentication_strength" = 'MFA' AND "mfa_verified_at" IS NOT NULL)
  );

CREATE TABLE "mfa_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "MfaCredentialStatus" NOT NULL DEFAULT 'PENDING',
  "encrypted_secret" VARCHAR(512) NOT NULL,
  "key_version" INTEGER NOT NULL DEFAULT 1,
  "enrollment_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "activated_at" TIMESTAMPTZ(6),
  "disabled_at" TIMESTAMPTZ(6),
  "last_used_step" BIGINT,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_credentials_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "mfa_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mfa_credentials_state_check" CHECK (
    ("status" = 'PENDING' AND "activated_at" IS NULL AND "disabled_at" IS NULL)
    OR ("status" = 'ACTIVE' AND "activated_at" IS NOT NULL AND "disabled_at" IS NULL)
    OR ("status" = 'DISABLED' AND "disabled_at" IS NOT NULL)
  ),
  CONSTRAINT "mfa_credentials_failed_attempts_check"
    CHECK ("failed_attempts" >= 0 AND "failed_attempts" <= 20),
  CONSTRAINT "mfa_credentials_key_version_check" CHECK ("key_version" > 0),
  CONSTRAINT "mfa_credentials_last_used_step_check"
    CHECK ("last_used_step" IS NULL OR "last_used_step" >= 0),
  CONSTRAINT "mfa_credentials_enrollment_expiry_check"
    CHECK ("enrollment_expires_at" > "created_at")
);

CREATE TABLE "mfa_recovery_codes" (
  "id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "code_hash" VARCHAR(128) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_recovery_codes_credential_id_code_hash_key"
    UNIQUE ("credential_id", "code_hash"),
  CONSTRAINT "mfa_recovery_codes_credential_id_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "mfa_credentials"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mfa_credentials_status_enrollment_expires_at_idx"
  ON "mfa_credentials"("status", "enrollment_expires_at");
CREATE INDEX "mfa_recovery_codes_credential_id_consumed_at_idx"
  ON "mfa_recovery_codes"("credential_id", "consumed_at");
