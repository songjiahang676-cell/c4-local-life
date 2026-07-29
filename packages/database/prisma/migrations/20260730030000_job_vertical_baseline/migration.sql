ALTER TABLE "job_details"
ADD CONSTRAINT "job_details_wage_range_coherent"
CHECK (
  (
    "wage_min" IS NULL
    AND "wage_max" IS NULL
    AND "wage_unit" IS NULL
  )
  OR
  (
    "wage_min" > 0
    AND "wage_max" >= "wage_min"
    AND "wage_unit" IN (
      'HOURLY'::"PriceUnit",
      'DAILY'::"PriceUnit",
      'WEEKLY'::"PriceUnit",
      'MONTHLY'::"PriceUnit",
      'YEARLY'::"PriceUnit"
    )
  )
);

ALTER TABLE "job_details"
ADD CONSTRAINT "job_details_text_fields_nonblank"
CHECK (
  ("employer_name" IS NULL OR btrim("employer_name") <> '')
  AND ("employment_type" IS NULL OR btrim("employment_type") <> '')
  AND ("experience_level" IS NULL OR btrim("experience_level") <> '')
  AND ("remote_type" IS NULL OR btrim("remote_type") <> '')
);

CREATE INDEX "listings_job_expiry_due_idx"
ON "listings" ("expires_at" ASC, "id" ASC)
WHERE
  "type" = 'JOB'::"ListingType"
  AND "status" = 'PUBLISHED'::"ContentStatus"
  AND "moderation_status" IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND "deleted_at" IS NULL;
