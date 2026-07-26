import { randomUUID } from "node:crypto";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("repository transaction isolation", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("rolls back both successful and failed test callbacks without row leakage", async () => {
    const successfulId = randomUUID();
    await database.withRollback(async (transaction) => {
      await transaction.user.create({
        data: { id: successfulId, email: `${successfulId}@example.invalid` },
      });
      await expect(transaction.user.count({ where: { id: successfulId } })).resolves.toBe(1);
    });
    await expect(database.client.user.count({ where: { id: successfulId } })).resolves.toBe(0);

    const failedId = randomUUID();
    await expect(
      database.withRollback(async (transaction) => {
        await transaction.user.create({
          data: { id: failedId, email: `${failedId}@example.invalid` },
        });
        throw new Error("intentional integration failure");
      }),
    ).rejects.toThrow("intentional integration failure");
    await expect(database.client.user.count({ where: { id: failedId } })).resolves.toBe(0);
  });
});
