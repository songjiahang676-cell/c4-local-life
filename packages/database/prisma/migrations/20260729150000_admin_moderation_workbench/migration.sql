-- migration-safety: allow ADD_REQUIRED_COLUMN reason="the constant version default makes every existing case valid during the additive rollout" rollback="remove the additive version column before deploying code that reads it"
ALTER TABLE "moderation_cases"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "moderation_actions"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "request_hash" CHAR(64);

CREATE TABLE "moderation_case_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "listing_version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" CHAR(64) NOT NULL,
  "captured_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "moderation_case_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_case_snapshots_listing_version_check" CHECK ("listing_version" > 0),
  CONSTRAINT "moderation_case_snapshots_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "moderation_case_snapshots_hash_check"
    CHECK ("snapshot_hash" ~ '^[0-9a-f]{64}$')
);

WITH snapshot_payloads AS (
  SELECT
    moderation_case."id" AS "case_id",
    evaluation."result_listing_version" AS "listing_version",
    moderation_case."created_at" AS "captured_at",
    jsonb_build_object(
      'listingId', listing."id",
      'listingVersion', evaluation."result_listing_version",
      'type', listing."type"::text,
      'locale', listing."locale",
      'title', listing."title",
      'summary', to_jsonb(listing."summary"),
      'body', listing."body",
      'price',
        CASE
          WHEN listing."price_unit" IS NULL THEN 'null'::jsonb
          ELSE jsonb_build_object(
            'amount',
              CASE
                WHEN listing."price_amount" IS NULL THEN NULL
                ELSE listing."price_amount"::text
              END,
            'currency', listing."currency",
            'unit', listing."price_unit"::text
          )
        END,
      'attributes', '{}'::jsonb,
      'contactMode', listing."contact_mode"::text,
      'locationPrecision', listing."location_precision",
      'mediaIds',
        COALESCE(
          (
            SELECT jsonb_agg(media."id" ORDER BY media."sort_order", media."id")
            FROM "media_assets" media
            WHERE media."listing_id" = listing."id"
          ),
          '[]'::jsonb
        ),
      'category', jsonb_build_object(
        'id', category."id",
        'code', category."slug",
        'nameZhHans', category."name_zh_hans",
        'nameEn', category."name_en"
      ),
      'region', jsonb_build_object(
        'id', region."id",
        'code', region."code",
        'nameZhHans', region."name_zh_hans",
        'nameEn', region."name_en"
      ),
      'formSchemaVersion', listing."form_schema_version",
      'defaultLifetimeDays',
        CASE
          WHEN form_schema."definition" #>> '{publicationPolicy,defaultLifetimeDays}' ~ '^[0-9]{1,3}$'
            THEN LEAST(
              365,
              GREATEST(
                1,
                (form_schema."definition" #>> '{publicationPolicy,defaultLifetimeDays}')::integer
              )
            )
          ELSE 30
        END,
      'sensitiveFieldsRedacted', true,
      'capturedAt', to_jsonb(moderation_case."created_at")
    ) AS "payload"
  FROM "moderation_cases" moderation_case
  JOIN "moderation_evaluations" evaluation
    ON evaluation."id" = moderation_case."evaluation_id"
  JOIN "listings" listing
    ON listing."id" = moderation_case."target_id"
  JOIN "categories" category
    ON category."id" = listing."category_id"
  JOIN "regions" region
    ON region."id" = listing."region_id"
  JOIN "category_form_schema_versions" form_schema
    ON form_schema."category_id" = listing."category_id"
   AND form_schema."version" = listing."form_schema_version"
  WHERE moderation_case."target_type" = 'LISTING'
)
INSERT INTO "moderation_case_snapshots" (
  "case_id",
  "listing_version",
  "snapshot",
  "snapshot_hash",
  "captured_at"
)
SELECT
  "case_id",
  "listing_version",
  "payload",
  encode(sha256(convert_to("payload"::text, 'UTF8')), 'hex'),
  "captured_at"
FROM snapshot_payloads;

CREATE UNIQUE INDEX "moderation_case_snapshots_case_id_key"
  ON "moderation_case_snapshots"("case_id");
CREATE INDEX "moderation_case_snapshots_captured_at_idx"
  ON "moderation_case_snapshots"("captured_at" DESC);
CREATE UNIQUE INDEX "moderation_actions_actor_id_idempotency_key_key"
  ON "moderation_actions"("actor_id", "idempotency_key");

ALTER TABLE "moderation_cases"
  ADD CONSTRAINT "moderation_cases_version_check" CHECK ("version" > 0);

ALTER TABLE "moderation_actions"
  ADD CONSTRAINT "moderation_actions_idempotency_check"
    CHECK (
      ("idempotency_key" IS NULL AND "request_hash" IS NULL)
      OR (
        "idempotency_key" IS NOT NULL
        AND "request_hash" IS NOT NULL
        AND "request_hash" ~ '^[0-9a-f]{64}$'
      )
    );

ALTER TABLE "moderation_case_snapshots"
  ADD CONSTRAINT "moderation_case_snapshots_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_moderation_workbench_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'moderation workbench evidence is immutable';
END;
$$;

CREATE TRIGGER "moderation_case_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "moderation_case_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_workbench_evidence_mutation();

CREATE TRIGGER "moderation_actions_immutable"
BEFORE UPDATE OR DELETE ON "moderation_actions"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_workbench_evidence_mutation();
