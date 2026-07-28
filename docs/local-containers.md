# Local application containers

FND-005 defines four production-shaped application targets in the root `Dockerfile`:
`web-runtime`, `admin-runtime`, `api-runtime`, and `worker-runtime`. Each target runs as the
unprivileged image-provided `node` user and has a native Node.js health check.

Prisma client generation parses the datasource configuration but does not connect to PostgreSQL.
The build stage therefore supplies a fixed, non-secret loopback `DATABASE_URL` only to the generate
and compile commands. It never copies `.env`, never uses a deployable credential, and runtime
processes must still receive validated environment configuration through the deployment platform.

## Start the stack

Create the local runtime file once and keep it untracked:

```bash
cp .env.example .env
docker compose --profile app up --build
```

The application profile starts Web on 3000, Admin on 3001, API on 4000, and the Worker health
listener on 4001, together with their local infrastructure dependencies. To start only the
infrastructure dependencies, continue to use `pnpm infra:up`.

The one-shot `minio-init` service waits for MinIO, creates
`S3_QUARANTINE_BUCKET` (default `socal-media-quarantine-local`) and `S3_MEDIA_BUCKET`
(default `socal-media-processed-local`) idempotently, and applies `anonymous none` to both.
The API/Worker use the internal `http://minio:9000` endpoint while the host keeps
`http://localhost:9000`. Do not reuse this development bootstrap as production provisioning;
production bucket policy, Block Public Access, encryption and lifecycle are Terraform-owned.

The application profile also starts `clamav/clamav:1.4` and does not start the Worker until clamd
is healthy. The Worker reads only quarantine objects, streams them to clamd, re-encodes accepted
images, and writes deterministic encrypted WebP variants to the processed bucket. `pnpm infra:up`
does not start ClamAV; use the application profile when exercising the complete media lifecycle.

Health endpoints:

| Process | Liveness          | Readiness          |
| ------- | ----------------- | ------------------ |
| Web     | `/health/live`    | `/health/ready`    |
| Admin   | `/health/live`    | `/health/ready`    |
| API     | `/v1/health/live` | `/v1/health/ready` |
| Worker  | `/health/live`    | `/health/ready`    |

Liveness only reports that the event loop can answer. Worker readiness additionally requires its
Redis connection. The Worker also receives PostgreSQL configuration and polls the canonical Outbox;
database polling failures are exposed through bounded logs and Outbox metrics while queued consumers
remain available. API readiness currently represents the HTTP process; database, Redis, and search
probes must be added when those adapters are wired, so it does not issue speculative dependency
traffic before the owning tasks.

## Validate and stop

```bash
pnpm containers:check
docker compose --profile app ps
docker compose down
```

The static contract check is useful when Docker is unavailable. It does not replace an actual image
build; CI builds all four targets, asserts their configured user is `node`, starts the four runtime
images on loopback-only ports, and waits for each readiness endpoint. The Worker smoke includes an
isolated Redis container and a syntactically valid database contract; hosted quality separately
replays all migrations and PostgreSQL integration tests. Local completion evidence must state whether
Docker ran.
