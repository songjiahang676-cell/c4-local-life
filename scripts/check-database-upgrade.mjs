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
  if (sentinel.rowCount !== 1 || enumValue.rowCount !== 1) {
    throw new Error("Latest migration did not preserve prior data and expected schema state");
  }

  console.log(
    JSON.stringify({
      event: "database.upgrade.validated",
      compatibilityBaseline: compatibility.label,
      priorMigrationCount: priorMigrations.length,
      appliedMigrationCount: upgradeMigrations.length,
      sentinelPreserved: true,
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
