import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const root = new URL("../", import.meta.url);
const [composeSource, dockerfileSource, dockerignoreSource] = await Promise.all([
  readFile(new URL("docker-compose.yml", root), "utf8"),
  readFile(new URL("Dockerfile", root), "utf8"),
  readFile(new URL(".dockerignore", root), "utf8"),
]);

const composeDocument = parseDocument(composeSource, { uniqueKeys: true });
if (composeDocument.errors.length > 0) {
  throw new Error(`Invalid Docker Compose YAML:\n${composeDocument.errors.map(String).join("\n")}`);
}

const compose = composeDocument.toJS();
const applications = {
  web: "web-runtime",
  admin: "admin-runtime",
  api: "api-runtime",
  worker: "worker-runtime",
};

for (const [serviceName, target] of Object.entries(applications)) {
  const service = compose.services?.[serviceName];
  if (!service) throw new Error(`Compose service ${serviceName} is missing`);
  if (service.build?.target !== target) {
    throw new Error(`Compose service ${serviceName} must build target ${target}`);
  }
  if (!service.profiles?.includes("app")) {
    throw new Error(`Compose service ${serviceName} must use the app profile`);
  }
  if (!service.security_opt?.includes("no-new-privileges:true")) {
    throw new Error(`Compose service ${serviceName} must disable privilege escalation`);
  }
  if (!service.cap_drop?.includes("ALL")) {
    throw new Error(`Compose service ${serviceName} must drop Linux capabilities`);
  }

  const targetMarker = new RegExp(`^FROM .+ AS ${target}$`, "m");
  const targetMatch = targetMarker.exec(dockerfileSource);
  if (!targetMatch) throw new Error(`Dockerfile target ${target} is missing`);
  const targetStart = targetMatch.index;
  const nextStage = dockerfileSource.indexOf("\nFROM ", targetStart + 1);
  const targetSource = dockerfileSource.slice(
    targetStart,
    nextStage === -1 ? dockerfileSource.length : nextStage,
  );
  if (!/^USER node$/m.test(targetSource)) {
    throw new Error(`Dockerfile target ${target} must run as the node user`);
  }
  if (!/^HEALTHCHECK /m.test(targetSource)) {
    throw new Error(`Dockerfile target ${target} must define a health check`);
  }
}

if (!/^\.env$/m.test(dockerignoreSource) || !/^node_modules$/m.test(dockerignoreSource)) {
  throw new Error(".dockerignore must exclude local secrets and dependencies");
}

if (
  !/^ARG DATABASE_URL=postgresql:\/\/build:build@127\.0\.0\.1:5432\/socal_build\?schema=public$/m.test(
    dockerfileSource,
  ) ||
  !/DATABASE_URL="\$\{DATABASE_URL\}" pnpm db:generate/.test(dockerfileSource)
) {
  throw new Error(
    "Docker build must provide the non-secret compile-only Prisma URL without copying .env",
  );
}

console.log(
  `Container contract checks passed: ${Object.keys(applications).length} non-root application targets.`,
);
