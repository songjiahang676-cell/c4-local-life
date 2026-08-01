-- migration-safety: additive queue control-plane tables and enums only; no event payload is copied into DLQ evidence

CREATE TYPE "AdminJobType" AS ENUM ('QUEUE_REPLAY', 'QUEUE_RECONCILIATION');
CREATE TYPE "AdminJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "AdminJobItemStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'SKIPPED', 'FAILED');
CREATE TYPE "DeadLetterSource" AS ENUM ('OUTBOX', 'QUEUE');
CREATE TYPE "QueueDeadLetterStatus" AS ENUM ('OPEN', 'REPLAY_PENDING', 'RESOLVED');

CREATE TABLE "admin_jobs" (
  "id" UUID NOT NULL,
  "type" "AdminJobType" NOT NULL,
  "status" "AdminJobStatus" NOT NULL DEFAULT 'PENDING',
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "reason_code" VARCHAR(80) NOT NULL,
  "ticket_ref" VARCHAR(120),
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "estimated_items" INTEGER NOT NULL DEFAULT 0,
  "processed_items" INTEGER NOT NULL DEFAULT 0,
  "succeeded_items" INTEGER NOT NULL DEFAULT 0,
  "skipped_items" INTEGER NOT NULL DEFAULT 0,
  "failed_items" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_expires_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "admin_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_jobs_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "admin_jobs_reason_code_check" CHECK ("reason_code" ~ '^[A-Z][A-Z0-9_.-]{1,79}$'),
  CONSTRAINT "admin_jobs_counts_check" CHECK (
    "estimated_items" >= 0
    AND "processed_items" >= 0
    AND "succeeded_items" >= 0
    AND "skipped_items" >= 0
    AND "failed_items" >= 0
    AND "processed_items" = "succeeded_items" + "skipped_items" + "failed_items"
    AND "processed_items" <= "estimated_items"
  ),
  CONSTRAINT "admin_jobs_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "started_at" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "completed_at" IS NULL)
    OR ("status" IN ('SUCCEEDED', 'PARTIAL', 'FAILED') AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "admin_jobs_actor_id_type_idempotency_key_key"
ON "admin_jobs" ("actor_id", "type", "idempotency_key");

CREATE INDEX "admin_jobs_status_available_at_id_idx"
ON "admin_jobs" ("status", "available_at", "id");

CREATE INDEX "admin_jobs_actor_id_created_at_idx"
ON "admin_jobs" ("actor_id", "created_at" DESC);

CREATE TABLE "admin_job_items" (
  "id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "source" "DeadLetterSource" NOT NULL,
  "target_id" UUID NOT NULL,
  "status" "AdminJobItemStatus" NOT NULL DEFAULT 'PENDING',
  "error_code" VARCHAR(120),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_job_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_job_items_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "completed_at" IS NULL AND "error_code" IS NULL)
    OR ("status" IN ('SUCCEEDED', 'SKIPPED') AND "completed_at" IS NOT NULL AND "error_code" IS NULL)
    OR ("status" = 'FAILED' AND "completed_at" IS NOT NULL AND "error_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "admin_job_items_job_id_source_target_id_key"
ON "admin_job_items" ("job_id", "source", "target_id");

CREATE INDEX "admin_job_items_job_id_status_id_idx"
ON "admin_job_items" ("job_id", "status", "id");

CREATE TABLE "queue_dead_letters" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "queue_name" VARCHAR(80) NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  "failure_code" VARCHAR(120) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "status" "QueueDeadLetterStatus" NOT NULL DEFAULT 'OPEN',
  "first_failed_at" TIMESTAMPTZ(6) NOT NULL,
  "last_failed_at" TIMESTAMPTZ(6) NOT NULL,
  "replay_count" INTEGER NOT NULL DEFAULT 0,
  "last_replay_batch_id" UUID,
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "queue_dead_letters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "queue_dead_letters_attempts_check" CHECK ("attempt_count" >= 1 AND "replay_count" >= 0),
  CONSTRAINT "queue_dead_letters_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "queue_dead_letters_failure_code_check" CHECK ("failure_code" ~ '^[A-Z][A-Z0-9_.-]{1,119}$'),
  CONSTRAINT "queue_dead_letters_lifecycle_check" CHECK (
    ("status" <> 'RESOLVED' AND "resolved_at" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "queue_dead_letters_queue_name_event_id_key"
ON "queue_dead_letters" ("queue_name", "event_id");

CREATE INDEX "queue_dead_letters_status_last_failed_at_id_idx"
ON "queue_dead_letters" ("status", "last_failed_at" DESC, "id");

CREATE INDEX "queue_dead_letters_event_type_status_last_failed_at_idx"
ON "queue_dead_letters" ("event_type", "status", "last_failed_at" DESC);

ALTER TABLE "admin_jobs"
  ADD CONSTRAINT "admin_jobs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_job_items"
  ADD CONSTRAINT "admin_job_items_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "admin_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
