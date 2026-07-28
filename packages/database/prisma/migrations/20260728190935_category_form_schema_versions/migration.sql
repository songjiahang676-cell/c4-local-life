-- AlterTable
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="Searchability and visibility receive conservative defaults for existing materialized fields." rollback="Drop only these newly added columns before any dependent release writes them."
ALTER TABLE "category_fields" ADD COLUMN     "help_text" JSONB,
ADD COLUMN     "is_searchable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibility" VARCHAR(24) NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
-- migration-safety: allow ADD_REQUIRED_COLUMN reason="All existing listings predate schema versioning and therefore belong to baseline version 1." rollback="Drop the column only after stopping writers that persist form_schema_version."
ALTER TABLE "listings" ADD COLUMN     "form_schema_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "category_form_schema_versions" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "based_on_version" INTEGER,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "category_form_schema_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "category_form_schema_versions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "category_form_schema_versions_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "category_form_schema_versions_based_on_check" CHECK ("based_on_version" IS NULL OR ("based_on_version" >= 1 AND "based_on_version" < "version")),
    CONSTRAINT "category_form_schema_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "category_fields"
ADD CONSTRAINT "category_fields_visibility_check"
CHECK ("visibility" IN ('PUBLIC', 'OWNER_ONLY', 'MODERATOR_ONLY'));

-- CreateIndex
CREATE INDEX "category_form_schema_versions_category_id_published_at_idx" ON "category_form_schema_versions"("category_id", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "category_form_schema_versions_category_id_version_key" ON "category_form_schema_versions"("category_id", "version");

-- At most one unpublished draft may exist per category.
CREATE UNIQUE INDEX "category_form_schema_versions_one_draft_per_category"
ON "category_form_schema_versions" ("category_id")
WHERE "published_at" IS NULL;

-- AddForeignKey
ALTER TABLE "category_form_schema_versions" ADD CONSTRAINT "category_form_schema_versions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published definitions are append-only audit records. Rollback creates a new version.
CREATE FUNCTION "protect_published_category_form_schema"()
RETURNS trigger
LANGUAGE plpgsql
AS $form_schema_guard$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published category form schema versions are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$form_schema_guard$;

CREATE TRIGGER "category_form_schema_versions_immutable"
BEFORE UPDATE OR DELETE ON "category_form_schema_versions"
FOR EACH ROW
EXECUTE FUNCTION "protect_published_category_form_schema"();
