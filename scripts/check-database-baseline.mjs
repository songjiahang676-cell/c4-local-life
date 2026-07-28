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
            to_regclass('public.platform_role_assignments') AS platform_role_assignments`,
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
          'listings_published_partial'
        )`,
  );
  if (customIndexes.rowCount !== 3) {
    throw new Error("One or more custom listing indexes are missing");
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
      negativeCases: 9,
    }),
  );
} finally {
  await client.end();
}
