CREATE TYPE "ModerationRiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "moderation_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "listing_version" INTEGER NOT NULL,
  "rule_set_key" VARCHAR(80) NOT NULL,
  "rule_set_version" INTEGER NOT NULL,
  "risk_tier" "ModerationRiskTier" NOT NULL,
  "input_hash" CHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "result_content_status" "ContentStatus" NOT NULL,
  "result_moderation_status" "ModerationStatus" NOT NULL,
  "result_listing_version" INTEGER NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_evaluations_versions_check"
    CHECK ("listing_version" > 0 AND "rule_set_version" > 0 AND "result_listing_version" > "listing_version"),
  CONSTRAINT "moderation_evaluations_codes_check"
    CHECK ("rule_set_key" ~ '^[a-z][a-z0-9-]{2,79}$'),
  CONSTRAINT "moderation_evaluations_hashes_check"
    CHECK (
      "input_hash" ~ '^[0-9a-f]{64}$'
      AND "request_hash" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "moderation_evaluations_result_check"
    CHECK (
      (
        "risk_tier" = 'LOW'::"ModerationRiskTier"
        AND "result_content_status" = 'PUBLISHED'::"ContentStatus"
        AND "result_moderation_status" = 'AUTO_APPROVED'::"ModerationStatus"
      )
      OR (
        "risk_tier" = 'MEDIUM'::"ModerationRiskTier"
        AND "result_content_status" = 'SUBMITTED'::"ContentStatus"
        AND "result_moderation_status" = 'PENDING_REVIEW'::"ModerationStatus"
      )
      OR (
        "risk_tier" = 'HIGH'::"ModerationRiskTier"
        AND "result_content_status" = 'SUBMITTED'::"ContentStatus"
        AND "result_moderation_status" = 'ESCALATED'::"ModerationStatus"
      )
    )
);

CREATE TABLE "moderation_rule_hits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "evaluation_id" UUID NOT NULL,
  "rule_code" VARCHAR(80) NOT NULL,
  "rule_version" INTEGER NOT NULL,
  "severity" "ModerationRiskTier" NOT NULL,
  "evidence_key" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_rule_hits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_rule_hits_version_check" CHECK ("rule_version" > 0),
  CONSTRAINT "moderation_rule_hits_codes_check"
    CHECK (
      "rule_code" ~ '^[A-Z][A-Z0-9_]{2,79}$'
      AND "evidence_key" ~ '^[a-z][a-z0-9_]{2,79}$'
    )
);

CREATE UNIQUE INDEX "moderation_evaluations_actor_user_id_idempotency_key_key"
  ON "moderation_evaluations"("actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "moderation_evaluations_listing_id_listing_version_key"
  ON "moderation_evaluations"("listing_id", "listing_version");
CREATE INDEX "moderation_evaluations_listing_id_created_at_idx"
  ON "moderation_evaluations"("listing_id", "created_at" DESC);
CREATE INDEX "moderation_evaluations_risk_tier_created_at_idx"
  ON "moderation_evaluations"("risk_tier", "created_at" DESC);
CREATE UNIQUE INDEX "moderation_rule_hits_evaluation_id_rule_code_key"
  ON "moderation_rule_hits"("evaluation_id", "rule_code");
CREATE INDEX "moderation_rule_hits_rule_code_created_at_idx"
  ON "moderation_rule_hits"("rule_code", "created_at" DESC);

ALTER TABLE "moderation_evaluations"
  ADD CONSTRAINT "moderation_evaluations_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_evaluations_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "moderation_rule_hits"
  ADD CONSTRAINT "moderation_rule_hits_evaluation_id_fkey"
  FOREIGN KEY ("evaluation_id") REFERENCES "moderation_evaluations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "moderation_cases"
  ADD COLUMN "evaluation_id" UUID;
CREATE UNIQUE INDEX "moderation_cases_evaluation_id_key"
  ON "moderation_cases"("evaluation_id");
ALTER TABLE "moderation_cases"
  ADD CONSTRAINT "moderation_cases_evaluation_id_fkey"
  FOREIGN KEY ("evaluation_id") REFERENCES "moderation_evaluations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_moderation_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'moderation evaluation evidence is immutable';
END;
$$;

CREATE TRIGGER "moderation_evaluations_immutable"
BEFORE UPDATE OR DELETE ON "moderation_evaluations"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_evidence_mutation();

CREATE TRIGGER "moderation_rule_hits_immutable"
BEFORE UPDATE OR DELETE ON "moderation_rule_hits"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_evidence_mutation();
