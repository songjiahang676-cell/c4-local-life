-- migration-safety: allow ADD_REQUIRED_COLUMN reason="Existing assets receive a deterministic zero sort order while listing_id remains nullable" rollback="The prior application ignores both additive columns and physical rollback follows the migration-local ROLLBACK.md"
ALTER TABLE "media_assets"
  ADD COLUMN "listing_id" UUID,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_listing_binding_check"
  CHECK (
    "listing_id" IS NULL
    OR (
      "purpose" = 'LISTING_MEDIA'::"MediaPurpose"
      AND "kind" = 'IMAGE'::"MediaKind"
      AND "status" = 'READY'::"MediaStatus"
    )
  );

CREATE INDEX "media_assets_listing_id_sort_order_idx"
  ON "media_assets"("listing_id", "sort_order");
