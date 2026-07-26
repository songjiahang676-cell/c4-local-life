import { readFile } from "node:fs/promises";

const codeownersPath = new URL("../.github/CODEOWNERS", import.meta.url);
const pullRequestTemplatePath = new URL("../.github/pull_request_template.md", import.meta.url);

const [codeownersSource, pullRequestTemplate] = await Promise.all([
  readFile(codeownersPath, "utf8"),
  readFile(pullRequestTemplatePath, "utf8"),
]);

const entries = new Map();
for (const rawLine of codeownersSource.split(/\r?\n/u)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const [pattern, ...owners] = line.split(/\s+/u);
  if (!pattern || owners.length === 0 || owners.some((owner) => !owner.startsWith("@"))) {
    throw new Error(`Invalid CODEOWNERS entry: ${rawLine}`);
  }
  entries.set(pattern, owners);
}

const requiredOwnership = new Map([
  ["*", 1],
  ["/.github/", 1],
  ["/apps/web/", 1],
  ["/apps/admin/", 1],
  ["/apps/api/", 1],
  ["/apps/worker/", 1],
  ["/packages/contracts/", 1],
  ["/packages/database/prisma/schema.prisma", 1],
  ["/packages/database/prisma/migrations/", 1],
  ["/openapi/", 1],
  ["/infra/", 1],
  ["/SECURITY.md", 1],
  ["/docs/14-security-privacy-compliance.md", 1],
  ["/docs/12-monetization-payments-ads.md", 1],
  ["/adr/", 1],
]);

const ownershipFailures = [];
for (const [pattern, minimumOwners] of requiredOwnership) {
  const owners = entries.get(pattern) ?? [];
  if (owners.length < minimumOwners) {
    ownershipFailures.push(`${pattern} requires at least ${minimumOwners} owner(s)`);
  }
}
if (ownershipFailures.length > 0) {
  throw new Error(`CODEOWNERS coverage is incomplete:\n${ownershipFailures.join("\n")}`);
}
const placeholderOwners = [
  ...new Set(
    [...entries.values()].flat().filter((owner) => /-(?:owners|maintainers)$/u.test(owner)),
  ),
];
if (placeholderOwners.length > 0) {
  throw new Error(`CODEOWNERS contains unresolved role aliases: ${placeholderOwners.join(", ")}`);
}

const requiredTemplateText = [
  "Backlog ID:",
  "Scope intentionally excluded:",
  "API/contract impact:",
  "Database schema/migration/backfill:",
  "Authorization/object ownership/tenant boundary:",
  "PII/privacy/upload/security abuse:",
  "Failure/idempotency/concurrency:",
  "Payment/ledger/webhook impact:",
  "Rollback or roll-forward:",
  "Actual commands/results:",
  "Not run and reason:",
  "pnpm openapi:lint",
  "pnpm db:migrate:safety",
  "Targeted authorization/abuse/contract/repository tests",
  "Required `Quality Gate` check is green",
  "Build non-root application images",
  "No `.env`, secret, real PII, production data",
];
const missingTemplateText = requiredTemplateText.filter(
  (text) => !pullRequestTemplate.includes(text),
);
if (missingTemplateText.length > 0) {
  throw new Error(
    `Pull request template is missing review requirements: ${missingTemplateText.join(", ")}`,
  );
}

console.log(
  `Repository governance checks passed: ${entries.size} ownership rules and ${requiredTemplateText.length} PR requirements.`,
);
