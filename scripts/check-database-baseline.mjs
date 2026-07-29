import { createRequire } from "node:module";

const requireFromDatabasePackage = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { Client } = requireFromDatabasePackage("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the baseline database check");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
let savepointSequence = 0;

async function expectSqlState(label, query, expectedCode) {
  const savepoint = `negative_case_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    if (error && typeof error === "object" && error.code === expectedCode) return;
    throw new Error(`${label} returned an unexpected database error`, { cause: error });
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  throw new Error(`${label} unexpectedly succeeded`);
}

await client.connect();
try {
  const migrations = await client.query(
    `SELECT migration_name, finished_at
       FROM "_prisma_migrations"
      WHERE rolled_back_at IS NULL
      ORDER BY started_at`,
  );
  const requiredMigrations = [
    "0000_extensions",
    "20260725044311_baseline",
    "20260725051500_region_group_type",
    "20260726041310_auth_session_lifecycle",
    "20260726044453_otp_challenges",
    "20260728090000_account_management",
    "20260728184415_taxonomy_aliases",
    "20260728190935_category_form_schema_versions",
    "20260728201500_media_upload_intents",
    "20260728203000_admin_platform_roles",
    "20260728221000_admin_mfa",
    "20260728223000_password_recovery",
    "20260728234500_outbox_dispatcher_constraints",
    "20260729003000_media_processing_lifecycle",
    "20260729010000_listing_draft_idempotency",
    "20260729020000_listing_media_binding",
    "20260729130000_listing_submission_moderation",
    "20260729150000_admin_moderation_workbench",
    "20260729230000_listing_public_lifecycle",
    "20260730010000_notification_in_app_baseline",
    "20260730020000_organization_membership_lifecycle",
    "20260730030000_job_vertical_baseline",
    "20260730040000_remaining_verticals_baseline",
    "20260730050000_report_appeal_workflow",
  ];
  const completedMigrations = new Set(
    migrations.rows.filter((row) => row.finished_at).map((row) => row.migration_name),
  );
  if (requiredMigrations.some((migration) => !completedMigrations.has(migration))) {
    throw new Error("One or more required database migrations are incomplete");
  }

  const extensions = await client.query(
    `SELECT extname
       FROM pg_extension
      WHERE extname IN ('pg_trgm', 'postgis')
      ORDER BY extname`,
  );
  if (extensions.rows.map((row) => row.extname).join(",") !== "pg_trgm,postgis") {
    throw new Error("Required PostgreSQL extensions are not installed");
  }

  const coreTables = await client.query(
    `SELECT to_regclass('public.users') AS users,
            to_regclass('public.listings') AS listings,
            to_regclass('public.reviews') AS reviews,
            to_regclass('public.orders') AS orders,
            to_regclass('public.region_aliases') AS region_aliases,
            to_regclass('public.category_aliases') AS category_aliases,
            to_regclass('public.category_form_schema_versions') AS category_form_schema_versions,
            to_regclass('public.media_assets') AS media_assets,
            to_regclass('public.media_variants') AS media_variants,
            to_regclass('public.platform_role_assignments') AS platform_role_assignments,
            to_regclass('public.mfa_credentials') AS mfa_credentials,
            to_regclass('public.mfa_recovery_codes') AS mfa_recovery_codes,
            to_regclass('public.password_auth_attempts') AS password_auth_attempts,
            to_regclass('public.password_recovery_requests') AS password_recovery_requests,
            to_regclass('public.moderation_evaluations') AS moderation_evaluations,
            to_regclass('public.moderation_rule_hits') AS moderation_rule_hits,
            to_regclass('public.moderation_case_snapshots') AS moderation_case_snapshots,
            to_regclass('public.moderation_appeals') AS moderation_appeals,
            to_regclass('public.notification_templates') AS notification_templates`,
  );
  if (Object.values(coreTables.rows[0]).some((value) => value === null)) {
    throw new Error("One or more core baseline tables are missing");
  }

  const geoColumn = await client.query(
    `SELECT is_generated, generation_expression
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'listings'
        AND column_name = 'geo_point'`,
  );
  if (
    geoColumn.rowCount !== 1 ||
    geoColumn.rows[0].is_generated !== "ALWAYS" ||
    !geoColumn.rows[0].generation_expression
  ) {
    throw new Error("listings.geo_point is not a stored generated column");
  }

  const customIndexes = await client.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'listings_geo_point_gist',
          'listings_title_trgm',
           'listings_published_partial',
           'listings_rental_expiry_due_idx',
           'listings_job_expiry_due_idx',
           'listings_transfer_expiry_due_idx',
           'listings_secondhand_expiry_due_idx',
           'listings_service_expiry_due_idx'
         )`,
  );
  if (customIndexes.rowCount !== 8) {
    throw new Error("One or more custom listing indexes are missing");
  }

  const jobVerticalStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'job_details'
            AND constraint_name = 'job_details_wage_range_coherent'
            AND constraint_type = 'CHECK'
       ) AS wage_check,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'job_details'
            AND constraint_name = 'job_details_text_fields_nonblank'
            AND constraint_type = 'CHECK'
       ) AS text_check`,
  );
  if (!jobVerticalStorage.rows[0]?.wage_check || !jobVerticalStorage.rows[0]?.text_check) {
    throw new Error("Job vertical storage constraints are missing");
  }

  const remainingVerticalStorage = await client.query(
    `SELECT count(*)::integer AS detail_checks
       FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND constraint_type = 'CHECK'
        AND constraint_name IN (
          'transfer_details_core_fields_coherent',
          'secondhand_details_core_fields_coherent',
          'secondhand_details_optional_text_nonblank',
          'service_details_core_fields_coherent',
          'service_details_license_nonblank'
        )`,
  );
  if (remainingVerticalStorage.rows[0]?.detail_checks !== 5) {
    throw new Error("Transfer, Secondhand, or Service storage constraints are missing");
  }

  const sessionLifecycleColumns = await client.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auth_sessions'
        AND column_name IN ('idle_expires_at', 'last_seen_at')
      ORDER BY column_name`,
  );
  if (
    sessionLifecycleColumns.rowCount !== 2 ||
    sessionLifecycleColumns.rows.some((column) => column.is_nullable !== "NO")
  ) {
    throw new Error("Required auth session lifecycle columns are missing or nullable");
  }

  const otpChallengeColumns = await client.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'otp_challenges'
        AND column_name IN (
          'destination_hash',
          'code_hash',
          'ip_hash',
          'device_hash',
          'expires_at',
          'failed_attempts'
        )
      ORDER BY column_name`,
  );
  if (
    otpChallengeColumns.rowCount !== 6 ||
    otpChallengeColumns.rows.some((column) => column.is_nullable !== "NO")
  ) {
    throw new Error("Required OTP challenge security columns are missing or nullable");
  }

  const profileVersionColumn = await client.query(
    `SELECT is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_profiles'
        AND column_name = 'version'`,
  );
  const accountStateTrigger = await client.query(
    `SELECT 1
       FROM pg_trigger
      WHERE tgname = 'users_revoke_sessions_after_state_change'
        AND NOT tgisinternal`,
  );
  if (
    profileVersionColumn.rowCount !== 1 ||
    profileVersionColumn.rows[0].is_nullable !== "NO" ||
    accountStateTrigger.rowCount !== 1
  ) {
    throw new Error("Account-management profile version or session-revocation trigger is missing");
  }

  const taxonomyAliasConstraints = await client.query(
    `SELECT tc.table_name, rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_schema = tc.constraint_schema
        AND rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('region_aliases', 'category_aliases')
      ORDER BY tc.table_name`,
  );
  if (
    taxonomyAliasConstraints.rowCount !== 2 ||
    taxonomyAliasConstraints.rows.some((constraint) => constraint.delete_rule !== "CASCADE")
  ) {
    throw new Error("Taxonomy alias foreign keys are missing or do not cascade");
  }

  const formSchemaStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'listings'
            AND column_name = 'form_schema_version'
            AND is_nullable = 'NO'
       ) AS listing_version,
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'category_form_schema_versions_one_draft_per_category'
       ) AS one_draft_index,
       EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'category_form_schema_versions_immutable'
            AND NOT tgisinternal
       ) AS immutable_trigger`,
  );
  if (
    !formSchemaStorage.rows[0]?.listing_version ||
    !formSchemaStorage.rows[0]?.one_draft_index ||
    !formSchemaStorage.rows[0]?.immutable_trigger
  ) {
    throw new Error("Category form schema version storage or immutability controls are missing");
  }

  const mediaUploadStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'media_assets_owner_id_idempotency_key_key'
       ) AS owner_idempotency,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'media_assets'
            AND constraint_name = 'media_assets_owner_id_fkey'
            AND constraint_type = 'FOREIGN KEY'
       ) AS owner_fk`,
  );
  if (!mediaUploadStorage.rows[0]?.owner_idempotency || !mediaUploadStorage.rows[0]?.owner_fk) {
    throw new Error("Media upload ownership or idempotency controls are missing");
  }

  const platformRoleStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'platform_role_assignments_one_active_role'
       ) AS one_active_role,
       (
         SELECT count(*)::integer
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'platform_role_assignments'
            AND constraint_type = 'FOREIGN KEY'
       ) AS foreign_key_count,
       (
         SELECT count(*)::integer
           FROM pg_enum value
           JOIN pg_type type ON type.oid = value.enumtypid
          WHERE type.typname = 'PlatformRole'
       ) AS enum_value_count`,
  );
  if (
    !platformRoleStorage.rows[0]?.one_active_role ||
    platformRoleStorage.rows[0]?.foreign_key_count !== 3 ||
    platformRoleStorage.rows[0]?.enum_value_count !== 8
  ) {
    throw new Error("Platform role uniqueness, provenance, or enum controls are missing");
  }

  const mfaStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'auth_sessions'
            AND constraint_name = 'auth_sessions_mfa_strength_check'
            AND constraint_type = 'CHECK'
       ) AS session_strength_check,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'mfa_credentials'
            AND constraint_name = 'mfa_credentials_state_check'
            AND constraint_type = 'CHECK'
       ) AS credential_state_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'mfa_recovery_codes_credential_id_code_hash_key'
       ) AS recovery_code_unique`,
  );
  if (
    !mfaStorage.rows[0]?.session_strength_check ||
    !mfaStorage.rows[0]?.credential_state_check ||
    !mfaStorage.rows[0]?.recovery_code_unique
  ) {
    throw new Error("MFA session, credential, or recovery-code controls are missing");
  }

  const passwordStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'users'
            AND constraint_name = 'users_password_state_check'
       ) AS password_state_check,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'password_auth_attempts'
            AND constraint_name = 'password_auth_attempts_state_check'
       ) AS attempt_state_check,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'password_recovery_requests'
            AND constraint_name = 'password_recovery_requests_window_check'
       ) AS recovery_window_check`,
  );
  if (
    !passwordStorage.rows[0]?.password_state_check ||
    !passwordStorage.rows[0]?.attempt_state_check ||
    !passwordStorage.rows[0]?.recovery_window_check
  ) {
    throw new Error("Password credential, attempt, or recovery controls are missing");
  }

  const outboxStorage = await client.query(
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
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'outbox_events'
            AND constraint_name = 'outbox_events_attempts_check'
       ) AS attempts_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'outbox_events_pending_available_id_idx'
       ) AS pending_claim_index`,
  );
  if (
    !outboxStorage.rows[0]?.state_check ||
    !outboxStorage.rows[0]?.attempts_check ||
    !outboxStorage.rows[0]?.pending_claim_index
  ) {
    throw new Error("Outbox state, attempt, or SKIP LOCKED claim controls are missing");
  }

  const mediaProcessingStorage = await client.query(
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
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'media_variants'
            AND constraint_name = 'media_variants_object_key_check'
       ) AS variant_key_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'media_assets_processing_status_updated_at_idx'
       ) AS processing_index`,
  );
  if (
    mediaProcessingStorage.rows[0]?.variants !== "media_variants" ||
    !mediaProcessingStorage.rows[0]?.lifecycle_state_check ||
    !mediaProcessingStorage.rows[0]?.variant_key_check ||
    !mediaProcessingStorage.rows[0]?.processing_index
  ) {
    throw new Error("Media lifecycle, safe variant, or processing-index controls are missing");
  }

  const listingDraftStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'listings'
            AND constraint_name = 'listings_create_idempotency_evidence_check'
            AND constraint_type = 'CHECK'
       ) AS pair_check,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'listings_owner_id_create_idempotency_key_key'
       ) AS owner_idempotency,
       (
         SELECT count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'listings'
            AND column_name IN ('create_idempotency_key', 'create_request_hash')
            AND is_nullable = 'YES'
       ) AS nullable_evidence_columns`,
  );
  if (
    !listingDraftStorage.rows[0]?.pair_check ||
    !listingDraftStorage.rows[0]?.owner_idempotency ||
    listingDraftStorage.rows[0]?.nullable_evidence_columns !== 2
  ) {
    throw new Error("Listing draft idempotency evidence controls are missing");
  }

  const listingMediaBindingStorage = await client.query(
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
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'media_assets'
            AND constraint_name = 'media_assets_listing_id_fkey'
            AND constraint_type = 'FOREIGN KEY'
       ) AS listing_foreign_key,
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
            AND (
              (column_name = 'listing_id' AND is_nullable = 'YES')
              OR (column_name = 'sort_order' AND is_nullable = 'NO')
            )
       ) AS binding_columns`,
  );
  if (
    !listingMediaBindingStorage.rows[0]?.binding_check ||
    !listingMediaBindingStorage.rows[0]?.listing_foreign_key ||
    !listingMediaBindingStorage.rows[0]?.binding_index ||
    listingMediaBindingStorage.rows[0]?.binding_columns !== 2
  ) {
    throw new Error("Listing READY-media binding controls are missing");
  }

  const listingSubmissionStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'moderation_evaluations_actor_user_id_idempotency_key_key'
       ) AS actor_idempotency,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'moderation_evaluations'
            AND constraint_name = 'moderation_evaluations_result_check'
            AND constraint_type = 'CHECK'
       ) AS result_check,
       (
         SELECT count(*)::integer
           FROM pg_trigger
          WHERE tgname IN ('moderation_evaluations_immutable', 'moderation_rule_hits_immutable')
            AND NOT tgisinternal
       ) AS immutable_triggers`,
  );
  if (
    !listingSubmissionStorage.rows[0]?.actor_idempotency ||
    !listingSubmissionStorage.rows[0]?.result_check ||
    listingSubmissionStorage.rows[0]?.immutable_triggers !== 2
  ) {
    throw new Error("Listing submission evidence or immutability controls are missing");
  }

  const moderationWorkbenchStorage = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'moderation_cases'
            AND column_name = 'version'
            AND is_nullable = 'NO'
       ) AS case_version,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'moderation_actions_actor_id_idempotency_key_key'
       ) AS action_idempotency,
       EXISTS (
         SELECT 1
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND table_name = 'moderation_actions'
            AND constraint_name = 'moderation_actions_idempotency_check'
       ) AS action_evidence_check,
       (
         SELECT count(*)::integer
           FROM pg_trigger
          WHERE tgname IN (
            'moderation_case_snapshots_immutable',
            'moderation_actions_immutable'
          )
            AND NOT tgisinternal
       ) AS immutable_triggers`,
  );
  if (
    !moderationWorkbenchStorage.rows[0]?.case_version ||
    !moderationWorkbenchStorage.rows[0]?.action_idempotency ||
    !moderationWorkbenchStorage.rows[0]?.action_evidence_check ||
    moderationWorkbenchStorage.rows[0]?.immutable_triggers !== 2
  ) {
    throw new Error(
      "Moderation workbench version, idempotency, or immutability controls are missing",
    );
  }

  const trustSafetyStorage = await client.query(
    `SELECT
       to_regclass('public.moderation_appeals') AS appeals,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'reports_reporter_id_idempotency_key_key'
       ) AS report_idempotency,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'reports_active_reporter_target_key'
       ) AS active_report_deduplication,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'moderation_appeals_appellant_id_idempotency_key_key'
       ) AS appeal_idempotency,
       (
         SELECT count(*)::integer
           FROM information_schema.table_constraints
          WHERE constraint_schema = 'public'
            AND constraint_type = 'CHECK'
            AND constraint_name IN (
              'reports_target_type_check',
              'reports_reason_code_check',
              'reports_details_check',
              'reports_request_hash_check',
              'moderation_appeals_statement_check',
              'moderation_appeals_request_hash_check',
              'moderation_appeals_resolution_check',
              'moderation_cases_source_check'
            )
       ) AS workflow_checks`,
  );
  if (
    trustSafetyStorage.rows[0]?.appeals !== "moderation_appeals" ||
    !trustSafetyStorage.rows[0]?.report_idempotency ||
    !trustSafetyStorage.rows[0]?.active_report_deduplication ||
    !trustSafetyStorage.rows[0]?.appeal_idempotency ||
    trustSafetyStorage.rows[0]?.workflow_checks !== 8
  ) {
    throw new Error("Report or appeal workflow constraints are missing");
  }

  const notificationStorage = await client.query(
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
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'notifications'
            AND column_name IN (
              'template_id',
              'template_version',
              'locale',
              'title',
              'body',
              'resource_type',
              'resource_id',
              'source_event_id',
              'aggregate_version',
              'updated_at'
            )
       ) AS projection_columns,
       (
         SELECT count(*)::integer
           FROM notification_templates
          WHERE channel = 'IN_APP'
            AND published_at IS NOT NULL
            AND locale IN ('zh-Hans', 'en-US')
       ) AS published_templates`,
  );
  if (
    notificationStorage.rows[0]?.templates !== "notification_templates" ||
    !notificationStorage.rows[0]?.source_event_idempotency ||
    !notificationStorage.rows[0]?.immutable_trigger ||
    notificationStorage.rows[0]?.projection_columns !== 10 ||
    Number(notificationStorage.rows[0]?.published_templates) < 40
  ) {
    throw new Error("In-app notification template or projection controls are missing");
  }
  const organizationMembershipLifecycle = await client.query(
    `SELECT
       to_regclass('public.organization_invitations')::text AS invitations,
       to_regclass('public.organization_owner_transfers')::text AS owner_transfers,
       (
         SELECT count(*)::integer
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'organization_memberships'
            AND column_name IN ('updated_at', 'version')
       ) AS membership_columns,
       (
         SELECT count(*)::integer
           FROM pg_trigger
          WHERE tgname IN (
            'organizations_require_owner_after_insert',
            'organization_memberships_require_owner_after_change'
          )
            AND NOT tgisinternal
       ) AS owner_triggers,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'organization_invitations_one_pending_invitee_idx'
       ) AS pending_invitation_index`,
  );
  if (
    organizationMembershipLifecycle.rows[0]?.invitations !== "organization_invitations" ||
    organizationMembershipLifecycle.rows[0]?.owner_transfers !== "organization_owner_transfers" ||
    organizationMembershipLifecycle.rows[0]?.membership_columns !== 2 ||
    organizationMembershipLifecycle.rows[0]?.owner_triggers !== 2 ||
    !organizationMembershipLifecycle.rows[0]?.pending_invitation_index
  ) {
    throw new Error("Organization membership lifecycle controls are missing");
  }

  await client.query("BEGIN");
  await client.query(
    `INSERT INTO users (id, email, updated_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'baseline-user@example.invalid', now())`,
  );
  await client.query(
    `INSERT INTO regions (id, type, code, slug, name_zh_hans, name_en)
     VALUES (
       '00000000-0000-4000-8000-000000000002',
       'CITY',
       'TEST-IRVINE',
       'test-irvine',
       '测试城市',
       'Test Irvine'
     )`,
  );
  await client.query(
    `INSERT INTO categories (id, vertical, slug, name_zh_hans, name_en)
     VALUES (
       '00000000-0000-4000-8000-000000000003',
       'RENTAL',
       'test-rental',
       '测试租房',
       'Test Rental'
     )`,
  );
  await client.query(
    `INSERT INTO listings (
       id, type, owner_id, category_id, region_id, title, slug, body,
       latitude, longitude, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000004',
       'RENTAL',
       '00000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000002',
       'Baseline generated point',
       'baseline-generated-point',
       'Fictional data used only inside a rolled-back migration check.',
       33.6846,
       -117.8265,
       now()
     )`,
  );
  await client.query(
    `INSERT INTO categories (id, vertical, slug, name_zh_hans, name_en)
     VALUES (
       '00000000-0000-4000-8000-000000000040',
       'JOB',
       'test-job',
       '测试招聘',
       'Test Job'
     )`,
  );
  await client.query(
    `INSERT INTO listings (
       id, type, owner_id, category_id, region_id, title, slug, body,
       price_amount, price_unit, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000041',
       'JOB',
       '00000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000040',
       '00000000-0000-4000-8000-000000000002',
       'Baseline synthetic Job',
       'baseline-synthetic-job',
       'Fictional Job data used only inside a rolled-back migration check.',
       40.00,
       'HOURLY',
       now()
     )`,
  );
  await expectSqlState(
    "Job wage range coherence",
    `INSERT INTO job_details (
       listing_id, employer_name, employment_type, wage_min, wage_max, wage_unit
     )
     VALUES (
       '00000000-0000-4000-8000-000000000041',
       'Synthetic Employer',
       'full-time',
       40.00,
       20.00,
       'HOURLY'
     )`,
    "23514",
  );
  await expectSqlState(
    "Transfer detail coherence",
    `INSERT INTO transfer_details (
       listing_id, business_type, asking_price, monthly_rent,
       lease_remaining_months, reason_for_transfer
     )
     VALUES (
       '00000000-0000-4000-8000-000000000041',
       'retail',
       -1.00,
       1000.00,
       12,
       'Synthetic invalid transfer'
     )`,
    "23514",
  );
  await expectSqlState(
    "Secondhand detail coherence",
    `INSERT INTO secondhand_details (listing_id, condition, delivery_options)
     VALUES (
       '00000000-0000-4000-8000-000000000041',
       'good',
       '{}'::jsonb
     )`,
    "23514",
  );
  await expectSqlState(
    "Service detail coherence",
    `INSERT INTO service_details (listing_id, service_radius_miles, availability)
     VALUES (
       '00000000-0000-4000-8000-000000000041',
       101,
       '["weekdays"]'::jsonb
     )`,
    "23514",
  );

  const generatedPoint = await client.query(
    `SELECT ST_Y(geo_point::geometry) AS latitude,
            ST_X(geo_point::geometry) AS longitude
       FROM listings
      WHERE id = '00000000-0000-4000-8000-000000000004'`,
  );
  if (
    Math.abs(Number(generatedPoint.rows[0].latitude) - 33.6846) > 0.000001 ||
    Math.abs(Number(generatedPoint.rows[0].longitude) - -117.8265) > 0.000001
  ) {
    throw new Error("Generated geography point does not match listing coordinates");
  }

  await expectSqlState(
    "listing draft idempotency evidence pairing",
    `UPDATE listings
        SET create_idempotency_key = 'baseline-listing-pair'
      WHERE id = '00000000-0000-4000-8000-000000000004'`,
    "23514",
  );
  await expectSqlState(
    "listing draft idempotency key bound",
    `UPDATE listings
        SET create_idempotency_key = 'invalid key with spaces',
            create_request_hash = repeat('a', 64)
      WHERE id = '00000000-0000-4000-8000-000000000004'`,
    "23514",
  );
  await client.query(
    `UPDATE listings
        SET create_idempotency_key = 'baseline-listing-create-0001',
            create_request_hash = repeat('a', 64)
      WHERE id = '00000000-0000-4000-8000-000000000004'`,
  );
  await expectSqlState(
    "listing draft owner idempotency uniqueness",
    `INSERT INTO listings (
       id, type, owner_id, category_id, region_id, title, slug, body,
       create_idempotency_key, create_request_hash, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000025',
       'RENTAL',
       '00000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000002',
       'Duplicate owner idempotency evidence',
       'duplicate-owner-idempotency-evidence',
       'Fictional data expected to fail its owner-scoped uniqueness constraint.',
       'baseline-listing-create-0001',
       repeat('b', 64),
       now()
     )`,
    "23505",
  );
  await client.query(
    `INSERT INTO moderation_evaluations (
       id, listing_id, actor_user_id, listing_version, rule_set_key, rule_set_version,
       risk_tier, input_hash, idempotency_key, request_hash,
       result_content_status, result_moderation_status, result_listing_version, occurred_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000030',
       '00000000-0000-4000-8000-000000000004',
       '00000000-0000-4000-8000-000000000001',
       1, 'listing-submission', 1, 'LOW', repeat('a', 64),
       'baseline-listing-submit-0001', repeat('b', 64),
       'PUBLISHED', 'AUTO_APPROVED', 3, now()
     )`,
  );
  await expectSqlState(
    "moderation evaluation result consistency",
    `INSERT INTO moderation_evaluations (
       id, listing_id, actor_user_id, listing_version, rule_set_key, rule_set_version,
       risk_tier, input_hash, idempotency_key, request_hash,
       result_content_status, result_moderation_status, result_listing_version, occurred_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000031',
       '00000000-0000-4000-8000-000000000004',
       '00000000-0000-4000-8000-000000000001',
       2, 'listing-submission', 1, 'LOW', repeat('a', 64),
       'baseline-listing-submit-0002', repeat('b', 64),
       'SUBMITTED', 'PENDING_REVIEW', 3, now()
     )`,
    "23514",
  );
  await expectSqlState(
    "moderation evaluation immutability",
    `UPDATE moderation_evaluations
        SET rule_set_version = 2
      WHERE id = '00000000-0000-4000-8000-000000000030'`,
    "P0001",
  );
  await expectSqlState(
    "moderation rule-hit code",
    `INSERT INTO moderation_rule_hits (
       id, evaluation_id, rule_code, rule_version, severity, evidence_key
     )
     VALUES (
       '00000000-0000-4000-8000-000000000032',
       '00000000-0000-4000-8000-000000000030',
       'unsafe code', 1, 'MEDIUM', 'body'
     )`,
    "23514",
  );
  await client.query(
    `INSERT INTO moderation_rule_hits (
       id, evaluation_id, rule_code, rule_version, severity, evidence_key
     )
     VALUES (
       '00000000-0000-4000-8000-000000000033',
       '00000000-0000-4000-8000-000000000030',
       'NEW_ACCOUNT', 1, 'MEDIUM', 'account_age'
     )`,
  );
  await expectSqlState(
    "moderation rule-hit immutability",
    `DELETE FROM moderation_rule_hits
      WHERE id = '00000000-0000-4000-8000-000000000033'`,
    "P0001",
  );
  await client.query(
    `INSERT INTO moderation_evaluations (
       id, listing_id, actor_user_id, listing_version, rule_set_key, rule_set_version,
       risk_tier, input_hash, idempotency_key, request_hash,
       result_content_status, result_moderation_status, result_listing_version, occurred_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000034',
       '00000000-0000-4000-8000-000000000004',
       '00000000-0000-4000-8000-000000000001',
       2, 'listing-submission', 1, 'HIGH', repeat('a', 64),
       'baseline-listing-submit-0003', repeat('b', 64),
       'SUBMITTED', 'ESCALATED', 3, now()
     )`,
  );
  await client.query(
    `INSERT INTO moderation_cases (
       id, evaluation_id, target_type, target_id, queue, priority, status, version, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000035',
       '00000000-0000-4000-8000-000000000034',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'listing-submission',
       80,
       'OPEN',
       1,
       now()
     )`,
  );
  await client.query(
    `INSERT INTO moderation_case_snapshots (
       id, case_id, listing_version, snapshot, snapshot_hash, captured_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000036',
       '00000000-0000-4000-8000-000000000035',
       3,
       '{"sensitiveFieldsRedacted":true}'::jsonb,
       repeat('c', 64),
       now()
     )`,
  );
  await expectSqlState(
    "moderation case positive version",
    `UPDATE moderation_cases
        SET version = 0
      WHERE id = '00000000-0000-4000-8000-000000000035'`,
    "23514",
  );
  await expectSqlState(
    "moderation action idempotency evidence pairing",
    `INSERT INTO moderation_actions (
       id, case_id, actor_id, action, reason_code, idempotency_key
     )
     VALUES (
       '00000000-0000-4000-8000-000000000037',
       '00000000-0000-4000-8000-000000000035',
       '00000000-0000-4000-8000-000000000001',
       'APPROVE',
       'CONTENT_POLICY_COMPLIANT',
       'baseline-moderation-action-invalid'
     )`,
    "23514",
  );
  await expectSqlState(
    "moderation snapshot immutability",
    `UPDATE moderation_case_snapshots
        SET snapshot_hash = repeat('d', 64)
      WHERE id = '00000000-0000-4000-8000-000000000036'`,
    "P0001",
  );
  await client.query(
    `INSERT INTO moderation_actions (
       id, case_id, actor_id, action, reason_code, idempotency_key, request_hash
     )
     VALUES (
       '00000000-0000-4000-8000-000000000038',
       '00000000-0000-4000-8000-000000000035',
       '00000000-0000-4000-8000-000000000001',
       'APPROVE',
       'CONTENT_POLICY_COMPLIANT',
       'baseline-moderation-action-valid',
       repeat('e', 64)
     )`,
  );
  await expectSqlState(
    "moderation action immutability",
    `DELETE FROM moderation_actions
      WHERE id = '00000000-0000-4000-8000-000000000038'`,
    "P0001",
  );
  await client.query(
    `INSERT INTO reports (
       id, reporter_id, target_type, target_id, reason_code, details,
       idempotency_key, request_hash, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000050',
       '00000000-0000-4000-8000-000000000001',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'MISLEADING_INFORMATION',
       'Synthetic evidence used only inside a rolled-back baseline check.',
       'baseline-report-create-0001',
       repeat('f', 64),
       now()
     )`,
  );
  await expectSqlState(
    "active report deduplication",
    `INSERT INTO reports (
       id, reporter_id, target_type, target_id, reason_code, details,
       idempotency_key, request_hash, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000051',
       '00000000-0000-4000-8000-000000000001',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'OTHER',
       'A second active report for the same reporter and target must fail.',
       'baseline-report-create-0002',
       repeat('a', 64),
       now()
     )`,
    "23505",
  );
  await expectSqlState(
    "report target type",
    `INSERT INTO reports (
       id, reporter_id, target_type, target_id, reason_code,
       idempotency_key, request_hash, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000052',
       '00000000-0000-4000-8000-000000000001',
       'USER',
       '00000000-0000-4000-8000-000000000004',
       'OTHER',
       'baseline-report-create-0003',
       repeat('a', 64),
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "moderation report case source",
    `INSERT INTO moderation_cases (
       id, target_type, target_id, queue, priority, status, version, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000053',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'listing-report',
       50,
       'OPEN',
       1,
       now()
     )`,
    "23514",
  );
  await client.query(
    `INSERT INTO moderation_appeals (
       id, moderation_action_id, appellant_id, statement,
       idempotency_key, request_hash, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000054',
       '00000000-0000-4000-8000-000000000038',
       '00000000-0000-4000-8000-000000000001',
       'Synthetic appeal evidence used only inside a rolled-back baseline check.',
       'baseline-appeal-create-0001',
       repeat('b', 64),
       now()
     )`,
  );
  await expectSqlState(
    "appeal resolution evidence pairing",
    `UPDATE moderation_appeals
        SET status = 'RESTORED',
            decision_code = 'ACTION_OVERTURNED'
      WHERE id = '00000000-0000-4000-8000-000000000054'`,
    "23514",
  );
  await expectSqlState(
    "moderation appeal case source",
    `INSERT INTO moderation_cases (
       id, target_type, target_id, queue, priority, status, version, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000055',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'listing-appeal',
       70,
       'OPEN',
       1,
       now()
     )`,
    "23514",
  );

  await expectSqlState(
    "review rating check",
    `INSERT INTO reviews (
       id, author_id, target_type, target_id, rating, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000005',
       '00000000-0000-4000-8000-000000000001',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       0,
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "order subject check",
    `INSERT INTO orders (
       id, order_type, items, amount, idempotency_key, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000006',
       'TEST',
       '[]'::jsonb,
       100.00,
       'baseline-negative-subject',
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "listing owner foreign key",
    `INSERT INTO listings (
       id, type, owner_id, category_id, region_id, title, slug, body, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000007',
       'RENTAL',
       '00000000-0000-4000-8000-999999999999',
       '00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000002',
       'Invalid owner relation',
       'invalid-owner-relation',
       'Fictional data expected to fail its owner foreign key constraint.',
       now()
     )`,
    "23503",
  );
  await client.query(
    `INSERT INTO category_form_schema_versions (
       id, category_id, version, revision, definition, content_hash,
       created_at, updated_at, published_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000011',
       '00000000-0000-4000-8000-000000000003',
       1,
       1,
       '{"categoryId":"00000000-0000-4000-8000-000000000003","version":1,"fields":[]}'::jsonb,
       repeat('a', 64),
       now(),
       now(),
       now()
     )`,
  );
  await expectSqlState(
    "published form schema immutability",
    `UPDATE category_form_schema_versions
        SET content_hash = repeat('b', 64)
      WHERE id = '00000000-0000-4000-8000-000000000011'`,
    "55000",
  );
  await client.query(
    `INSERT INTO region_aliases (id, region_id, locale, value, normalized_value)
     VALUES (
       '00000000-0000-4000-8000-000000000009',
       '00000000-0000-4000-8000-000000000002',
       'und',
       'TST',
       'tst'
     )`,
  );
  await expectSqlState(
    "region alias normalized uniqueness",
    `INSERT INTO region_aliases (id, region_id, locale, value, normalized_value)
     VALUES (
       '00000000-0000-4000-8000-000000000010',
       '00000000-0000-4000-8000-000000000002',
       'und',
       'T.S.T.',
       'tst'
     )`,
    "23505",
  );
  await expectSqlState(
    "media quarantine object key and hash checks",
    `INSERT INTO media_assets (
       id, owner_id, purpose, kind, bucket, object_key, mime_type, byte_size,
       sha256, idempotency_key, request_hash, upload_expires_at, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000012',
       '00000000-0000-4000-8000-000000000001',
       'LISTING_MEDIA',
       'IMAGE',
       'socal-test-quarantine',
       'public/original-name.svg',
       'image/svg+xml',
       100,
       repeat('A', 64),
       'baseline-media-negative',
       repeat('b', 64),
       now() + interval '5 minutes',
       now()
     )`,
    "23514",
  );
  await client.query(
    `INSERT INTO platform_role_assignments (
       id, user_id, role, scope, reason_code, granted_by_id
     )
     VALUES (
       '00000000-0000-4000-8000-000000000013',
       '00000000-0000-4000-8000-000000000001',
       'MODERATOR',
       '{"regions":["US-CA-SOCAL"]}'::jsonb,
       'BASELINE_TEST',
       '00000000-0000-4000-8000-000000000001'
     )`,
  );
  await expectSqlState(
    "platform role active uniqueness",
    `INSERT INTO platform_role_assignments (
       id, user_id, role, reason_code
     )
     VALUES (
       '00000000-0000-4000-8000-000000000014',
       '00000000-0000-4000-8000-000000000001',
       'MODERATOR',
       'BASELINE_DUPLICATE'
     )`,
    "23505",
  );
  await expectSqlState(
    "platform role object scope",
    `INSERT INTO platform_role_assignments (
       id, user_id, role, scope, reason_code
     )
     VALUES (
       '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000001',
       'SUPPORT',
       '[]'::jsonb,
       'BASELINE_SCOPE'
     )`,
    "23514",
  );
  await expectSqlState(
    "platform role revocation provenance",
    `INSERT INTO platform_role_assignments (
       id, user_id, role, reason_code, revoked_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000016',
       '00000000-0000-4000-8000-000000000001',
       'FINANCE',
       'BASELINE_REVOCATION',
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "MFA session strength coherence",
    `INSERT INTO auth_sessions (
       id, user_id, token_hash, authentication_strength,
       expires_at, idle_expires_at, last_seen_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000017',
       '00000000-0000-4000-8000-000000000001',
       repeat('b', 64),
       'MFA',
       now() + interval '1 hour',
       now() + interval '30 minutes',
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "MFA credential state coherence",
    `INSERT INTO mfa_credentials (
       id, user_id, status, encrypted_secret, key_version,
       enrollment_expires_at, created_at, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000018',
       '00000000-0000-4000-8000-000000000001',
       'ACTIVE',
       'v1.synthetic',
       1,
       now() + interval '10 minutes',
       now(),
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "password state coherence",
    `UPDATE users
        SET password_hash = '$scrypt$ln=17,r=8,p=1$${"a".repeat(43)}$${"b".repeat(86)}',
            password_changed_at = NULL
      WHERE id = '00000000-0000-4000-8000-000000000001'`,
    "23514",
  );
  await expectSqlState(
    "password recovery window coherence",
    `INSERT INTO password_recovery_requests (
       id, user_id, channel, destination_hash, token_hash, ip_hash, device_hash,
       available_at, expires_at, created_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000019',
       '00000000-0000-4000-8000-000000000001',
       'EMAIL',
       repeat('c', 64),
       repeat('d', 64),
       repeat('e', 64),
       repeat('f', 64),
       now() - interval '1 minute',
       now() + interval '10 minutes',
       now()
     )`,
    "23514",
  );
  await expectSqlState(
    "outbox attempt bound",
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, attempts
     )
     VALUES (
       '00000000-0000-4000-8000-000000000020',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'listing.submitted',
       '{}'::jsonb,
       101
     )`,
    "23514",
  );
  await expectSqlState(
    "outbox event type bound",
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload
     )
     VALUES (
       '00000000-0000-4000-8000-000000000021',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'Invalid Event',
       '{}'::jsonb
     )`,
    "23514",
  );
  await expectSqlState(
    "outbox published state coherence",
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, status
     )
     VALUES (
       '00000000-0000-4000-8000-000000000022',
       'LISTING',
       '00000000-0000-4000-8000-000000000004',
       'listing.submitted',
       '{}'::jsonb,
       'PUBLISHED'
     )`,
    "23514",
  );
  await client.query(
    `INSERT INTO media_assets (
       id, owner_id, purpose, kind, bucket, object_key, mime_type, byte_size,
       sha256, idempotency_key, request_hash, upload_expires_at, updated_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000023',
       '00000000-0000-4000-8000-000000000001',
       'LISTING_MEDIA',
       'IMAGE',
       'socal-test-quarantine',
       'quarantine/00/00000000-0000-4000-8000-000000000023/original',
       'image/jpeg',
       100,
       repeat('a', 64),
       'baseline-media-processing',
       repeat('b', 64),
       now() + interval '5 minutes',
       now()
     )`,
  );
  await expectSqlState(
    "media READY lifecycle coherence",
    `UPDATE media_assets
        SET status = 'READY',
            lifecycle_version = 1
      WHERE id = '00000000-0000-4000-8000-000000000023'`,
    "23514",
  );
  await expectSqlState(
    "listing media READY binding coherence",
    `UPDATE media_assets
        SET listing_id = '00000000-0000-4000-8000-000000000004'
      WHERE id = '00000000-0000-4000-8000-000000000023'`,
    "23514",
  );
  await expectSqlState(
    "media rejection code bound",
    `UPDATE media_assets
        SET status = 'REJECTED',
            uploaded_at = now(),
            processed_at = now(),
            rejection_code = 'raw provider detail'
      WHERE id = '00000000-0000-4000-8000-000000000023'`,
    "23514",
  );
  await expectSqlState(
    "media variant safe key and MIME",
    `INSERT INTO media_variants (
       id, media_asset_id, kind, bucket, object_key, mime_type, byte_size,
       sha256, width, height
     )
     VALUES (
       '00000000-0000-4000-8000-000000000024',
       '00000000-0000-4000-8000-000000000023',
       'FULL',
       'socal-safe-media',
       'public/original.svg',
       'image/svg+xml',
       100,
       repeat('a', 64),
       100,
       100
     )`,
    "23514",
  );

  await expectSqlState(
    "published notification template update",
    `UPDATE notification_templates
        SET title = 'Unsafe mutation'
      WHERE id = '4f000000-0000-4000-8000-000000000004'`,
    "P0001",
  );
  await expectSqlState(
    "published notification template deletion",
    `DELETE FROM notification_templates
      WHERE id = '4f000000-0000-4000-8000-000000000004'`,
    "P0001",
  );

  await client.query(
    `INSERT INTO auth_sessions (
       id, user_id, token_hash, expires_at, idle_expires_at, last_seen_at
     )
     VALUES (
       '00000000-0000-4000-8000-000000000008',
       '00000000-0000-4000-8000-000000000001',
       repeat('a', 64),
       now() + interval '1 hour',
       now() + interval '30 minutes',
       now()
     )`,
  );
  await client.query(
    `UPDATE users
        SET status = 'SUSPENDED'
      WHERE id = '00000000-0000-4000-8000-000000000001'`,
  );
  const stateRevokedSession = await client.query(
    `SELECT revoked_at
       FROM auth_sessions
      WHERE id = '00000000-0000-4000-8000-000000000008'`,
  );
  if (stateRevokedSession.rowCount !== 1 || !stateRevokedSession.rows[0]?.revoked_at) {
    throw new Error("User status change did not revoke the active session");
  }
  await client.query("ROLLBACK");

  console.log(
    JSON.stringify({
      event: "database.baseline.validated",
      migrations: migrations.rows.map((row) => row.migration_name),
      extensions: extensions.rows.map((row) => row.extname),
      customIndexes: customIndexes.rowCount,
      sessionLifecycleColumns: sessionLifecycleColumns.rows.map((column) => column.column_name),
      otpChallengeColumns: otpChallengeColumns.rows.map((column) => column.column_name),
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
      trustSafetyStorage: true,
      notificationStorage: true,
      organizationMembershipLifecycle: true,
      remainingVerticalStorage: true,
      negativeCases: savepointSequence,
    }),
  );
} finally {
  await client.end();
}
