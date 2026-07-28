import SwaggerParser from "@apidevtools/swagger-parser";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import { createObservabilityRuntime } from "@socal/observability";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { FastifyInstance } from "fastify";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalOpenApiPath } from "../src/common/openapi-document";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import {
  CapturingOtpDeliveryGateway,
  MemoryOtpChallengeStore,
} from "./support/memory-otp-challenge.store";
import { MemoryOrganizationStore } from "./support/memory-organization.store";
import { CapturingMediaObjectStorage, MemoryMediaStore } from "./support/memory-media.store";
import { MemoryTaxonomyStore } from "./support/memory-taxonomy.store";

type JsonSchema = Record<string, unknown>;
type ResponseObject = {
  content?: Record<string, { schema?: JsonSchema }>;
};
type OperationObject = {
  operationId?: string;
  responses: Record<string, ResponseObject>;
};
type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", OperationObject>>;
type DereferencedOpenApi = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, JsonSchema> };
};

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-contract-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "contract-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "contract-otp-secret-with-more-than-32-bytes",
  CSRF_SECRET: "contract-csrf-secret-with-more-than-32-bytes",
});
const contractUserId = "20000000-0000-4000-8000-000000000001";
const contractOrganizationId = "40000000-0000-4000-8000-000000000001";

describe("canonical OpenAPI contract", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let contract: DereferencedOpenApi;
  let sessions: AuthSessionService;
  let otpDelivery: CapturingOtpDeliveryGateway;
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));

  beforeAll(async () => {
    const authSessionStore = new MemoryAuthSessionStore();
    authSessionStore.registerSubject(buildActiveSubject({ id: contractUserId }));
    authSessionStore.registerOrganization(contractUserId, {
      id: contractOrganizationId,
      type: "MERCHANT",
      displayName: "Contract Organization",
      slug: "contract-organization",
      role: "OWNER",
    });
    const organizationStore = new MemoryOrganizationStore();
    const organizationTimestamp = new Date("2026-07-28T18:00:00.000Z");
    organizationStore.registerForUser(
      contractUserId,
      {
        id: contractOrganizationId,
        type: "MERCHANT",
        displayName: "Contract Organization",
        legalName: null,
        slug: "contract-organization",
        status: "ACTIVE",
        verificationStatus: "UNVERIFIED",
        role: "OWNER",
        createdAt: organizationTimestamp,
        updatedAt: organizationTimestamp,
      },
      [
        {
          userId: contractUserId,
          displayName: "Contract User",
          avatarUrl: null,
          role: "OWNER",
          joinedAt: organizationTimestamp,
        },
      ],
    );
    const taxonomyStore = new MemoryTaxonomyStore(
      [
        {
          id: "50000000-0000-4000-8000-000000000001",
          parentId: null,
          code: "US",
          type: "COUNTRY",
          slug: "us",
          nameZhHans: "美国",
          nameEn: "United States",
          timezone: "America/Los_Angeles",
          latitude: null,
          longitude: null,
          isActive: true,
          sortOrder: 0,
          aliases: [{ locale: "en-US", value: "USA" }],
        },
      ],
      [
        {
          id: "60000000-0000-4000-8000-000000000001",
          parentId: null,
          vertical: "SERVICE",
          slug: "services",
          nameZhHans: "本地服务",
          nameEn: "Local Services",
          iconKey: "services",
          formSchemaVersion: 1,
          isActive: true,
          sortOrder: 0,
          aliases: [{ locale: "zh-Hans", value: "找师傅" }],
        },
      ],
    );
    contract = (await SwaggerParser.validate(
      canonicalOpenApiPath(),
    )) as unknown as DereferencedOpenApi;
    const otpChallengeStore = new MemoryOtpChallengeStore();
    otpChallengeStore.userId = contractUserId;
    otpDelivery = new CapturingOtpDeliveryGateway();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore,
      otpChallengeStore,
      otpDeliveryGateway: otpDelivery,
      organizationStore,
      mediaStore: new MemoryMediaStore(),
      mediaObjectStorage: new CapturingMediaObjectStorage(),
      taxonomyStore,
      observability: createObservabilityRuntime({
        serviceName: "socal-api-contract-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    sessions = app.get(AuthSessionService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("parses OpenAPI 3.1 with unique operation IDs and the expected baseline scale", () => {
    const operationIds = Object.values(contract.paths).flatMap((pathItem) =>
      Object.values(pathItem)
        .map((operation) => operation?.operationId)
        .filter((operationId): operationId is string => Boolean(operationId)),
    );

    expect(contract.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(contract.paths)).toHaveLength(37);
    expect(Object.keys(contract.components.schemas)).toHaveLength(70);
    expect(operationIds).toHaveLength(46);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("validates every component example against its dereferenced JSON Schema", () => {
    const examples = Object.entries(contract.components.schemas).flatMap(([name, schema]) => {
      const schemaExamples: unknown[] = Array.isArray(schema.examples)
        ? (schema.examples as unknown[])
        : [];

      return schemaExamples.map((example: unknown) => ({
        name,
        schema,
        example,
      }));
    });

    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const example of examples) {
      const validate = ajv.compile(example.schema);
      expect(validate(example.example), `${example.name}: ${ajv.errorsText(validate.errors)}`).toBe(
        true,
      );
    }
  });

  it("serves the canonical JSON and YAML documents rather than a decorator-derived subset", async () => {
    const [jsonResponse, yamlResponse] = await Promise.all([
      server.inject({ method: "GET", url: "/docs/openapi.json" }),
      server.inject({ method: "GET", url: "/docs/openapi.yaml" }),
    ]);
    const servedJson = jsonResponse.json<DereferencedOpenApi>();
    const servedYaml = parse(yamlResponse.body) as DereferencedOpenApi;

    expect(jsonResponse.statusCode).toBe(200);
    expect(yamlResponse.statusCode).toBe(200);
    expect(yamlResponse.headers["content-type"]).toContain("application/yaml");
    expect(Object.keys(servedJson.paths)).toHaveLength(37);
    expect(Object.keys(servedYaml.paths)).toHaveLength(37);
    expect(servedJson.info.version).toBe(contract.info.version);
  });

  it("validates implemented health and Problem Details responses against the contract", async () => {
    const healthResponse = await server.inject({ method: "GET", url: "/v1/health/live" });
    const invalidResponse = await server.inject({
      method: "GET",
      url: "/v1/listings?unknown=not-allowed",
    });
    const healthSchema =
      contract.paths["/health/live"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
    const problemSchema =
      contract.paths["/listings"]?.get?.responses["400"]?.content?.["application/problem+json"]
        ?.schema;

    expect(healthSchema).toBeDefined();
    expect(problemSchema).toBeDefined();
    expect(healthResponse.statusCode).toBe(200);
    expect(invalidResponse.statusCode).toBe(400);
    expect(ajv.validate(healthSchema ?? false, healthResponse.json())).toBe(true);
    expect(ajv.validate(problemSchema ?? false, invalidResponse.json())).toBe(true);
  });

  it("declares authentication failures for protected listing creation", () => {
    const operation = contract.paths["/listings"]?.post;

    expect(operation?.responses["401"]).toBeDefined();
    expect(operation?.responses["403"]).toBeDefined();
  });

  it("validates the implemented current-session projection against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    const response = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}` },
    });
    const sessionSchema =
      contract.paths["/auth/session"]?.get?.responses["200"]?.content?.["application/json"]?.schema;

    expect(response.statusCode).toBe(200);
    expect(sessionSchema).toBeDefined();
    expect(ajv.validate(sessionSchema ?? false, response.json())).toBe(true);
  });

  it("validates OTP acceptance and verification responses against the contract", async () => {
    const requested = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      headers: { "x-device-id": "contract-device-0001" },
      payload: {
        channel: "EMAIL",
        destination: "contract-member@example.invalid",
        purpose: "SIGN_IN",
        locale: "en-US",
      },
    });
    const accepted = requested.json<{ challengeId: string }>();
    const code = otpDelivery.messages.at(-1)?.code;
    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      headers: { "x-device-id": "contract-device-0001" },
      payload: { challengeId: accepted.challengeId, code },
    });
    const acceptedSchema =
      contract.paths["/auth/otp/request"]?.post?.responses["202"]?.content?.["application/json"]
        ?.schema;
    const sessionSchema =
      contract.paths["/auth/otp/verify"]?.post?.responses["200"]?.content?.["application/json"]
        ?.schema;

    expect(requested.statusCode).toBe(202);
    expect(verified.statusCode).toBe(200);
    expect(ajv.validate(acceptedSchema ?? false, requested.json())).toBe(true);
    expect(ajv.validate(sessionSchema ?? false, verified.json())).toBe(true);
  });

  it("validates profile and session-device projections against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {
      userAgent: "Contract Browser",
    });
    const cookie = `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
    const [profile, devices] = await Promise.all([
      server.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/me/sessions",
        headers: { cookie },
      }),
    ]);
    const profileSchema =
      contract.paths["/me"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
    const devicesSchema =
      contract.paths["/me/sessions"]?.get?.responses["200"]?.content?.["application/json"]?.schema;

    expect(profile.statusCode).toBe(200);
    expect(devices.statusCode).toBe(200);
    expect(profile.headers.etag).toBe('"profile-v1"');
    expect(ajv.validate(profileSchema ?? false, profile.json())).toBe(true);
    expect(ajv.validate(devicesSchema ?? false, devices.json())).toBe(true);
  });

  it("validates organization creation, detail, and member projections against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    const cookie = `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
    const [created, organization, members] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { cookie, origin: environment.PUBLIC_WEB_URL },
        payload: {
          type: "SERVICE_PROVIDER",
          displayName: "Contract Service Team",
          legalName: null,
          slug: "contract-service-team",
        },
      }),
      server.inject({
        method: "GET",
        url: `/v1/organizations/${contractOrganizationId}`,
        headers: { cookie },
      }),
      server.inject({
        method: "GET",
        url: `/v1/organizations/${contractOrganizationId}/members`,
        headers: { cookie },
      }),
    ]);
    const createSchema =
      contract.paths["/organizations"]?.post?.responses["201"]?.content?.["application/json"]
        ?.schema;
    const organizationSchema =
      contract.paths["/organizations/{organizationId}"]?.get?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;
    const membersSchema =
      contract.paths["/organizations/{organizationId}/members"]?.get?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;

    expect(created.statusCode).toBe(201);
    expect(organization.statusCode).toBe(200);
    expect(members.statusCode).toBe(200);
    expect(ajv.validate(createSchema ?? false, created.json())).toBe(true);
    expect(ajv.validate(organizationSchema ?? false, organization.json())).toBe(true);
    expect(ajv.validate(membersSchema ?? false, members.json())).toBe(true);
  });

  it("validates the implemented private upload-intent projection against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    const response = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}`,
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "contract-media-upload-0001",
      },
      payload: {
        filename: "contract-photo.webp",
        mimeType: "image/webp",
        byteSize: 1_024,
        sha256: "a".repeat(64),
        purpose: "LISTING_MEDIA",
      },
    });
    const schema =
      contract.paths["/media/uploads"]?.post?.responses["201"]?.content?.["application/json"]
        ?.schema;

    expect(response.statusCode).toBe(201);
    expect(schema).toBeDefined();
    expect(ajv.validate(schema ?? false, response.json()), ajv.errorsText(ajv.errors)).toBe(true);
  });

  it("validates implemented region and category trees against the contract", async () => {
    const [regions, categories, rawContractResponse] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/regions?q=USA" }),
      server.inject({ method: "GET", url: "/v1/categories?vertical=SERVICE" }),
      server.inject({ method: "GET", url: "/docs/openapi.json" }),
    ]);
    const rawContract = rawContractResponse.json<DereferencedOpenApi>();
    const regionsSchema =
      rawContract.paths["/regions"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
    const categoriesSchema =
      rawContract.paths["/categories"]?.get?.responses["200"]?.content?.["application/json"]
        ?.schema;

    expect(regions.statusCode).toBe(200);
    expect(categories.statusCode).toBe(200);
    const validateRegions = ajv.compile({
      ...(regionsSchema ?? { not: {} }),
      components: rawContract.components,
    });
    const validateCategories = ajv.compile({
      ...(categoriesSchema ?? { not: {} }),
      components: rawContract.components,
    });
    expect(validateRegions(regions.json()), ajv.errorsText(validateRegions.errors)).toBe(true);
    expect(validateCategories(categories.json()), ajv.errorsText(validateCategories.errors)).toBe(
      true,
    );
  });
});
