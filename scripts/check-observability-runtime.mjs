import { spawn } from "node:child_process";

const baseUrl = "http://127.0.0.1:4000";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertPortAvailable() {
  try {
    await fetch(`${baseUrl}/v1/health/live`);
  } catch {
    return;
  }
  throw new Error("Port 4000 is already serving HTTP; refusing to validate an unknown process");
}

await assertPortAvailable();

const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "test",
    APP_ENV: process.env.APP_ENV ?? "test",
    PUBLIC_WEB_URL: process.env.PUBLIC_WEB_URL ?? "http://localhost:3000",
    PUBLIC_ADMIN_URL: process.env.PUBLIC_ADMIN_URL ?? "http://localhost:3001",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://example.invalid/socal?schema=public",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/0",
    OPENSEARCH_NODE: process.env.OPENSEARCH_NODE ?? "http://localhost:9200",
    SESSION_SECRET: process.env.SESSION_SECRET ?? "runtime-check-session-secret-at-least-32-bytes",
    OTP_SECRET: process.env.OTP_SECRET ?? "runtime-check-otp-secret-at-least-32-bytes",
    MFA_SECRET: process.env.MFA_SECRET ?? "runtime-check-mfa-secret-at-least-32-bytes",
    PASSWORD_PEPPER:
      process.env.PASSWORD_PEPPER ?? "runtime-check-password-pepper-at-least-32-bytes",
    CSRF_SECRET: process.env.CSRF_SECRET ?? "runtime-check-csrf-secret-at-least-32-bytes",
    OTEL_SERVICE_NAME: "socal-api-runtime-check",
    OTEL_SERVICE_VERSION: "test",
    PORT: "4000",
  },
  stdio: "ignore",
});

try {
  let liveResponse;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    try {
      liveResponse = await fetch(`${baseUrl}/v1/health/live`, {
        headers: { "x-request-id": "observability-runtime-check" },
      });
      if (liveResponse.ok) break;
    } catch {
      // Startup is still in progress.
    }
  }

  if (!liveResponse?.ok) throw new Error("Built API did not become live");
  const requestId = liveResponse.headers.get("x-request-id");
  const traceparent = liveResponse.headers.get("traceparent");
  if (requestId !== "observability-runtime-check") {
    throw new Error("Built API did not preserve the accepted request ID");
  }
  if (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(traceparent ?? "")) {
    throw new Error("Built API did not return a valid W3C traceparent");
  }

  const metricsResponse = await fetch(`${baseUrl}/metrics`);
  const metrics = await metricsResponse.text();
  if (!metricsResponse.ok || !metrics.includes("socal_http_requests_total")) {
    throw new Error("Built API did not expose HTTP RED metrics");
  }

  const [openApiJsonResponse, openApiYamlResponse] = await Promise.all([
    fetch(`${baseUrl}/docs/openapi.json`),
    fetch(`${baseUrl}/docs/openapi.yaml`),
  ]);
  const openApiJson = await openApiJsonResponse.json();
  const openApiYaml = await openApiYamlResponse.text();
  if (
    !openApiJsonResponse.ok ||
    !openApiYamlResponse.ok ||
    !String(openApiJson.openapi).startsWith("3.1.") ||
    Object.keys(openApiJson.paths ?? {}).length !== 68 ||
    Object.keys(openApiJson.components?.schemas ?? {}).length !== 163 ||
    !openApiYaml.startsWith("openapi: 3.1.") ||
    !openApiYamlResponse.headers.get("content-type")?.includes("application/yaml")
  ) {
    throw new Error("Built API did not serve the canonical OpenAPI JSON/YAML contract");
  }

  console.log(
    "API runtime check passed: request ID, W3C trace, RED metrics, and canonical OpenAPI JSON/YAML.",
  );
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
}
