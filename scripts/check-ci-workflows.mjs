import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const workflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);
const source = await readFile(workflowPath, "utf8");
const document = parseDocument(source, { uniqueKeys: true });

if (document.errors.length > 0) {
  throw new Error(`Invalid CI workflow YAML:\n${document.errors.map(String).join("\n")}`);
}

const workflow = document.toJS();
const job = workflow.jobs?.["quality-gate"];
if (!job) {
  throw new Error("CI workflow must define the quality-gate job");
}
const containerJob = workflow.jobs?.["container-build"];
if (!containerJob) {
  throw new Error("CI workflow must define the container-build job");
}
if (!job.env?.DATABASE_INTEGRATION_URL) {
  throw new Error("CI quality gate must run repository integration tests against PostgreSQL");
}

if (workflow.permissions?.contents !== "read") {
  throw new Error("CI workflow must keep default contents permission read-only");
}

if (!workflow.concurrency?.["cancel-in-progress"]) {
  throw new Error("CI workflow must cancel superseded runs");
}

const runScripts = (job.steps ?? [])
  .map((step) => step.run)
  .filter((run) => typeof run === "string")
  .join("\n");

const requiredCommands = [
  "bash scripts/check-architecture.sh",
  "pnpm install --frozen-lockfile --strict-peer-dependencies",
  "pnpm governance:check",
  "pnpm config:check",
  "pnpm containers:check",
  "pnpm db:seed:validate",
  "pnpm openapi:lint",
  "pnpm openapi:check",
  "pnpm format:check",
  "pnpm db:validate",
  "pnpm db:generate",
  "pnpm db:migrate:deploy",
  "pnpm db:migrate:safety",
  "pnpm db:upgrade:check",
  "pnpm db:baseline:check",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm test",
  "pnpm build",
  "pnpm observability:check",
  "pnpm exec playwright install --with-deps chromium",
  "pnpm test:e2e:ci",
];

const missingCommands = requiredCommands.filter((command) => !runScripts.includes(command));
if (missingCommands.length > 0) {
  throw new Error(`CI quality gate is missing commands: ${missingCommands.join(", ")}`);
}

const containerRunScripts = (containerJob.steps ?? [])
  .map((step) => step.run)
  .filter((run) => typeof run === "string")
  .join("\n");
for (const target of ["web-runtime", "admin-runtime", "api-runtime", "worker-runtime"]) {
  if (!containerRunScripts.includes(target)) {
    throw new Error(`CI container build is missing target ${target}`);
  }
}
if (!containerRunScripts.includes("docker build --target")) {
  throw new Error("CI container build job must execute docker build --target");
}
for (const healthPath of [
  "/health/ready",
  "/v1/health/ready",
  "docker image inspect",
  "socal-api-runtime:ci",
  "socal-worker-runtime:ci",
]) {
  if (!containerRunScripts.includes(healthPath)) {
    throw new Error(`CI container runtime smoke is missing ${healthPath}`);
  }
}

console.log(
  `CI workflow checks passed: ${requiredCommands.length} quality commands and four build/runtime smoke targets are enforced.`,
);
