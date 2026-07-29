-- migration-safety: allow ADD_REQUIRED_COLUMN reason="existing moderation evaluations receive explicit historical DRAFT/NOT_REVIEWED defaults before new writers persist the actual previous state" rollback="retain additive transition evidence and disable revision writers; exceptional physical rollback is documented in ROLLBACK.md"

CREATE TYPE "ListingRevisionClassification" AS ENUM (
  'SUBMISSION',
  'MINOR_EDIT',
  'MAJOR_EDIT'
);

ALTER TABLE "moderation_evaluations"
  ADD COLUMN "previous_content_status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "previous_moderation_status" "ModerationStatus" NOT NULL DEFAULT 'NOT_REVIEWED';

CREATE TABLE "listing_revisions" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "evaluation_id" UUID,
  "revision_number" INTEGER NOT NULL,
  "base_listing_version" INTEGER NOT NULL,
  "result_listing_version" INTEGER NOT NULL,
  "classification" "ListingRevisionClassification" NOT NULL,
  "reason_codes" VARCHAR(80)[] NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" CHAR(64) NOT NULL,
  "diff" JSONB NOT NULL,
  "diff_hash" CHAR(64) NOT NULL,
  "risk_tier" "ModerationRiskTier" NOT NULL,
  "rule_set_key" VARCHAR(80) NOT NULL,
  "rule_set_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "original_published_at" TIMESTAMPTZ(6),
  "original_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "listing_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_revisions_number_check"
    CHECK ("revision_number" >= 1),
  CONSTRAINT "listing_revisions_versions_check"
    CHECK (
      "base_listing_version" >= 1
      AND "result_listing_version" > "base_listing_version"
    ),
  CONSTRAINT "listing_revisions_reason_codes_check"
    CHECK (
      cardinality("reason_codes") BETWEEN 1 AND 20
      AND array_position("reason_codes", NULL) IS NULL
    ),
  CONSTRAINT "listing_revisions_snapshot_check"
    CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "listing_revisions_diff_check"
    CHECK (jsonb_typeof("diff") = 'array' AND jsonb_array_length("diff") BETWEEN 1 AND 50),
  CONSTRAINT "listing_revisions_hashes_check"
    CHECK (
      "snapshot_hash" ~ '^[0-9a-f]{64}$'
      AND "diff_hash" ~ '^[0-9a-f]{64}$'
      AND "request_hash" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "listing_revisions_rule_set_check"
    CHECK (
      char_length(btrim("rule_set_key")) BETWEEN 1 AND 80
      AND "rule_set_version" >= 1
    ),
  CONSTRAINT "listing_revisions_publication_check"
    CHECK (
      (
        "classification" = 'SUBMISSION'::"ListingRevisionClassification"
        AND "original_published_at" IS NULL
        AND "original_expires_at" IS NULL
      )
      OR
      (
        "classification" IN (
          'MINOR_EDIT'::"ListingRevisionClassification",
          'MAJOR_EDIT'::"ListingRevisionClassification"
        )
        AND "original_published_at" IS NOT NULL
        AND "original_expires_at" IS NOT NULL
        AND "original_expires_at" > "original_published_at"
      )
    ),
  CONSTRAINT "listing_revisions_minor_risk_check"
    CHECK (
      "classification" <> 'MINOR_EDIT'::"ListingRevisionClassification"
      OR "risk_tier" = 'LOW'::"ModerationRiskTier"
    )
);

CREATE UNIQUE INDEX "listing_revisions_evaluation_id_key"
ON "listing_revisions" ("evaluation_id");

CREATE UNIQUE INDEX "listing_revisions_actor_user_id_idempotency_key_key"
ON "listing_revisions" ("actor_user_id", "idempotency_key");

CREATE UNIQUE INDEX "listing_revisions_listing_id_revision_number_key"
ON "listing_revisions" ("listing_id", "revision_number");

CREATE UNIQUE INDEX "listing_revisions_listing_id_result_listing_version_key"
ON "listing_revisions" ("listing_id", "result_listing_version");

CREATE INDEX "listing_revisions_listing_id_created_at_idx"
ON "listing_revisions" ("listing_id", "created_at" DESC);

CREATE INDEX "listing_revisions_classification_created_at_idx"
ON "listing_revisions" ("classification", "created_at" DESC);

ALTER TABLE "listing_revisions"
  ADD CONSTRAINT "listing_revisions_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "listing_revisions_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "listing_revisions_evaluation_id_fkey"
    FOREIGN KEY ("evaluation_id") REFERENCES "moderation_evaluations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_listing_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'listing revision evidence is immutable';
END;
$$;

CREATE TRIGGER "listing_revisions_immutable"
BEFORE UPDATE OR DELETE ON "listing_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_listing_revision_mutation();
