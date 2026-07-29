-- migration-safety: additive search dictionary and privacy-threshold sample tables only; rollback preserves sampled queries until retention expiry and is documented in ROLLBACK.md

CREATE TABLE "search_dictionary_states" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "current_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "search_dictionary_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_dictionary_states_singleton_check"
    CHECK ("id" = 'default' AND "current_version" >= 0)
);

INSERT INTO "search_dictionary_states" ("id", "current_version", "updated_at")
VALUES ('default', 0, CURRENT_TIMESTAMP);

CREATE TABLE "search_dictionary_versions" (
  "id" UUID NOT NULL,
  "dictionary_id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "definition" JSONB NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "based_on_version" INTEGER,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "published_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "published_at" TIMESTAMPTZ(6),

  CONSTRAINT "search_dictionary_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_dictionary_versions_version_check"
    CHECK (
      "version" >= 1
      AND "revision" >= 1
      AND ("based_on_version" IS NULL OR "based_on_version" < "version")
    ),
  CONSTRAINT "search_dictionary_versions_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "search_dictionary_versions_publication_check"
    CHECK (
      ("published_at" IS NULL AND "published_by_id" IS NULL)
      OR ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "search_dictionary_versions_dictionary_id_version_key"
ON "search_dictionary_versions" ("dictionary_id", "version");

CREATE UNIQUE INDEX "search_dictionary_versions_one_draft_key"
ON "search_dictionary_versions" ("dictionary_id")
WHERE "published_at" IS NULL;

CREATE INDEX "search_dictionary_versions_dictionary_id_published_at_idx"
ON "search_dictionary_versions" ("dictionary_id", "published_at" DESC);

ALTER TABLE "search_dictionary_versions"
  ADD CONSTRAINT "search_dictionary_versions_dictionary_id_fkey"
    FOREIGN KEY ("dictionary_id") REFERENCES "search_dictionary_states"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_published_search_dictionary_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published search dictionary versions are immutable';
  END IF;
  IF (
    NEW."dictionary_id",
    NEW."version",
    NEW."created_by_id",
    NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."dictionary_id",
    OLD."version",
    OLD."created_by_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'search dictionary version identity is immutable';
  END IF;
  IF NEW."published_at" IS NOT NULL
    AND (
      NEW."definition",
      NEW."content_hash",
      NEW."based_on_version",
      NEW."revision"
    ) IS DISTINCT FROM (
      OLD."definition",
      OLD."content_hash",
      OLD."based_on_version",
      OLD."revision"
    )
  THEN
    RAISE EXCEPTION 'search dictionary publication cannot rewrite draft content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "search_dictionary_versions_immutable"
BEFORE UPDATE ON "search_dictionary_versions"
FOR EACH ROW EXECUTE FUNCTION reject_published_search_dictionary_mutation();

CREATE FUNCTION reject_published_search_dictionary_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published search dictionary versions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "search_dictionary_versions_no_published_delete"
BEFORE DELETE ON "search_dictionary_versions"
FOR EACH ROW EXECUTE FUNCTION reject_published_search_dictionary_delete();

CREATE TABLE "search_query_samples" (
  "id" UUID NOT NULL,
  "query_hash" CHAR(64) NOT NULL,
  "source_hash" CHAR(64) NOT NULL,
  "query_text" VARCHAR(120) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "region_code" VARCHAR(80),
  "window_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "search_query_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_query_samples_hashes_check"
    CHECK (
      "query_hash" ~ '^[0-9a-f]{64}$'
      AND "source_hash" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "search_query_samples_locale_check"
    CHECK ("locale" IN ('zh-Hans', 'en-US')),
  CONSTRAINT "search_query_samples_region_code_check"
    CHECK (
      "region_code" IS NULL
      OR (
        char_length("region_code") BETWEEN 2 AND 80
        AND "region_code" ~ '^[A-Za-z0-9._:-]+$'
      )
    ),
  CONSTRAINT "search_query_samples_text_check"
    CHECK (char_length("query_text") BETWEEN 1 AND 120),
  CONSTRAINT "search_query_samples_window_check"
    CHECK ("window_date" = (timezone('UTC', "created_at"))::date),
  CONSTRAINT "search_query_samples_retention_check"
    CHECK (
      "expires_at" > "created_at"
      AND "expires_at" <= "created_at" + INTERVAL '90 days'
    )
);

CREATE UNIQUE INDEX "search_query_samples_query_hash_source_hash_window_date_key"
ON "search_query_samples" ("query_hash", "source_hash", "window_date");

CREATE INDEX "search_query_samples_query_hash_locale_region_code_created_at_idx"
ON "search_query_samples" ("query_hash", "locale", "region_code", "created_at" DESC);

CREATE INDEX "search_query_samples_locale_region_code_created_at_idx"
ON "search_query_samples" ("locale", "region_code", "created_at" DESC);

CREATE INDEX "search_query_samples_expires_at_id_idx"
ON "search_query_samples" ("expires_at", "id");
