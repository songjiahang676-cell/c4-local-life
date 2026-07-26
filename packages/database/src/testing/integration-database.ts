import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client";

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertIntegrationDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    throw new Error("Repository integration tests require PostgreSQL");
  }
  if (!localHosts.has(url.hostname) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "true") {
    throw new Error(
      "Remote integration databases require ALLOW_REMOTE_INTEGRATION_DB=true and an isolated test target",
    );
  }
  const databaseName = url.pathname.replace(/^\//, "");
  if (!/(?:test|baseline|integration|empty)/i.test(databaseName)) {
    throw new Error("Integration database name must clearly identify a disposable test database");
  }
}

class RollbackAfterTest extends Error {}

export type IntegrationDatabase = {
  client: PrismaClient;
  withRollback<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export function createIntegrationDatabase(connectionString: string): IntegrationDatabase {
  assertIntegrationDatabaseUrl(connectionString);
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 4 }),
  });

  return {
    client,
    async withRollback<T>(
      callback: (transaction: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      let result: T | undefined;
      try {
        await client.$transaction(
          async (transaction) => {
            result = await callback(transaction);
            throw new RollbackAfterTest();
          },
          { maxWait: 5_000, timeout: 15_000 },
        );
      } catch (error: unknown) {
        if (!(error instanceof RollbackAfterTest)) throw error;
      }
      return result as T;
    },
    close: () => client.$disconnect(),
  };
}
