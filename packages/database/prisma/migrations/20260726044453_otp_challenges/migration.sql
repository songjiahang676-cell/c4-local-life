-- Roll-forward: deploy this additive challenge table before enabling OTP endpoints.
-- The table contains short-lived contact PII and keyed hashes; the maintenance retention job must
-- remove or aggregate rows within 24 hours after expiry/consumption.
-- Application rollback: disable OTP routes and retain the additive enum/table until the retention
-- window has elapsed. Do not drop the table during incident response.
-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGN_IN', 'VERIFY_CONTACT', 'SENSITIVE_ACTION');

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "OtpChannel" NOT NULL,
    "destination" VARCHAR(320) NOT NULL,
    "destination_hash" VARCHAR(128) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-Hans',
    "code_hash" VARCHAR(128) NOT NULL,
    "ip_hash" VARCHAR(128) NOT NULL,
    "device_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_destination_hash_purpose_created_at_idx" ON "otp_challenges"("destination_hash", "purpose", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_ip_hash_created_at_idx" ON "otp_challenges"("ip_hash", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_device_hash_created_at_idx" ON "otp_challenges"("device_hash", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
