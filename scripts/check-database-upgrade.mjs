import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromDatabasePackage = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { Client } = requireFromDatabasePackage("pg");

const sourceUrl = process.env.DATABASE_INTEGRATION_URL;
if (!sourceUrl) {
  throw new Error("DATABASE_INTEGRATION_URL is required for the upgrade compatibility check");
}

const parsedUrl = new URL(sourceUrl);
const sourceDatabase = parsedUrl.pathname.replace(/^\//, "");
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (!localHosts.has(parsedUrl.hostname) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "true") {
  throw new Error("Remote upgrade checks require ALLOW_REMOTE_INTEGRATION_DB=true");
}
if (!/(?:test|baseline|integration|empty)/i.test(sourceDatabase)) {
  throw new Error("Upgrade check requires a clearly disposable integration database");
}

const databaseName = `socal_upgrade_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
if (!/^socal_upgrade_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error("Generated upgrade database name is unsafe");
}

const adminUrl = new URL(parsedUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const upgradeUrl = new URL(parsedUrl);
upgradeUrl.pathname = `/${databaseName}`;
upgradeUrl.search = "";

const migrationsRoot = resolve("packages/database/prisma/migrations");
const compatibility = JSON.parse(
  await readFile(resolve("packages/database/prisma/compatibility/previous-release.json"), "utf8"),
);
const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const compatibilityIndex = migrationNames.indexOf(compatibility.lastMigration);
if (
  compatibility.version !== 1 ||
  typeof compatibility.label !== "string" ||
  compatibilityIndex < 0 ||
  compatibilityIndex >= migrationNames.length - 1
) {
  throw new Error("Previous-release compatibility baseline is invalid or has no upgrade path");
}

const priorMigrations = migrationNames.slice(0, compatibilityIndex + 1);
const upgradeMigrations = migrationNames.slice(compatibilityIndex + 1);
const sentinelId = "00000000-0000-4000-8000-000000000404";
const moderationSentinelCaseId = "00000000-0000-4000-8000-000000000409";
const admin = new Client({ connectionString: adminUrl.toString() });
let upgrade;

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  upgrade = new Client({ connectionString: upgradeUrl.toString() });
  await upgrade.connect();

  for (const migration of priorMigrations) {
    const sql = await readFile(resolve(migrationsRoot, migration, "migration.sql"), "utf8");
    await upgrade.query(sql);
  }
  await upgrade.query(
    `INSERT INTO "regions" ("id", "type", "code", "slug", "name_zh_hans", "name_en")
     VALUES ($1::uuid, 'CITY', 'TEST-UPGRADE-SENTINEL', 'upgrade-sentinel', '升级哨兵', 'Upgrade sentinel')`,
    [sentinelId],
  );

  for (const migration of upgradeMigrations) {
    const sql = await readFile(resolve(migrationsRoot, migration, "migration.sql"), "utf8");
    await upgrade.query(sql);
    if (migration === "20260729130000_listing_submission_moderation") {
      await upgrade.query(`
        INSERT INTO "users" ("id", "email", "updated_at")
        VALUES (
          '00000000-0000-4000-8000-000000000405',
          'upgrade-moderation-sentinel@example.invalid',
          now()
        );
        INSERT INTO "categories" ("id", "vertical", "slug", "name_zh_hans", "name_en")
        VALUES (
          '00000000-0000-4000-8000-000000000406',
          'RENTAL',
          'upgrade-moderation-rentals',
          '升级审核出租',
          'Upgrade moderation rentals'
        );
        INSERT INTO "category_form_schema_versions" (
          "id", "category_id", "version", "revision", "definition", "content_hash",
          "created_at", "updated_at", "published_at"
        )
        VALUES (
          '00000000-0000-4000-8000-000000000410',
          '00000000-0000-4000-8000-000000000406',
          1,
          1,
          '{"categoryId":"00000000-0000-4000-8000-000000000406","version":1,"fields":[],"publicationPolicy":{"defaultLifetimeDays":30}}'::jsonb,
          repeat('a', 64),
          now(),
          now(),
          now()
        );
        INSERT INTO "listings" (
          "id", "type", "owner_id", "category_id", "form_schema_version", "region_id",
          "status", "moderation_status", "locale", "title", "slug", "summary", "body",
          "price_amount", "currency", "price_unit", "contact_mode", "attributes",
          "latitude", "longitude", "location_precision", "version", "updated_at"
        )
        VALUES (
          '00000000-0000-4000-8000-000000000407',
          'RENTAL',
          '00000000-0000-4000-8000-000000000405',
          '00000000-0000-4000-8000-000000000406',
          1,
          '00000000-0000-4000-8000-000000000404',
          'SUBMITTED',
          'ESCALATED',
          'en-US',
          'Upgrade moderation sentinel',
          'upgrade-moderation-sentinel',
          'Synthetic upgrade summary',
          'Synthetic upgrade body',
          2500.00,
          'USD',
          'MONTHLY',
          'PHONE_REVEAL',
          '{"phone":"+15555550100","bedrooms":2}'::jsonb,
          34.052235,
          -118.243683,
          'EXACT',
          3,
          now()
        );
        INSERT INTO "rental_details" ("listing_id", "bedrooms", "bathrooms")
        VALUES ('00000000-0000-4000-8000-000000000407', 2.0, 1.0);
        INSERT INTO "moderation_evaluations" (
          "id", "listing_id", "actor_user_id", "listing_version", "rule_set_key",
          "rule_set_version", "risk_tier", "input_hash", "idempotency_key", "request_hash",
          "result_content_status", "result_moderation_status", "result_listing_version",
          "occurred_at"
        )
        VALUES (
          '00000000-0000-4000-8000-000000000408',
          '00000000-0000-4000-8000-000000000407',
          '00000000-0000-4000-8000-000000000405',
          1,
          'listing-submission',
          1,
          'HIGH',
          repeat('b', 64),
          'upgrade-moderation-submission',
          repeat('c', 64),
          'SUBMITTED',
          'ESCALATED',
          3,
          now()
        );
        INSERT INTO "moderation_cases" (
          "id", "evaluation_id", "target_type", "target_id", "queue", "priority", "status",
          "updated_at"
        )
        VALUES (
          '${moderationSentinelCaseId}',
          '00000000-0000-4000-8000-000000000408',
          'LISTING',
          '00000000-0000-4000-8000-000000000407',
          'listing-submission',
          80,
          'OPEN',
          now()
        );
      `);
    }
  }

  const sentinel = await upgrade.query(`SELECT "code" FROM "regions" WHERE "id" = $1::uuid`, [
    sentinelId,
  ]);
  const enumValue = await upgrade.query(
    `SELECT 1
       FROM pg_enum value
       JOIN pg_type type ON type.oid = value.enumtypid
      WHERE type.typname = 'RegionType'
        AND value.enumlabel = 'REGION_GROUP'`,
  );
  const sessionLifecycleColumns = await upgrade.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auth_sessions'
        AND column_name IN ('idle_expires_at', 'last_seen_at')`,
  );
  const otpChallengeTable = await upgrade.query(
    `SELECT to_regclass('public.otp_challenges') AS table_name`,
  );
  const profileVersionColumn = await upgrade.query(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_profiles'
        AND column_name = 'version'`,
  );
  const accountStateTrigger = await upgrade.query(
    `SELECT 1
       FROM pg_trigger
      WHERE tgname = 'users_revoke_sessions_after_state_change'
        AND NOT tgisinternal`,
  );
  const taxonomyAliasTables = await upgrade.query(
    `SELECT to_regclass('public.region_aliases') AS region_aliases,
            to_regclass('public.category_aliases') AS category_aliases`,
  );
  const categoryFormSchemaStorage = await upgrade.query(
    `SELECT
       to_regclass('public.category_form_schema_versions') AS versions,
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'listings'
            AND column_name = 'form_schema_version'
            AND is_nullable = 'NO'
       ) AS listing_version,
       EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'category_form_schema_versions_immutable'
            AND NOT tgisinternal
       ) AS immutable_trigger`,
  );
  const mediaUploadStorage = await upgrade.query(
    `SELECT
       to_regclass('public.media_assets') AS media_assets,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'media_assets_owner_id_idempotency_key_key'
       ) AS owner_idempotency`,
  );
  const platformRoleStorage = await upgrade.query(
    `SELECT
       to_regclass('public.platform_role_assignments') AS assignments,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'platform_role_assignments_one_active_role'
       ) AS one_active_role,
       (
         SELECT count(*)::integer
           FROM pg_enum value
           JOIN pg_type type ON type.oid = value.enumtypid
          WHERE type.typname = 'PlatformRole'
       ) AS enum_value_count`,
  );
  const mfaStorage = await upgrade.query(
    `SELECT
       to_regclass('public.mfa_credentials') AS credentials,
       to_regclass('public.mfa_recovery_codes') AS recovery_codes,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'auth_sessions'
            AND constraint_name = 'auth_sessions_mfa_strength_check'
       ) AS session_strength_check`,
  );
  const passwordStorage = await upgrade.query(
    `SELECT
       to_regclass('public.password_auth_attempts') AS attempts,
       to_regclass('public.password_recovery_requests') AS recoveries,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'users'
            AND constraint_name = 'users_password_state_check'
       ) AS password_state_check`,
  );
  const outboxStorage = await upgrade.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'outbox_events'
            AND constraint_name = 'outbox_events_state_check'
       ) AS state_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'outbox_events_pending_available_id_idx'
       ) AS pending_claim_index`,
  );
  const mediaProcessingStorage = await upgrade.query(
    `SELECT
       to_regclass('public.media_variants') AS variants,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'media_assets'
            AND constraint_name = 'media_assets_lifecycle_state_check'
       ) AS lifecycle_state_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'media_assets_processing_status_updated_at_idx'
       ) AS processing_index`,
  );
  const listingDraftStorage = await upgrade.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'listings'
            AND constraint_name = 'listings_create_idempotency_evidence_check'
            AND constraint_type = 'CHECK'
       ) AS evidence_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'listings_owner_id_create_idempotency_key_key'
       ) AS owner_idempotency`,
  );
  const listingMediaBindingStorage = await upgrade.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'media_assets'
            AND constraint_name = 'media_assets_listing_binding_check'
            AND constraint_type = 'CHECK'
       ) AS binding_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'media_assets_listing_id_sort_order_idx'
       ) AS binding_index,
       (
         SELECT count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'media_assets'
            AND column_name IN ('listing_id', 'sort_order')
       ) AS binding_columns`,
  );
  const listingSubmissionStorage = await upgrade.query(
    `SELECT
       to_regclass('public.moderation_evaluations') AS evaluations,
       to_regclass('public.moderation_rule_hits') AS rule_hits,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'moderation_evaluations_actor_user_id_idempotency_key_key'
       ) AS actor_idempotency,
       (
         SELECT count(*)::integer
           FROM pg_trigger
          WHERE tgname IN ('moderation_evaluations_immutable', 'moderation_rule_hits_immutable')
            AND NOT tgisinternal
       ) AS immutable_triggers`,
  );
  const moderationWorkbenchStorage = await upgrade.query(
    `SELECT
       to_regclass('public.moderation_case_snapshots') AS snapshots,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'moderation_actions_actor_id_idempotency_key_key'
       ) AS action_idempotency,
       (
         SELECT count(*)::integer
           FROM pg_trigger
          WHERE tgname IN (
            'moderation_case_snapshots_immutable',
            'moderation_actions_immutable'
          )
            AND NOT tgisinternal
       ) AS immutable_triggers,
       (
         SELECT count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (
              (table_name = 'moderation_cases' AND column_name = 'version' AND is_nullable = 'NO')
              OR (
                table_name = 'moderation_actions'
                AND column_name IN ('idempotency_key', 'request_hash')
                AND is_nullable = 'YES'
              )
            )
       ) AS workbench_columns`,
  );
  const listingPublicLifecycleStorage = await upgrade.query(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'listings_rental_expiry_due_idx'
     ) AS expiry_index`,
  );
  const notificationStorage = await upgrade.query(
    `SELECT
       to_regclass('public.notification_templates') AS templates,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'notifications_source_event_user_channel_key'
       ) AS source_event_idempotency,
       EXISTS (
         SELECT 1
           FROM pg_trigger
          WHERE tgname = 'notification_templates_published_immutable'
            AND NOT tgisinternal
       ) AS immutable_trigger,
       (
         SELECT count(*)::integer
           FROM notification_templates
          WHERE channel = 'IN_APP'
            AND published_at IS NOT NULL
            AND locale IN ('zh-Hans', 'en-US')
       ) AS published_templates`,
  );
  const moderationSentinelSnapshot = await upgrade.query(
    `SELECT "listing_version", "snapshot"
       FROM "moderation_case_snapshots"
      WHERE "case_id" = $1::uuid`,
    [moderationSentinelCaseId],
  );
  if (
    sentinel.rowCount !== 1 ||
    enumValue.rowCount !== 1 ||
    sessionLifecycleColumns.rowCount !== 2 ||
    otpChallengeTable.rows[0].table_name !== "otp_challenges" ||
    profileVersionColumn.rowCount !== 1 ||
    profileVersionColumn.rows[0].is_nullable !== "NO" ||
    accountStateTrigger.rowCount !== 1 ||
    taxonomyAliasTables.rows[0].region_aliases !== "region_aliases" ||
    taxonomyAliasTables.rows[0].category_aliases !== "category_aliases" ||
    categoryFormSchemaStorage.rows[0].versions !== "category_form_schema_versions" ||
    !categoryFormSchemaStorage.rows[0].listing_version ||
    !categoryFormSchemaStorage.rows[0].immutable_trigger ||
    mediaUploadStorage.rows[0].media_assets !== "media_assets" ||
    !mediaUploadStorage.rows[0].owner_idempotency ||
    platformRoleStorage.rows[0].assignments !== "platform_role_assignments" ||
    !platformRoleStorage.rows[0].one_active_role ||
    platformRoleStorage.rows[0].enum_value_count !== 8 ||
    mfaStorage.rows[0].credentials !== "mfa_credentials" ||
    mfaStorage.rows[0].recovery_codes !== "mfa_recovery_codes" ||
    !mfaStorage.rows[0].session_strength_check ||
    passwordStorage.rows[0].attempts !== "password_auth_attempts" ||
    passwordStorage.rows[0].recoveries !== "password_recovery_requests" ||
    !passwordStorage.rows[0].password_state_check ||
    !outboxStorage.rows[0].state_check ||
    !outboxStorage.rows[0].pending_claim_index ||
    mediaProcessingStorage.rows[0].variants !== "media_variants" ||
    !mediaProcessingStorage.rows[0].lifecycle_state_check ||
    !mediaProcessingStorage.rows[0].processing_index ||
    !listingDraftStorage.rows[0].evidence_check ||
    !listingDraftStorage.rows[0].owner_idempotency ||
    !listingMediaBindingStorage.rows[0].binding_check ||
    !listingMediaBindingStorage.rows[0].binding_index ||
    listingMediaBindingStorage.rows[0].binding_columns !== 2 ||
    listingSubmissionStorage.rows[0].evaluations !== "moderation_evaluations" ||
    listingSubmissionStorage.rows[0].rule_hits !== "moderation_rule_hits" ||
    !listingSubmissionStorage.rows[0].actor_idempotency ||
    listingSubmissionStorage.rows[0].immutable_triggers !== 2 ||
    moderationWorkbenchStorage.rows[0].snapshots !== "moderation_case_snapshots" ||
    !moderationWorkbenchStorage.rows[0].action_idempotency ||
    moderationWorkbenchStorage.rows[0].immutable_triggers !== 2 ||
    moderationWorkbenchStorage.rows[0].workbench_columns !== 3 ||
    !listingPublicLifecycleStorage.rows[0].expiry_index ||
    notificationStorage.rows[0].templates !== "notification_templates" ||
    !notificationStorage.rows[0].source_event_idempotency ||
    !notificationStorage.rows[0].immutable_trigger ||
    notificationStorage.rows[0].published_templates !== 16 ||
    moderationSentinelSnapshot.rowCount !== 1 ||
    moderationSentinelSnapshot.rows[0].listing_version !== 3 ||
    moderationSentinelSnapshot.rows[0].snapshot.sensitiveFieldsRedacted !== true ||
    Object.keys(moderationSentinelSnapshot.rows[0].snapshot.attributes).length !== 0 ||
    "latitude" in moderationSentinelSnapshot.rows[0].snapshot ||
    "longitude" in moderationSentinelSnapshot.rows[0].snapshot
  ) {
    throw new Error("Latest migration did not preserve prior data and expected schema state");
  }

  console.log(
    JSON.stringify({
      event: "database.upgrade.validated",
      compatibilityBaseline: compatibility.label,
      priorMigrationCount: priorMigrations.length,
      appliedMigrationCount: upgradeMigrations.length,
      sentinelPreserved: true,
      sessionLifecycleColumns: sessionLifecycleColumns.rowCount,
      otpChallengeTable: otpChallengeTable.rows[0].table_name,
      profileVersionColumn: true,
      accountStateTrigger: true,
      taxonomyAliasTables: ["region_aliases", "category_aliases"],
      categoryFormSchemaStorage: true,
      mediaUploadStorage: true,
      platformRoleStorage: true,
      mfaStorage: true,
      passwordStorage: true,
      outboxStorage: true,
      mediaProcessingStorage: true,
      listingDraftStorage: true,
      listingMediaBindingStorage: true,
      listingSubmissionStorage: true,
      moderationWorkbenchStorage: true,
      listingPublicLifecycleStorage: true,
      notificationStorage: true,
      moderationSnapshotBackfilledAndRedacted: true,
    }),
  );
} finally {
  if (upgrade) await upgrade.end();
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
