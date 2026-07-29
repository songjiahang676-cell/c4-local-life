import { fileURLToPath } from "node:url";
import { defineConfig, type TestProjectConfiguration } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const domSetupFile = fileURLToPath(new URL("./test/setup-dom.ts", import.meta.url));

function project(
  name: string,
  relativeRoot: string,
  environment: "node" | "jsdom" = "node",
): TestProjectConfiguration {
  return {
    extends: true,
    root: fileURLToPath(new URL(relativeRoot, import.meta.url)),
    test: {
      name,
      environment,
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: environment === "jsdom" ? [domSetupFile] : [],
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@socal/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
      "@socal/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url),
      ),
      "@socal/database/auth-session": fileURLToPath(
        new URL("./packages/database/src/repositories/auth-session.repository.ts", import.meta.url),
      ),
      "@socal/database/mfa-credential": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/mfa-credential.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/password-credential": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/password-credential.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/otp-challenge": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/otp-challenge.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/organization": fileURLToPath(
        new URL("./packages/database/src/repositories/organization.repository.ts", import.meta.url),
      ),
      "@socal/database/listing-draft": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/listing-draft.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/listing": fileURLToPath(
        new URL("./packages/database/src/repositories/listing.repository.ts", import.meta.url),
      ),
      "@socal/database/search-discovery": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/search-discovery.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/listing-submission": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/listing-submission.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/listing-revision": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/listing-revision.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/moderation-case": fileURLToPath(
        new URL(
          "./packages/database/src/repositories/moderation-case.repository.ts",
          import.meta.url,
        ),
      ),
      "@socal/database/trust-safety": fileURLToPath(
        new URL("./packages/database/src/repositories/trust-safety.repository.ts", import.meta.url),
      ),
      "@socal/database/notification": fileURLToPath(
        new URL("./packages/database/src/repositories/notification.repository.ts", import.meta.url),
      ),
      "@socal/database/outbox": fileURLToPath(
        new URL("./packages/database/src/repositories/outbox-event.repository.ts", import.meta.url),
      ),
      "@socal/database/media": fileURLToPath(
        new URL("./packages/database/src/repositories/media-asset.repository.ts", import.meta.url),
      ),
      "@socal/database/taxonomy": fileURLToPath(
        new URL("./packages/database/src/taxonomy.ts", import.meta.url),
      ),
      "@socal/observability": fileURLToPath(
        new URL("./packages/observability/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    passWithNoTests: false,
    reporters: ["default", "junit", "json"],
    outputFile: {
      junit: `${repositoryRoot}/reports/test-results/junit.xml`,
      json: `${repositoryRoot}/reports/test-results/results.json`,
    },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json", "lcov"],
      reportsDirectory: `${repositoryRoot}/reports/coverage`,
      reportOnFailure: true,
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/main.ts",
        "**/.next/**",
        "**/dist/**",
        "**/generated/**",
        "**/test/**",
      ],
    },
    projects: [
      project("@socal/web", "./apps/web/", "jsdom"),
      project("@socal/admin", "./apps/admin/", "jsdom"),
      project("@socal/api", "./apps/api/"),
      project("@socal/worker", "./apps/worker/"),
      project("@socal/config", "./packages/config/"),
      project("@socal/observability", "./packages/observability/"),
      project("@socal/contracts", "./packages/contracts/"),
      project("@socal/database", "./packages/database/"),
      project("@socal/ui", "./packages/ui/", "jsdom"),
    ],
  },
});
