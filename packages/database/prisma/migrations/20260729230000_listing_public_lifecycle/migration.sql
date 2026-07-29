CREATE INDEX "listings_rental_expiry_due_idx"
ON "listings" ("expires_at" ASC, "id" ASC)
WHERE
  "type" = 'RENTAL'::"ListingType"
  AND "status" = 'PUBLISHED'::"ContentStatus"
  AND "moderation_status" IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND "deleted_at" IS NULL;
