-- migration-safety: allow ADD_REQUIRED_COLUMN reason="legacy report rows receive deterministic internal retry keys before the columns become required" rollback="retain additive retry evidence and disable the new report writer; exceptional physical rollback is documented in ROLLBACK.md"
-- migration-safety: allow UPDATE_DATA reason="bounded legacy report backfill supplies retry evidence without changing report decisions" rollback="restore the pre-migration report export only in a stopped-writer pre-production recovery; otherwise correct forward"
-- migration-safety: allow SET_NOT_NULL reason="the immediately preceding deterministic backfill removes null retry evidence before the constraint is tightened" rollback="retain the required evidence columns and disable the new report writer; exceptional physical rollback is documented in ROLLBACK.md"

CREATE TYPE "ModerationAppealStatus" AS ENUM ('OPEN', 'UPHELD', 'RESTORED', 'CLOSED');

ALTER TABLE "reports"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "request_hash" CHAR(64);

UPDATE "reports"
SET
  "idempotency_key" = 'legacy:' || "id"::text,
  "request_hash" = md5("id"::text) || md5("id"::text)
WHERE "idempotency_key" IS NULL OR "request_hash" IS NULL;

ALTER TABLE "reports"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "request_hash" SET NOT NULL,
  ADD CONSTRAINT "reports_target_type_check"
    CHECK ("target_type" = 'LISTING'),
  ADD CONSTRAINT "reports_reason_code_check"
    CHECK (
      "reason_code" IN (
        'SCAM_OR_FRAUD',
        'PROHIBITED_CONTENT',
        'MISLEADING_INFORMATION',
        'HARASSMENT_OR_HATE',
        'PRIVACY_OR_CONTACT_ABUSE',
        'OTHER'
      )
    ),
  ADD CONSTRAINT "reports_details_check"
    CHECK ("details" IS NULL OR char_length(btrim("details")) BETWEEN 10 AND 2000),
  ADD CONSTRAINT "reports_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "reports_reporter_id_idempotency_key_key"
ON "reports" ("reporter_id", "idempotency_key");

CREATE UNIQUE INDEX "reports_active_reporter_target_key"
ON "reports" ("reporter_id", "target_type", "target_id")
WHERE
  "reporter_id" IS NOT NULL
  AND "status" IN ('OPEN'::"ReportStatus", 'TRIAGED'::"ReportStatus");

