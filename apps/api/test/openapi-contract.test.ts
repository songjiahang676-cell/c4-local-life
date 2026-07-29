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
import { hashPassword } from "../src/modules/auth/password-crypto";
import { decodeBase32, totpCode } from "../src/modules/admin/mfa-crypto";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import {
  CapturingOtpDeliveryGateway,
  MemoryOtpChallengeStore,
} from "./support/memory-otp-challenge.store";
import { MemoryOrganizationStore } from "./support/memory-organization.store";
import { CapturingMediaObjectStorage, MemoryMediaStore } from "./support/memory-media.store";
import { MemoryTaxonomyStore } from "./support/memory-taxonomy.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";
import {
  MemoryListingStore,
  memoryListingCategoryId,
  memoryListingRegionCode,
  memoryListingRegionId,
} from "./support/memory-listing.store";
import {
  CapturingPasswordNotificationGateway,
  MemoryPasswordStore,
} from "./support/memory-password.store";

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
  MFA_SECRET: "contract-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "contract-password-pepper-with-more-than-32-bytes",
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
  let passwordStore: MemoryPasswordStore;
  let passwordNotifications: CapturingPasswordNotificationGateway;
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));

  beforeAll(async () => {
    const authSessionStore = new MemoryAuthSessionStore();
    authSessionStore.registerSubject(buildActiveSubject({ id: contractUserId }));
    authSessionStore.registerPlatformRole(contractUserId, "READ_ONLY_AUDITOR");
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
        {
          id: memoryListingRegionId,
          parentId: null,
          code: memoryListingRegionCode,
          type: "CITY",
          slug: "synthetic-irvine",
          nameZhHans: "测试尔湾",
          nameEn: "Synthetic Irvine",
          timezone: "America/Los_Angeles",
          latitude: 33.6846,
          longitude: -117.8265,
          isActive: true,
          sortOrder: 1,
          aliases: [],
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
        {
          id: memoryListingCategoryId,
          parentId: null,
          vertical: "RENTAL",
          slug: "synthetic-rentals",
          nameZhHans: "测试租房",
          nameEn: "Synthetic Rentals",
          iconKey: "rental",
          formSchemaVersion: 1,
          isActive: true,
          sortOrder: 1,
          aliases: [],
        },
      ],
      [
        {
          id: "70000000-0000-4000-8000-000000000001",
          categoryId: memoryListingCategoryId,
          version: 1,
          revision: 1,
          definition: {
            categoryId: memoryListingCategoryId,
            version: 1,
            fields: [],
          },
          contentHash: "0".repeat(64),
          basedOnVersion: null,
          createdById: null,
          updatedById: null,
          publishedById: null,
          createdAt: organizationTimestamp,
          updatedAt: organizationTimestamp,
          publishedAt: organizationTimestamp,
        },
      ],
    );
    contract = (await SwaggerParser.validate(
      canonicalOpenApiPath(),
    )) as unknown as DereferencedOpenApi;
    const otpChallengeStore = new MemoryOtpChallengeStore();
    otpChallengeStore.userId = contractUserId;
    otpDelivery = new CapturingOtpDeliveryGateway();
    passwordStore = new MemoryPasswordStore();
    passwordNotifications = new CapturingPasswordNotificationGateway();
    passwordStore.registerAccount({
      userId: contractUserId,
      identifier: "contract-password@example.invalid",
      passwordHash: await hashPassword(
        "Contract password authentication 2026!",
        environment.PASSWORD_PEPPER.reveal(),
      ),
      locale: "en-US",
    });
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore,
      otpChallengeStore,
      otpDeliveryGateway: otpDelivery,
      organizationStore,
      listingStore: new MemoryListingStore(),
      mediaStore: new MemoryMediaStore(),
      mediaObjectStorage: new CapturingMediaObjectStorage(),
      taxonomyStore,
      mfaStore: new MemoryMfaStore(),
      passwordStore,
      passwordNotificationGateway: passwordNotifications,
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
    expect(Object.keys(contract.paths)).toHaveLength(45);
    expect(Object.keys(contract.components.schemas)).toHaveLength(99);
    expect(operationIds).toHaveLength(54);
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
    expect(Object.keys(servedJson.paths)).toHaveLength(45);
    expect(Object.keys(servedYaml.paths)).toHaveLength(45);
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

  it("validates implemented listing draft create, owner-read, and update responses", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    const cookie = `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        cookie,
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "contract-listing-create-0001",
      },
      payload: {
        type: "RENTAL",
        locale: "en-US",
        categoryId: memoryListingCategoryId,
        regionCode: memoryListingRegionCode,
        title: "Synthetic contract rental",
        body: "A fictional Listing used to validate the canonical contract response.",
        price: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
        attributes: {},
        mediaIds: [],
        contactMode: "IN_APP",
      },
    });
    const listingId = created.json<{ data: { id: string } }>().data.id;
    const read = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
      headers: { cookie },
    });
    const updated = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: {
        cookie,
        origin: environment.PUBLIC_WEB_URL,
        "if-match": '"listing-v1"',
      },
      payload: { title: "Updated synthetic contract rental" },
    });
    const createSchema =
      contract.paths["/listings"]?.post?.responses["201"]?.content?.["application/json"]?.schema;
    const readSchema =
      contract.paths["/listings/{listingId}"]?.get?.responses["200"]?.content?.["application/json"]
        ?.schema;
    const updateSchema =
      contract.paths["/listings/{listingId}"]?.patch?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;

    expect(created.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(updated.statusCode).toBe(200);
    expect(ajv.validate(createSchema ?? false, created.json()), ajv.errorsText(ajv.errors)).toBe(
      true,
    );
    expect(ajv.validate(readSchema ?? false, read.json()), ajv.errorsText(ajv.errors)).toBe(true);
    expect(ajv.validate(updateSchema ?? false, updated.json()), ajv.errorsText(ajv.errors)).toBe(
      true,
    );
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

  it("validates password login and cooldown recovery responses against the contract", async () => {
    const login = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "contract-password-device-01" },
      payload: {
        identifier: "contract-password@example.invalid",
        password: "Contract password authentication 2026!",
      },
    });
    const recovery = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery",
      headers: { "x-device-id": "contract-password-device-02" },
      payload: {
        channel: "EMAIL",
        destination: "contract-password@example.invalid",
      },
    });
    const recoveryBody = recovery.json<{ recoveryRequestId: string }>();
    const message = passwordNotifications.messages.at(-1);
    if (!message || message.kind !== "RECOVERY_REQUESTED") {
      throw new Error("Expected a password recovery notification");
    }
    passwordStore.makeRecoveryReady(recoveryBody.recoveryRequestId);
    const completed = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery/confirm",
      headers: { "x-device-id": "contract-password-device-02" },
      payload: {
        recoveryRequestId: recoveryBody.recoveryRequestId,
        token: message.token,
        newPassword: "Contract replacement password 2026!",
      },
    });

    const loginSchema =
      contract.paths["/auth/password/login"]?.post?.responses["200"]?.content?.["application/json"]
        ?.schema;
    const recoverySchema =
      contract.paths["/auth/password/recovery"]?.post?.responses["202"]?.content?.[
        "application/json"
      ]?.schema;
    const completedSchema =
      contract.paths["/auth/password/recovery/confirm"]?.post?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;

    expect(login.statusCode).toBe(200);
    expect(recovery.statusCode).toBe(202);
    expect(completed.statusCode).toBe(200);
    expect(ajv.validate(loginSchema ?? false, login.json()), ajv.errorsText(ajv.errors)).toBe(true);
    expect(ajv.validate(recoverySchema ?? false, recovery.json()), ajv.errorsText(ajv.errors)).toBe(
      true,
    );
    expect(
      ajv.validate(completedSchema ?? false, completed.json()),
      ajv.errorsText(ajv.errors),
    ).toBe(true);
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
    const mediaId = response.json<{ data: { mediaId: string } }>().data.mediaId;
    const status = await server.inject({
      method: "GET",
      url: `/v1/media/${mediaId}`,
      headers: { cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}` },
    });
    const statusSchema =
      contract.paths["/media/{mediaId}"]?.get?.responses["200"]?.content?.["application/json"]
        ?.schema;
    expect(status.statusCode).toBe(200);
    expect(ajv.validate(statusSchema ?? false, status.json()), ajv.errorsText(ajv.errors)).toBe(
      true,
    );
    const completion = contract.paths["/media/{mediaId}/complete"]?.post;
    expect(completion?.responses["202"]?.content?.["application/json"]?.schema).toBeDefined();
    expect(Object.keys(completion?.responses ?? {})).toEqual([
      "202",
      "400",
      "401",
      "403",
      "404",
      "409",
      "422",
      "503",
    ]);
  });

  it("validates the operator-only Admin session projection against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/session",
      headers: { cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}` },
    });
    const schema =
      contract.paths["/admin/session"]?.get?.responses["200"]?.content?.["application/json"]
        ?.schema;

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(ajv.validate(schema ?? false, response.json()), ajv.errorsText(ajv.errors)).toBe(true);
  });

  it("validates Admin MFA enrollment, activation, and recovery verification against the contract", async () => {
    const issued = await sessions.issueSession(contractUserId, {});
    let cookie = `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
    const started = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/enrollment",
      headers: { cookie, origin: environment.PUBLIC_ADMIN_URL },
    });
    const enrollmentSchema =
      contract.paths["/admin/mfa/enrollment"]?.post?.responses["201"]?.content?.["application/json"]
        ?.schema;
    expect(started.statusCode).toBe(201);
    expect(
      ajv.validate(enrollmentSchema ?? false, started.json()),
      ajv.errorsText(ajv.errors),
    ).toBe(true);

    const enrollment = started.json<{ data: { credentialId: string; secret: string } }>().data;
    const activated = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/enrollment/verify",
      headers: {
        cookie,
        origin: environment.PUBLIC_ADMIN_URL,
        "content-type": "application/json",
      },
      payload: {
        credentialId: enrollment.credentialId,
        code: totpCode(decodeBase32(enrollment.secret), new Date()),
      },
    });
    const activationSchema =
      contract.paths["/admin/mfa/enrollment/verify"]?.post?.responses["200"]?.content?.[
        "application/json"
      ]?.schema;
    expect(activated.statusCode).toBe(200);
    expect(
      ajv.validate(activationSchema ?? false, activated.json()),
      ajv.errorsText(ajv.errors),
    ).toBe(true);
    const setCookie = activated.headers["set-cookie"];
    cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";

    const recoveryCode = activated.json<{ data: { recoveryCodes: string[] } }>().data
      .recoveryCodes[0];
    const verified = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: {
        cookie,
        origin: environment.PUBLIC_ADMIN_URL,
        "content-type": "application/json",
      },
      payload: { code: recoveryCode },
    });
    const verificationSchema =
      contract.paths["/admin/mfa/verify"]?.post?.responses["200"]?.content?.["application/json"]
        ?.schema;
    expect(verified.statusCode).toBe(200);
    expect(
      ajv.validate(verificationSchema ?? false, verified.json()),
      ajv.errorsText(ajv.errors),
    ).toBe(true);
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
