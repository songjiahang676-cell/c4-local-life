-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM (
    'LISTING_MEDIA',
    'AVATAR',
    'BUSINESS_LOGO',
    'AD_CREATIVE',
    'VERIFICATION'
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "bucket" VARCHAR(63) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "upload_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_byte_size_check"
      CHECK ("byte_size" > 0 AND "byte_size" <= 20971520),
    CONSTRAINT "media_assets_sha256_check"
      CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_assets_request_hash_check"
      CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_assets_object_key_check"
      CHECK ("object_key" ~ '^quarantine/[0-9a-f]{2}/[0-9a-f-]{36}/original$')
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_owner_id_idempotency_key_key"
ON "media_assets"("owner_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "media_assets_owner_id_status_upload_expires_at_idx"
ON "media_assets"("owner_id", "status", "upload_expires_at");

-- CreateIndex
CREATE INDEX "media_assets_owner_id_created_at_idx"
ON "media_assets"("owner_id", "created_at");

-- AddForeignKey
ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
