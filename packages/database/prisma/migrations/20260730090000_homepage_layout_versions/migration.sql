-- migration-safety: additive homepage layout state/version tables only; published history is immutable and rollback is documented in ROLLBACK.md

CREATE TABLE "homepage_layout_states" (
  "id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "region_code" VARCHAR(80) NOT NULL,
  "current_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "homepage_layout_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "homepage_layout_states_scope_check"
    CHECK (
      "locale" IN ('zh-Hans', 'en-US')
      AND char_length("region_code") BETWEEN 2 AND 80
      AND "region_code" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      AND "current_version" >= 0
    )
);

CREATE UNIQUE INDEX "homepage_layout_states_locale_region_code_key"
ON "homepage_layout_states" ("locale", "region_code");

CREATE TABLE "homepage_layout_versions" (
  "id" UUID NOT NULL,
  "layout_id" UUID NOT NULL,
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

  CONSTRAINT "homepage_layout_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "homepage_layout_versions_version_check"
    CHECK (
      "version" >= 1
      AND "revision" >= 1
      AND ("based_on_version" IS NULL OR "based_on_version" < "version")
    ),
  CONSTRAINT "homepage_layout_versions_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "homepage_layout_versions_publication_check"
    CHECK (
      ("published_at" IS NULL AND "published_by_id" IS NULL)
      OR ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "homepage_layout_versions_layout_id_version_key"
ON "homepage_layout_versions" ("layout_id", "version");

CREATE UNIQUE INDEX "homepage_layout_versions_one_draft_key"
ON "homepage_layout_versions" ("layout_id")
WHERE "published_at" IS NULL;

CREATE INDEX "homepage_layout_versions_layout_id_published_at_idx"
ON "homepage_layout_versions" ("layout_id", "published_at" DESC);

ALTER TABLE "homepage_layout_versions"
  ADD CONSTRAINT "homepage_layout_versions_layout_id_fkey"
    FOREIGN KEY ("layout_id") REFERENCES "homepage_layout_states"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_published_homepage_layout_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published homepage layout versions are immutable';
  END IF;
  IF (
    NEW."layout_id",
    NEW."version",
    NEW."created_by_id",
    NEW."created_at"
  ) IS DISTINCT FROM (
    OLD."layout_id",
    OLD."version",
    OLD."created_by_id",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'homepage layout version identity is immutable';
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
    RAISE EXCEPTION 'homepage layout publication cannot rewrite draft content';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "homepage_layout_versions_immutable"
BEFORE UPDATE ON "homepage_layout_versions"
FOR EACH ROW EXECUTE FUNCTION reject_published_homepage_layout_mutation();

CREATE FUNCTION reject_published_homepage_layout_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published homepage layout versions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "homepage_layout_versions_no_published_delete"
BEFORE DELETE ON "homepage_layout_versions"
FOR EACH ROW EXECUTE FUNCTION reject_published_homepage_layout_delete();
