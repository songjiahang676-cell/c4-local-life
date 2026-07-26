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
