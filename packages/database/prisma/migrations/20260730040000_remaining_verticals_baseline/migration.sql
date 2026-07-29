ALTER TABLE "transfer_details"
ADD CONSTRAINT "transfer_details_core_fields_coherent"
CHECK (
  (
    "business_type" IS NULL
    AND "asking_price" IS NULL
    AND "monthly_rent" IS NULL
    AND "lease_remaining_months" IS NULL
    AND "reason_for_transfer" IS NULL
  )
  OR
  (
    btrim("business_type") <> ''
    AND "asking_price" > 0
    AND "monthly_rent" >= 0
    AND "lease_remaining_months" BETWEEN 0 AND 1200
    AND btrim("reason_for_transfer") <> ''
  )
);

ALTER TABLE "secondhand_details"
ADD CONSTRAINT "secondhand_details_core_fields_coherent"
CHECK (
  (
    "condition" IS NULL
    AND "delivery_options" IS NULL
  )
  OR
  (
    "condition" IN ('new', 'like-new', 'good', 'fair')
    AND jsonb_typeof("delivery_options") = 'array'
    AND jsonb_array_length("delivery_options") > 0
  )
);

ALTER TABLE "secondhand_details"
ADD CONSTRAINT "secondhand_details_optional_text_nonblank"
CHECK (
  ("brand" IS NULL OR btrim("brand") <> '')
  AND ("model" IS NULL OR btrim("model") <> '')
);

ALTER TABLE "service_details"
ADD CONSTRAINT "service_details_core_fields_coherent"
CHECK (
  (
    "service_radius_miles" IS NULL
    AND "availability" IS NULL
  )
  OR
  (
    "service_radius_miles" BETWEEN 1 AND 100
    AND jsonb_typeof("availability") = 'array'
    AND jsonb_array_length("availability") > 0
  )
);

ALTER TABLE "service_details"
ADD CONSTRAINT "service_details_license_nonblank"
CHECK ("license_number" IS NULL OR btrim("license_number") <> '');

CREATE INDEX "listings_transfer_expiry_due_idx"
ON "listings" ("expires_at" ASC, "id" ASC)
WHERE
  "type" = 'TRANSFER'::"ListingType"
  AND "status" = 'PUBLISHED'::"ContentStatus"
  AND "moderation_status" IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND "deleted_at" IS NULL;

CREATE INDEX "listings_secondhand_expiry_due_idx"
ON "listings" ("expires_at" ASC, "id" ASC)
WHERE
  "type" = 'SECONDHAND'::"ListingType"
  AND "status" = 'PUBLISHED'::"ContentStatus"
  AND "moderation_status" IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND "deleted_at" IS NULL;

CREATE INDEX "listings_service_expiry_due_idx"
ON "listings" ("expires_at" ASC, "id" ASC)
WHERE
  "type" = 'SERVICE'::"ListingType"
  AND "status" = 'PUBLISHED'::"ContentStatus"
  AND "moderation_status" IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND "deleted_at" IS NULL;
