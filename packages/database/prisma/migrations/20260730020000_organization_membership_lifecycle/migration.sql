-- migration-safety: allow ADD_REQUIRED_COLUMN reason="existing memberships receive an explicit version and current update timestamp so concurrent role changes can start from a coherent additive baseline" rollback="the prior application ignores both additive columns; retain them during roll-forward or remove only after stopping new writers as documented in ROLLBACK.md"

CREATE TYPE "OrganizationInvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);

ALTER TABLE "organization_memberships"
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "organization_memberships_version_check"
    CHECK ("version" > 0);

CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "invitee_user_id" UUID NOT NULL,
  "invited_by_id" UUID NOT NULL,
  "revoked_by_id" UUID,
  "role" "MembershipRole" NOT NULL,
  "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_non_owner_role_check"
    CHECK ("role" <> 'OWNER'::"MembershipRole"),
  CONSTRAINT "organization_invitations_idempotency_key_check"
    CHECK (
      char_length("idempotency_key") BETWEEN 16 AND 128
      AND "idempotency_key" ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT "organization_invitations_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "organization_invitations_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "organization_invitations_lifecycle_check"
    CHECK (
      ("status" = 'PENDING' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_id" IS NULL)
      OR ("status" = 'ACCEPTED' AND "accepted_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_id" IS NULL)
      OR ("status" = 'REVOKED' AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL)
      OR ("status" = 'EXPIRED' AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "organization_invitations_organization_id_invited_by_id_idempotency_key_key"
  ON "organization_invitations" ("organization_id", "invited_by_id", "idempotency_key");

CREATE UNIQUE INDEX "organization_invitations_one_pending_invitee_idx"
  ON "organization_invitations" ("organization_id", "invitee_user_id")
  WHERE "status" = 'PENDING'::"OrganizationInvitationStatus";

CREATE INDEX "organization_invitations_invitee_user_id_status_expires_at_idx"
  ON "organization_invitations" ("invitee_user_id", "status", "expires_at");

CREATE INDEX "organization_invitations_organization_id_status_created_at_idx"
  ON "organization_invitations" ("organization_id", "status", "created_at" DESC);

CREATE INDEX "organization_invitations_organization_id_invitee_user_id_status_idx"
  ON "organization_invitations" ("organization_id", "invitee_user_id", "status");

CREATE TABLE "organization_owner_transfers" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "from_user_id" UUID NOT NULL,
  "to_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "from_role_after" "MembershipRole" NOT NULL DEFAULT 'ADMIN',
  "to_role_after" "MembershipRole" NOT NULL DEFAULT 'OWNER',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "organization_owner_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_owner_transfers_distinct_users_check"
    CHECK ("from_user_id" <> "to_user_id"),
  CONSTRAINT "organization_owner_transfers_roles_check"
    CHECK (
      "from_role_after" = 'ADMIN'::"MembershipRole"
      AND "to_role_after" = 'OWNER'::"MembershipRole"
    ),
  CONSTRAINT "organization_owner_transfers_idempotency_key_check"
    CHECK (
      char_length("idempotency_key") BETWEEN 16 AND 128
      AND "idempotency_key" ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT "organization_owner_transfers_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "organization_owner_transfers_organization_id_from_user_id_idempotency_key_key"
  ON "organization_owner_transfers" ("organization_id", "from_user_id", "idempotency_key");

CREATE INDEX "organization_owner_transfers_organization_id_occurred_at_idx"
  ON "organization_owner_transfers" ("organization_id", "occurred_at" DESC);

CREATE INDEX "organization_owner_transfers_to_user_id_occurred_at_idx"
  ON "organization_owner_transfers" ("to_user_id", "occurred_at" DESC);

ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_invitations_invitee_user_id_fkey"
    FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_invitations_revoked_by_id_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_owner_transfers"
  ADD CONSTRAINT "organization_owner_transfers_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_owner_transfers_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_owner_transfers_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "ensure_organization_has_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  checked_organization_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    checked_organization_id := NEW."id";
  ELSE
    checked_organization_id := COALESCE(NEW."organization_id", OLD."organization_id");
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "organizations"
     WHERE "id" = checked_organization_id
  ) AND NOT EXISTS (
    SELECT 1
      FROM "organization_memberships"
     WHERE "organization_id" = checked_organization_id
       AND "role" = 'OWNER'::"MembershipRole"
  ) THEN
    RAISE EXCEPTION 'organization must retain at least one OWNER';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "organizations_require_owner_after_insert"
AFTER INSERT ON "organizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ensure_organization_has_owner"();

CREATE CONSTRAINT TRIGGER "organization_memberships_require_owner_after_change"
AFTER UPDATE OF "role" OR DELETE ON "organization_memberships"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ensure_organization_has_owner"();

INSERT INTO "notification_templates" (
  "id",
  "key",
  "channel",
  "locale",
  "version",
  "title",
  "body",
  "variable_schema",
  "published_at",
  "created_at"
)
VALUES
  (
    '91000000-0000-4000-8000-000000000001',
    'organization.invitation.created',
    'IN_APP',
    'zh-Hans',
    1,
    '你收到一个组织邀请',
    '请在邀请到期前查看并决定是否加入该组织。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'organization.invitation.created',
    'IN_APP',
    'en-US',
    1,
    'You received an organization invitation',
    'Review the invitation before it expires and choose whether to join the organization.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
