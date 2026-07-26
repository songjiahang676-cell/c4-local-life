import { describe, expect, it } from "vitest";
import { analyzeMigrationSql } from "../src/migration-safety";

describe("migration safety analysis", () => {
  it("flags destructive schema and data statements", () => {
    const findings = analyzeMigrationSql(`
      ALTER TABLE "listings" DROP COLUMN "body";
      UPDATE "listings" SET "status" = 'ARCHIVED';
      TRUNCATE TABLE "messages";
    `);

    expect(findings.map(({ rule }) => rule)).toEqual([
      "DROP_COLUMN",
      "UPDATE_DATA",
      "TRUNCATE_DATA",
    ]);
    expect(findings.every(({ approved }) => !approved)).toBe(true);
  });

  it("does not confuse referential actions or quoted text with destructive SQL", () => {
    expect(
      analyzeMigrationSql(`
        ALTER TABLE "messages"
          ADD CONSTRAINT "messages_sender_fkey"
          FOREIGN KEY ("sender_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
        ALTER TABLE "orders"
          ADD CONSTRAINT "orders_subject_check"
          CHECK ("user_id" IS NOT NULL OR "organization_id" IS NOT NULL);
        COMMENT ON TABLE "messages" IS 'DROP TABLE users';
      `),
    ).toEqual([]);
  });

  it("requires a documented reason and rollback before approving a rule", () => {
    const approved = analyzeMigrationSql(`
      -- migration-safety: allow DROP_COLUMN reason="contract completed after two releases" rollback="restore from retained shadow column"
      ALTER TABLE "listings" DROP COLUMN "legacy_body";
    `);
    const incomplete = analyzeMigrationSql(`
      -- migration-safety: allow DROP_COLUMN reason="missing rollback"
      ALTER TABLE "listings" DROP COLUMN "legacy_body";
    `);

    expect(approved).toMatchObject([{ rule: "DROP_COLUMN", approved: true }]);
    expect(incomplete).toMatchObject([{ rule: "DROP_COLUMN", approved: false }]);
  });
});
