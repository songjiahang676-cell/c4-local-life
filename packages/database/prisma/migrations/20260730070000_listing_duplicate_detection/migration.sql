-- migration-safety: additive duplicate-detection evidence and media fingerprint columns only; rollback retains evidence by default and is documented in ROLLBACK.md

ALTER TABLE "media_assets"
  ADD COLUMN "perceptual_hash" CHAR(16);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_perceptual_hash_check"
    CHECK (
      "perceptual_hash" IS NULL
      OR (
        "status" IN ('READY'::"MediaStatus", 'DELETED'::"MediaStatus")
        AND "perceptual_hash" ~ '^[0-9a-f]{16}$'
      )
    );

CREATE TABLE "listing_contact_fingerprints" (
  "id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "listing_contact_fingerprints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listing_contact_fingerprints_value_check"
    CHECK ("fingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "listing_contact_fingerprints_listing_id_fingerprint_key"
ON "listing_contact_fingerprints" ("listing_id", "fingerprint");

CREATE INDEX "listing_contact_fingerprints_fingerprint_listing_id_idx"
ON "listing_contact_fingerprints" ("fingerprint", "listing_id");

ALTER TABLE "listing_contact_fingerprints"
  ADD CONSTRAINT "listing_contact_fingerprints_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "listings_type_created_at_idx"
ON "listings" ("type", "created_at" DESC);

CREATE FUNCTION socal_hamming_distance_hex64(left_hash text, right_hash text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  left_bytes bytea;
  right_bytes bytea;
  byte_index integer;
  distance integer := 0;
BEGIN
  IF left_hash !~ '^[0-9a-f]{16}$' OR right_hash !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'perceptual hashes must be lowercase 64-bit hex values';
  END IF;
  left_bytes := decode(left_hash, 'hex');
  right_bytes := decode(right_hash, 'hex');
  FOR byte_index IN 0..7 LOOP
    distance := distance
      + bit_count(((get_byte(left_bytes, byte_index) # get_byte(right_bytes, byte_index))::bit(8)));
  END LOOP;
  RETURN distance;
END;
$$;

CREATE TABLE "moderation_duplicate_candidates" (
  "id" UUID NOT NULL,
  "evaluation_id" UUID NOT NULL,
  "candidate_listing_id" UUID NOT NULL,
  "candidate_listing_version" INTEGER NOT NULL,
  "candidate_type" "ListingType" NOT NULL,
  "candidate_title" VARCHAR(120) NOT NULL,
  "candidate_status" "ContentStatus" NOT NULL,
  "threshold_version" INTEGER NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "confidence" VARCHAR(16) NOT NULL,
  "matched_signals" VARCHAR(24)[] NOT NULL,
  "title_score" DOUBLE PRECISION,
  "body_score" DOUBLE PRECISION,
  "image_distance" INTEGER,
  "contact_match_count" INTEGER NOT NULL DEFAULT 0,
  "review_outcome" VARCHAR(24) NOT NULL DEFAULT 'UNREVIEWED',
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "moderation_duplicate_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_duplicate_candidates_version_check"
    CHECK ("candidate_listing_version" >= 1 AND "threshold_version" >= 1),
  CONSTRAINT "moderation_duplicate_candidates_mode_check"
    CHECK ("mode" IN ('DRY_RUN', 'ENFORCE')),
  CONSTRAINT "moderation_duplicate_candidates_confidence_check"
    CHECK ("confidence" IN ('MEDIUM', 'HIGH')),
  CONSTRAINT "moderation_duplicate_candidates_signals_check"
    CHECK (
      cardinality("matched_signals") BETWEEN 1 AND 3
      AND "matched_signals" <@ ARRAY['TEXT', 'IMAGE', 'CONTACT']::VARCHAR(24)[]
      AND array_position("matched_signals", NULL) IS NULL
    ),
  CONSTRAINT "moderation_duplicate_candidates_scores_check"
    CHECK (
      ("title_score" IS NULL OR "title_score" BETWEEN 0 AND 1)
      AND ("body_score" IS NULL OR "body_score" BETWEEN 0 AND 1)
      AND ("image_distance" IS NULL OR "image_distance" BETWEEN 0 AND 64)
      AND "contact_match_count" BETWEEN 0 AND 20
    ),
  CONSTRAINT "moderation_duplicate_candidates_outcome_check"
    CHECK (
      ("review_outcome" = 'UNREVIEWED' AND "reviewed_at" IS NULL)
      OR (
        "review_outcome" IN ('CONFIRMED', 'FALSE_POSITIVE')
        AND "reviewed_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "moderation_duplicate_candidates_evaluation_id_candidate_listing_id_key"
ON "moderation_duplicate_candidates" ("evaluation_id", "candidate_listing_id");

CREATE INDEX "moderation_duplicate_candidates_candidate_listing_id_created_at_idx"
ON "moderation_duplicate_candidates" ("candidate_listing_id", "created_at" DESC);

CREATE INDEX "moderation_duplicate_candidates_review_outcome_created_at_idx"
ON "moderation_duplicate_candidates" ("review_outcome", "created_at" DESC);

ALTER TABLE "moderation_duplicate_candidates"
  ADD CONSTRAINT "moderation_duplicate_candidates_evaluation_id_fkey"
    FOREIGN KEY ("evaluation_id") REFERENCES "moderation_evaluations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_duplicate_candidates_candidate_listing_id_fkey"
    FOREIGN KEY ("candidate_listing_id") REFERENCES "listings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_moderation_duplicate_candidate_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."evaluation_id",
    NEW."candidate_listing_id",
    NEW."candidate_listing_version",
    NEW."candidate_type",
    NEW."candidate_title",
    NEW."candidate_status",
    NEW."threshold_version",
    NEW."mode",
    NEW."confidence",
    NEW."matched_signals",
    NEW."title_score",
    NEW."body_score",
    NEW."image_distance",
    NEW."contact_match_count",
    NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."evaluation_id",
    OLD."candidate_listing_id",
    OLD."candidate_listing_version",
    OLD."candidate_type",
    OLD."candidate_title",
    OLD."candidate_status",
    OLD."threshold_version",
    OLD."mode",
    OLD."confidence",
    OLD."matched_signals",
    OLD."title_score",
    OLD."body_score",
    OLD."image_distance",
    OLD."contact_match_count",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'duplicate candidate evidence is immutable';
  END IF;
  IF OLD."review_outcome" <> 'UNREVIEWED'
    AND (
      NEW."review_outcome",
      NEW."reviewed_at"
    ) IS DISTINCT FROM (
      OLD."review_outcome",
      OLD."reviewed_at"
    )
  THEN
    RAISE EXCEPTION 'duplicate candidate review outcome is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "moderation_duplicate_candidates_identity_immutable"
BEFORE UPDATE ON "moderation_duplicate_candidates"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_duplicate_candidate_identity_mutation();

CREATE FUNCTION reject_moderation_duplicate_candidate_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'duplicate candidate evidence cannot be deleted';
END;
$$;

CREATE TRIGGER "moderation_duplicate_candidates_no_delete"
BEFORE DELETE ON "moderation_duplicate_candidates"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_duplicate_candidate_delete();
