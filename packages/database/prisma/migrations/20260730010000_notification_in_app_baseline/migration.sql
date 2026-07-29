-- migration-safety: allow ADD_REQUIRED_COLUMN reason="bounded defaults preserve historical notification rows while new writers persist explicit versioned snapshots" rollback="redeploy the prior application and retain the additive columns; exceptional physical rollback is documented in ROLLBACK.md"
-- migration-safety: allow UPDATE_DATA reason="one-time bounded backfill makes historical notification state satisfy the new content and read/sent coherence checks" rollback="restore the pre-migration notification export only in a stopped-writer pre-production recovery; otherwise correct forward"

CREATE TABLE "notification_templates" (
  "id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "version" INTEGER NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "variable_schema" JSONB NOT NULL,
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_templates_key_check"
    CHECK ("key" ~ '^[a-z][a-z0-9._-]{2,119}$'),
  CONSTRAINT "notification_templates_locale_check"
    CHECK ("locale" IN ('zh-Hans', 'en-US')),
  CONSTRAINT "notification_templates_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "notification_templates_content_check"
    CHECK (
      char_length("title") BETWEEN 1 AND 160
      AND char_length("body") BETWEEN 1 AND 2000
    ),
  CONSTRAINT "notification_templates_variable_schema_check"
    CHECK (jsonb_typeof("variable_schema") = 'object')
);

CREATE UNIQUE INDEX "notification_templates_key_channel_locale_version_key"
ON "notification_templates" ("key", "channel", "locale", "version");

CREATE INDEX "notification_templates_current_lookup_idx"
ON "notification_templates" ("key", "channel", "locale", "published_at" DESC)
WHERE "published_at" IS NOT NULL;

CREATE OR REPLACE FUNCTION "reject_published_notification_template_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'published notification templates are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notification_templates_published_immutable"
BEFORE UPDATE OR DELETE ON "notification_templates"
FOR EACH ROW
EXECUTE FUNCTION "reject_published_notification_template_mutation"();

ALTER TABLE "notifications"
  ADD COLUMN "template_id" UUID,
  ADD COLUMN "template_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-Hans',
  ADD COLUMN "title" VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN "body" VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN "resource_type" VARCHAR(40),
  ADD COLUMN "resource_id" UUID,
  ADD COLUMN "source_event_id" UUID,
  ADD COLUMN "aggregate_version" INTEGER,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "notifications"
SET
  "title" = CASE
    WHEN char_length(btrim("template_key")) > 0 THEN "template_key"
    ELSE 'Legacy notification'
  END,
  "body" = 'Legacy notification',
  "sent_at" = CASE
    WHEN "status" IN ('SENT'::"NotificationStatus", 'READ'::"NotificationStatus")
      THEN COALESCE("sent_at", "created_at")
    ELSE "sent_at"
  END,
  "read_at" = CASE
    WHEN "status" = 'READ'::"NotificationStatus"
      THEN COALESCE("read_at", "sent_at", "created_at")
    ELSE NULL
  END;

ALTER TABLE "notifications"
  ALTER COLUMN "title" DROP DEFAULT,
  ALTER COLUMN "body" DROP DEFAULT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_template_fkey"
    FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_template_version_check"
    CHECK ("template_version" > 0),
  ADD CONSTRAINT "notifications_locale_check"
    CHECK ("locale" IN ('zh-Hans', 'en-US')),
  ADD CONSTRAINT "notifications_content_check"
    CHECK (
      char_length("title") BETWEEN 1 AND 160
      AND char_length("body") BETWEEN 1 AND 2000
    ),
  ADD CONSTRAINT "notifications_resource_pair_check"
    CHECK (("resource_type" IS NULL) = ("resource_id" IS NULL)),
  ADD CONSTRAINT "notifications_event_version_pair_check"
    CHECK (
      ("source_event_id" IS NULL AND "aggregate_version" IS NULL)
      OR
      ("source_event_id" IS NOT NULL AND "aggregate_version" > 0)
    ),
  ADD CONSTRAINT "notifications_read_state_check"
    CHECK (("status" = 'READ'::"NotificationStatus") = ("read_at" IS NOT NULL)),
  ADD CONSTRAINT "notifications_sent_state_check"
    CHECK (
      "status" NOT IN ('SENT'::"NotificationStatus", 'READ'::"NotificationStatus")
      OR "sent_at" IS NOT NULL
    );

CREATE UNIQUE INDEX "notifications_source_event_user_channel_key"
ON "notifications" ("source_event_id", "user_id", "channel");

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
  (
    '4f000000-0000-4000-8000-000000000001',
    'listing.status.submitted',
    'IN_APP',
    'zh-Hans',
    1,
    '信息已提交审核',
    '您的租房信息已进入审核流程。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000002',
    'listing.status.submitted',
    'IN_APP',
    'en-US',
    1,
    'Listing submitted',
    'Your rental listing is now under review.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000003',
    'listing.status.published',
    'IN_APP',
    'zh-Hans',
    1,
    '信息已发布',
    '您的租房信息已公开发布。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000004',
    'listing.status.published',
    'IN_APP',
    'en-US',
    1,
    'Listing published',
    'Your rental listing is now public.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000005',
    'listing.status.reviewing',
    'IN_APP',
    'zh-Hans',
    1,
    '信息需要进一步审核',
    '您的租房信息正在接受进一步审核。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000006',
    'listing.status.reviewing',
    'IN_APP',
    'en-US',
    1,
    'Listing needs further review',
    'Your rental listing is receiving additional review.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000007',
    'listing.status.changes_requested',
    'IN_APP',
    'zh-Hans',
    1,
    '信息需要修改',
    '请查看您的租房信息并按审核要求修改后重新提交。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000008',
    'listing.status.changes_requested',
    'IN_APP',
    'en-US',
    1,
    'Listing changes requested',
    'Review your rental listing, make the requested changes, and submit it again.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000009',
    'listing.status.rejected',
    'IN_APP',
    'zh-Hans',
    1,
    '信息未通过审核',
    '您的租房信息未通过审核，请在用户中心查看后续选项。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000a',
    'listing.status.rejected',
    'IN_APP',
    'en-US',
    1,
    'Listing not approved',
    'Your rental listing was not approved. Visit your account for next steps.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000b',
    'listing.status.archived',
    'IN_APP',
    'zh-Hans',
    1,
    '信息已归档',
    '您的租房信息已归档并停止公开展示。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000c',
    'listing.status.archived',
    'IN_APP',
    'en-US',
    1,
    'Listing archived',
    'Your rental listing is archived and no longer public.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000d',
    'listing.status.deleted',
    'IN_APP',
    'zh-Hans',
    1,
    '信息已删除',
    '您的租房信息已删除并停止公开展示。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000e',
    'listing.status.deleted',
    'IN_APP',
    'en-US',
    1,
    'Listing deleted',
    'Your rental listing was deleted and is no longer public.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-00000000000f',
    'listing.status.expired',
    'IN_APP',
    'zh-Hans',
    1,
    '信息已过期',
    '您的租房信息已到期并停止公开展示。',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  ),
  (
    '4f000000-0000-4000-8000-000000000010',
    'listing.status.expired',
    'IN_APP',
    'en-US',
    1,
    'Listing expired',
    'Your rental listing expired and is no longer public.',
    '{"type":"object","required":["resourceId","aggregateVersion"],"properties":{"resourceId":{"type":"string","format":"uuid"},"aggregateVersion":{"type":"integer","minimum":1}},"additionalProperties":false}',
    '2026-07-30T01:00:00.000Z'
  );
