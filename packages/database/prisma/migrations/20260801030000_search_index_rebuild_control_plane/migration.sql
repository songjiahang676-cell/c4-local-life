-- migration-safety: additive search rebuild control-plane state only; PostgreSQL remains canonical and no Listing content is copied

ALTER TYPE "AdminJobType" ADD VALUE IF NOT EXISTS 'SEARCH_INDEX_REBUILD';
ALTER TYPE "AdminJobType" ADD VALUE IF NOT EXISTS 'SEARCH_INDEX_ROLLBACK';

CREATE TYPE "SearchIndexOperationPhase" AS ENUM (
  'PENDING',
  'BACKFILLING',
  'CATCHING_UP',
  'VALIDATING',
  'SWITCHING',
  'OBSERVING',
  'SUCCEEDED',
  'FAILED',
  'ROLLED_BACK'
);

CREATE TABLE "search_index_operations" (
  "id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "parent_operation_id" UUID,
  "phase" "SearchIndexOperationPhase" NOT NULL DEFAULT 'PENDING',
  "schema_version" INTEGER NOT NULL,
  "source_index" VARCHAR(255),
  "target_index" VARCHAR(255),
  "scan_cursor" UUID,
  "rollback_window_hours" INTEGER NOT NULL DEFAULT 24,
  "canonical_count" INTEGER,
  "target_count" INTEGER,
  "canonical_digest" CHAR(64),
  "target_digest" CHAR(64),
  "alias_switched_at" TIMESTAMPTZ(6),
  "rollback_until" TIMESTAMPTZ(6),
  "rolled_back_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "search_index_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_index_operations_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "search_index_operations_rollback_window_check" CHECK (
    "rollback_window_hours" BETWEEN 1 AND 168
  ),
  CONSTRAINT "search_index_operations_index_names_check" CHECK (
    ("source_index" IS NULL OR "source_index" ~ '^[a-z][a-z0-9_-]{1,254}$')
    AND ("target_index" IS NULL OR "target_index" ~ '^[a-z][a-z0-9_-]{1,254}$')
    AND ("source_index" IS NULL OR "target_index" IS NULL OR "source_index" <> "target_index")
  ),
  CONSTRAINT "search_index_operations_validation_check" CHECK (
    ("canonical_count" IS NULL AND "target_count" IS NULL AND "canonical_digest" IS NULL AND "target_digest" IS NULL)
    OR (
      "canonical_count" >= 0
      AND "target_count" >= 0
      AND "canonical_digest" ~ '^[0-9a-f]{64}$'
      AND "target_digest" ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "search_index_operations_failure_code_check" CHECK (
    "failure_code" IS NULL OR "failure_code" ~ '^[A-Z][A-Z0-9_.-]{1,119}$'
  ),
  CONSTRAINT "search_index_operations_phase_check" CHECK (
    ("phase" = 'PENDING' AND "failure_code" IS NULL)
    OR (
      "phase" IN ('BACKFILLING', 'CATCHING_UP', 'VALIDATING', 'SWITCHING')
      AND "source_index" IS NOT NULL
      AND "target_index" IS NOT NULL
      AND "failure_code" IS NULL
    )
    OR (
      "phase" = 'OBSERVING'
      AND "source_index" IS NOT NULL
      AND "target_index" IS NOT NULL
      AND "alias_switched_at" IS NOT NULL
      AND "rollback_until" > "alias_switched_at"
      AND "failure_code" IS NULL
    )
    OR (
      "phase" = 'SUCCEEDED'
      AND "source_index" IS NOT NULL
      AND "target_index" IS NOT NULL
      AND "alias_switched_at" IS NOT NULL
      AND "failure_code" IS NULL
    )
    OR ("phase" = 'FAILED' AND "failure_code" IS NOT NULL)
    OR ("phase" = 'ROLLED_BACK' AND "rolled_back_at" IS NOT NULL AND "failure_code" IS NULL)
  )
);

CREATE UNIQUE INDEX "search_index_operations_job_id_key"
ON "search_index_operations" ("job_id");

CREATE INDEX "search_index_operations_phase_updated_at_id_idx"
ON "search_index_operations" ("phase", "updated_at", "id");

CREATE INDEX "search_index_operations_parent_operation_id_created_at_idx"
ON "search_index_operations" ("parent_operation_id", "created_at" DESC);

ALTER TABLE "search_index_operations"
  ADD CONSTRAINT "search_index_operations_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "admin_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "search_index_operations"
  ADD CONSTRAINT "search_index_operations_parent_operation_id_fkey"
  FOREIGN KEY ("parent_operation_id") REFERENCES "search_index_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
