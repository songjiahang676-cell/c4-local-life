-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT', 'MODERATOR', 'SENIOR_MODERATOR', 'AD_OPS', 'FINANCE', 'TAXONOMY_ADMIN', 'PLATFORM_ADMIN', 'READ_ONLY_AUDITOR');

-- CreateTable
CREATE TABLE "platform_role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "scope" JSONB,
    "reason_code" VARCHAR(80) NOT NULL,
    "granted_by_id" UUID,
    "revoked_by_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_role_assignments_scope_check"
      CHECK ("scope" IS NULL OR jsonb_typeof("scope") = 'object'),
    CONSTRAINT "platform_role_assignments_expiry_check"
      CHECK ("expires_at" IS NULL OR "expires_at" > "granted_at"),
    CONSTRAINT "platform_role_assignments_revocation_check"
      CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at"),
    CONSTRAINT "platform_role_assignments_revoker_check"
      CHECK (("revoked_at" IS NULL AND "revoked_by_id" IS NULL)
        OR ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL))
);

-- Only one current grant of the same role may exist for a subject. Expired rows must
-- be explicitly revoked before re-granting so role history stays unambiguous.
CREATE UNIQUE INDEX "platform_role_assignments_one_active_role"
ON "platform_role_assignments"("user_id", "role")
WHERE "revoked_at" IS NULL;

-- CreateIndex
CREATE INDEX "platform_role_assignments_user_id_revoked_at_expires_at_idx" ON "platform_role_assignments"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "platform_role_assignments_role_revoked_at_expires_at_idx" ON "platform_role_assignments"("role", "revoked_at", "expires_at");

-- AddForeignKey
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