CREATE TABLE "moderation_appeals" (
  "id" UUID NOT NULL,
  "moderation_action_id" UUID NOT NULL,
  "appellant_id" UUID NOT NULL,
  "statement" VARCHAR(2000) NOT NULL,
  "status" "ModerationAppealStatus" NOT NULL DEFAULT 'OPEN',
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "decision_code" VARCHAR(80),
  "resolution_note" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(6),

  CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_appeals_statement_check"
    CHECK (char_length(btrim("statement")) BETWEEN 20 AND 2000),
  CONSTRAINT "moderation_appeals_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "moderation_appeals_resolution_check"
    CHECK (
      (
        "status" = 'OPEN'::"ModerationAppealStatus"
        AND "decision_code" IS NULL
        AND "resolution_note" IS NULL
        AND "resolved_at" IS NULL
      )
      OR
      (
        "status" IN (
          'UPHELD'::"ModerationAppealStatus",
          'RESTORED'::"ModerationAppealStatus",
          'CLOSED'::"ModerationAppealStatus"
        )
        AND "decision_code" IS NOT NULL
        AND "resolved_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "moderation_appeals_moderation_action_id_key"
ON "moderation_appeals" ("moderation_action_id");

CREATE UNIQUE INDEX "moderation_appeals_appellant_id_idempotency_key_key"
ON "moderation_appeals" ("appellant_id", "idempotency_key");

CREATE INDEX "moderation_appeals_status_created_at_idx"
ON "moderation_appeals" ("status", "created_at");

ALTER TABLE "moderation_appeals"
  ADD CONSTRAINT "moderation_appeals_moderation_action_id_fkey"
    FOREIGN KEY ("moderation_action_id") REFERENCES "moderation_actions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_appeals_appellant_id_fkey"
    FOREIGN KEY ("appellant_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "moderation_cases"
  ADD COLUMN "appeal_id" UUID;

CREATE UNIQUE INDEX "moderation_cases_appeal_id_key"
ON "moderation_cases" ("appeal_id");

ALTER TABLE "moderation_cases"
  ADD CONSTRAINT "moderation_cases_appeal_id_fkey"
    FOREIGN KEY ("appeal_id") REFERENCES "moderation_appeals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "moderation_cases_source_check"
    CHECK (
      (
        "queue" = 'listing-submission'
        AND "evaluation_id" IS NOT NULL
        AND "report_id" IS NULL
        AND "appeal_id" IS NULL
      )
      OR
      (
        "queue" = 'listing-report'
        AND "report_id" IS NOT NULL
        AND "evaluation_id" IS NULL
        AND "appeal_id" IS NULL
      )
      OR
      (
        "queue" = 'listing-appeal'
        AND "appeal_id" IS NOT NULL
        AND "evaluation_id" IS NULL
        AND "report_id" IS NULL
      )
    );

INSERT INTO "notification_templates" (
  "id",
  "key",
  "channel",
  "locale",
  "version",
  "title",
  "body",
  "variable_schema",
  "published_at"
)
VALUES
  ('5f000000-0000-4000-8000-000000000001', 'listing.status.submitted', 'IN_APP', 'zh-Hans', 2, '信息已提交审核', '您的信息已进入审核流程。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000002', 'listing.status.submitted', 'IN_APP', 'en-US', 2, 'Listing submitted', 'Your listing is now under review.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000003', 'listing.status.published', 'IN_APP', 'zh-Hans', 2, '信息已发布', '您的信息已公开发布。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000004', 'listing.status.published', 'IN_APP', 'en-US', 2, 'Listing published', 'Your listing is now public.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000005', 'listing.status.reviewing', 'IN_APP', 'zh-Hans', 2, '信息需要进一步审核', '您的信息正在接受进一步审核。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000006', 'listing.status.reviewing', 'IN_APP', 'en-US', 2, 'Listing needs further review', 'Your listing is receiving additional review.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000007', 'listing.status.changes_requested', 'IN_APP', 'zh-Hans', 2, '信息需要修改', '请查看您的信息并按审核要求修改后重新提交。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000008', 'listing.status.changes_requested', 'IN_APP', 'en-US', 2, 'Listing changes requested', 'Review your listing, make the requested changes, and submit it again.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000009', 'listing.status.rejected', 'IN_APP', 'zh-Hans', 2, '信息未通过审核', '您的信息未通过审核，请查看原因并按要求处理。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000a', 'listing.status.rejected', 'IN_APP', 'en-US', 2, 'Listing not approved', 'Your listing was not approved. Review the reason before taking the next step.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000b', 'listing.status.archived', 'IN_APP', 'zh-Hans', 2, '信息已归档', '您的信息已归档，不再公开展示。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000c', 'listing.status.archived', 'IN_APP', 'en-US', 2, 'Listing archived', 'Your listing has been archived and is no longer public.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000d', 'listing.status.deleted', 'IN_APP', 'zh-Hans', 2, '信息已删除', '您的信息已删除。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000e', 'listing.status.deleted', 'IN_APP', 'en-US', 2, 'Listing deleted', 'Your listing has been deleted.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-00000000000f', 'listing.status.expired', 'IN_APP', 'zh-Hans', 2, '信息已到期', '您的信息已到期并停止公开展示。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000010', 'listing.status.expired', 'IN_APP', 'en-US', 2, 'Listing expired', 'Your listing has expired and is no longer public.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000011', 'listing.status.removed', 'IN_APP', 'zh-Hans', 1, '信息已下架', '您的信息因内容政策处置被下架；您可在 30 天内提交申诉。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000012', 'listing.status.removed', 'IN_APP', 'en-US', 1, 'Listing removed', 'Your listing was removed after a content-policy decision. You may appeal within 30 days.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000013', 'listing.status.appeal_upheld', 'IN_APP', 'zh-Hans', 1, '申诉处理完成', '经独立复核，原下架决定维持。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000014', 'listing.status.appeal_upheld', 'IN_APP', 'en-US', 1, 'Appeal reviewed', 'An independent reviewer upheld the original removal decision.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000015', 'listing.status.appeal_restored', 'IN_APP', 'zh-Hans', 1, '信息已恢复', '经独立复核，您的信息已恢复公开展示。', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z'),
  ('5f000000-0000-4000-8000-000000000016', 'listing.status.appeal_restored', 'IN_APP', 'en-US', 1, 'Listing restored', 'An independent review restored your listing to public view.', '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}', '2026-07-30T05:00:00.000Z');
