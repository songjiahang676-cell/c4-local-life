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

Health endpoints:

| Process | Liveness          | Readiness          |
| ------- | ----------------- | ------------------ |
| Web     | `/health/live`    | `/health/ready`    |
| Admin   | `/health/live`    | `/health/ready`    |
| API     | `/v1/health/live` | `/v1/health/ready` |
| Worker  | `/health/live`    | `/health/ready`    |

Liveness only reports that the event loop can answer. Worker readiness additionally requires its
Redis connection. API readiness currently represents the HTTP process; database, Redis, and search
probes must be added when those adapters are wired, so it does not issue speculative dependency
traffic before the owning tasks.

## Validate and stop

```bash
pnpm containers:check
docker compose --profile app ps
docker compose down
```

The static contract check is useful when Docker is unavailable. It does not replace an actual image
build; CI builds all four targets and local completion evidence must state whether Docker ran.
