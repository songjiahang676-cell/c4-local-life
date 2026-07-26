import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeMigrationSql } from "../packages/database/src/migration-safety";

const migrationsRoot = resolve("packages/database/prisma/migrations");
async function main(): Promise<void> {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const blocked: Array<{ migration: string; line: number; rule: string }> = [];
  let approved = 0;
  for (const migration of migrations) {
    const sql = await readFile(resolve(migrationsRoot, migration, "migration.sql"), "utf8");
    for (const finding of analyzeMigrationSql(sql)) {
      if (finding.approved) {
        approved += 1;
      } else {
        blocked.push({ migration, line: finding.line, rule: finding.rule });
      }
    }
  }

  if (blocked.length > 0) {
    throw new Error(
      `Migration safety check blocked destructive SQL:\n${blocked
        .map(({ migration, line, rule }) => `${migration}/migration.sql:${line} ${rule}`)
        .join("\n")}`,
    );
  }

  console.log(
    `Migration safety check passed: ${migrations.length} migrations scanned, ${approved} documented exception(s).`,
  );
}

void main();
