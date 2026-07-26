import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_INTEGRATION_URL) {
  throw new Error("DATABASE_INTEGRATION_URL is required; integration tests will not silently skip");
}

const vitestCli = fileURLToPath(new URL("../vitest.mjs", import.meta.resolve("vitest")));
const result = spawnSync(
  process.execPath,
  [vitestCli, "run", "--config", "vitest.config.ts", "--project", "@socal/database"],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
