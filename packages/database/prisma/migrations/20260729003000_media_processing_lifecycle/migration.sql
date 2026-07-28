-- MEDIA-002: durable media processing lifecycle and safe derivative metadata.
CREATE TYPE "MediaVariantKind" AS ENUM ('THUMBNAIL', 'CARD', 'FULL');

-- migration-safety: allow ADD_REQUIRED_COLUMN reason="Existing UPLOADING assets safely begin at lifecycle version zero through a constant default" rollback="The prior application ignores the additive version column while lifecycle evidence is retained"
ALTER TABLE "media_assets"
  ADD COLUMN "detected_mime_type" VARCHAR(120),
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN "scan_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "processed_at" TIMESTAMPTZ(6),
  ADD COLUMN "rejection_code" VARCHAR(64),
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "media_assets_lifecycle_version_check"
    CHECK ("lifecycle_version" BETWEEN 0 AND 2147483647),
  ADD CONSTRAINT "media_assets_dimensions_check"
    CHECK (
      ("width" IS NULL AND "height" IS NULL)
      OR ("width" > 0 AND "height" > 0)
    ),
  ADD CONSTRAINT "media_assets_rejection_code_check"
    CHECK (
      "rejection_code" IS NULL
      OR "rejection_code" ~ '^[A-Z][A-Z0-9_]{2,63}$'
    ),
  ADD CONSTRAINT "media_assets_lifecycle_state_check"
    CHECK (
      (
        "status" = 'UPLOADING'
        AND "uploaded_at" IS NULL
        AND "scan_started_at" IS NULL
        AND "processed_at" IS NULL
        AND "rejection_code" IS NULL
      )
      OR (
        "status" = 'SCANNING'
        AND "uploaded_at" IS NOT NULL
        AND "scan_started_at" IS NOT NULL
        AND "processed_at" IS NULL
        AND "rejection_code" IS NULL
      )
      OR (
        "status" = 'READY'
        AND "uploaded_at" IS NOT NULL
        AND "scan_started_at" IS NOT NULL
        AND "processed_at" IS NOT NULL
        AND "rejection_code" IS NULL
        AND "detected_mime_type" IS NOT NULL
        AND "width" IS NOT NULL
        AND "height" IS NOT NULL
      )
      OR (
        "status" = 'REJECTED'
        AND "processed_at" IS NOT NULL
        AND "rejection_code" IS NOT NULL
      )
      OR "status" = 'DELETED'
    ),
  ADD CONSTRAINT "media_assets_lifecycle_time_check"
    CHECK (
      ("uploaded_at" IS NULL OR "uploaded_at" >= "created_at")
      AND ("scan_started_at" IS NULL OR "scan_started_at" >= "uploaded_at")
      AND ("processed_at" IS NULL OR "processed_at" >= COALESCE("scan_started_at", "uploaded_at", "created_at"))
    );

CREATE TABLE "media_variants" (
  "id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "kind" "MediaVariantKind" NOT NULL,
  "bucket" VARCHAR(63) NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_variants_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 20971520),
  CONSTRAINT "media_variants_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "media_variants_dimensions_check" CHECK ("width" > 0 AND "height" > 0),
  CONSTRAINT "media_variants_mime_type_check" CHECK ("mime_type" = 'image/webp'),
  CONSTRAINT "media_variants_object_key_check"
    CHECK ("object_key" ~ '^processed/[0-9a-f]{2}/[0-9a-f-]{36}/(thumbnail|card|full)[.]webp$'),
  CONSTRAINT "media_variants_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "media_variants_object_key_key" ON "media_variants"("object_key");
CREATE UNIQUE INDEX "media_variants_media_asset_id_kind_key"
  ON "media_variants"("media_asset_id", "kind");
CREATE INDEX "media_variants_media_asset_id_idx" ON "media_variants"("media_asset_id");
CREATE INDEX "media_assets_processing_status_updated_at_idx"
  ON "media_assets"("status", "updated_at")
  WHERE "status" IN ('SCANNING', 'REJECTED');
