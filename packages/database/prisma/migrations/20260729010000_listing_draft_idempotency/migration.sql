ALTER TABLE "listings"
ADD COLUMN "create_idempotency_key" VARCHAR(128),
ADD COLUMN "create_request_hash" CHAR(64);

ALTER TABLE "listings"
ADD CONSTRAINT "listings_create_idempotency_evidence_check"
CHECK (
  (
    "create_idempotency_key" IS NULL
    AND "create_request_hash" IS NULL
  )
  OR
  (
    "create_idempotency_key" IS NOT NULL
    AND "create_request_hash" IS NOT NULL
    AND
    "create_idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'
    AND "create_request_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "listings_owner_id_create_idempotency_key_key"
ON "listings"("owner_id", "create_idempotency_key");
