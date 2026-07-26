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
            to_regclass('public.orders') AS orders`,
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
  await client.query("ROLLBACK");

  console.log(
    JSON.stringify({
      event: "database.baseline.validated",
      migrations: migrations.rows.map((row) => row.migration_name),
      extensions: extensions.rows.map((row) => row.extname),
      customIndexes: customIndexes.rowCount,
      sessionLifecycleColumns: sessionLifecycleColumns.rows.map((column) => column.column_name),
      otpChallengeColumns: otpChallengeColumns.rows.map((column) => column.column_name),
      negativeCases: 3,
    }),
  );
} finally {
  await client.end();
}
