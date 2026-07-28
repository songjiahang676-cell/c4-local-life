-- EVT-001: state coherence and claim-path index for the production outbox dispatcher.
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_check"
    CHECK ("attempts" BETWEEN 0 AND 100),
  ADD CONSTRAINT "outbox_events_event_type_check"
    CHECK ("event_type" ~ '^[a-z][a-z0-9.-]{0,79}$'),
  ADD CONSTRAINT "outbox_events_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "published_at" IS NULL
    )
    OR (
      "status" = 'PUBLISHED'
      AND "published_at" IS NOT NULL
      AND "published_at" >= "created_at"
      AND "last_error" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "published_at" IS NULL
      AND "last_error" IS NOT NULL
    )
  );

CREATE INDEX "outbox_events_pending_available_id_idx"
  ON "outbox_events" ("available_at", "id")
  WHERE "status" = 'PENDING';
