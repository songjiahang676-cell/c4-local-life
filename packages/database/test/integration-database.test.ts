import { assertIntegrationDatabaseUrl } from "../src/testing/integration-database";
import { describe, expect, it } from "vitest";

describe("repository integration database safety", () => {
  it("accepts clearly disposable local PostgreSQL databases", () => {
    expect(() =>
      assertIntegrationDatabaseUrl(
        "postgresql://socal@127.0.0.1:55432/socal_integration?schema=public",
      ),
    ).not.toThrow();
  });

  it("rejects ambiguous or remote database targets by default", () => {
    expect(() =>
      assertIntegrationDatabaseUrl("postgresql://socal@127.0.0.1:5432/socal?schema=public"),
    ).toThrow("clearly identify");
    expect(() =>
      assertIntegrationDatabaseUrl(
        "postgresql://socal@production.example.com:5432/socal_test?schema=public",
      ),
    ).toThrow("Remote integration databases require");
  });
});
