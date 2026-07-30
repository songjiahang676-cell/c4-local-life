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
if (!job.env?.REDIS_INTEGRATION_URL) {
  throw new Error("CI quality gate must run BullMQ integration tests against Redis");
}
if (!job.env?.CLAMAV_INTEGRATION_HOST || !job.env?.CLAMAV_INTEGRATION_PORT) {
  throw new Error("CI quality gate must run media malware integration tests against clamd");
}
if (!job.env?.OPENSEARCH_INTEGRATION_URL || !job.env?.OPENSEARCH_NODE) {
  throw new Error("CI quality gate must run search integration tests against OpenSearch");
}
if (!job.services?.clamav || !String(job.services.clamav.image).startsWith("clamav/clamav:")) {
  throw new Error("CI quality gate must provide a versioned ClamAV service");
}
if (!String(job.services.clamav.options).includes("clamdscan --ping 1")) {
  throw new Error("CI ClamAV service must be health checked before integration tests");
}
if (
  !job.services?.opensearch ||
  !String(job.services.opensearch.image).startsWith("opensearchproject/opensearch:")
) {
  throw new Error("CI quality gate must provide a versioned OpenSearch service");
}
if (!String(job.services.opensearch.options).includes("_cluster/health")) {
  throw new Error("CI OpenSearch service must be health checked before integration tests");
}
if (job.services.opensearch.env?.DISABLE_SECURITY_PLUGIN !== "true") {
  throw new Error("CI OpenSearch service must explicitly disable the demo security installer");
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
  "pnpm performance:check",
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
if (!containerRunScripts.includes("--env DATABASE_URL=")) {
  throw new Error("CI Worker container smoke must provide the required database contract");
}
if (!containerRunScripts.includes("--env OPENSEARCH_NODE=")) {
  throw new Error("CI Worker container smoke must provide the OpenSearch contract");
}

console.log(
  `CI workflow checks passed: ${requiredCommands.length} quality commands and four build/runtime smoke targets are enforced.`,
);
