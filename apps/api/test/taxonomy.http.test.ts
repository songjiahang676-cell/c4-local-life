import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { Category, Region } from "@socal/contracts";
import type { CategoryTaxonomyRecord, RegionTaxonomyRecord } from "@socal/database/taxonomy";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { MemoryTaxonomyStore } from "./support/memory-taxonomy.store";
import type { CategoryFormSchemaVersionRecord } from "../src/modules/taxonomy/taxonomy.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-taxonomy-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "taxonomy-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "taxonomy-otp-secret-with-more-than-32-bytes",
  CSRF_SECRET: "taxonomy-csrf-secret-with-more-than-32-bytes",
});

const countryId = "50000000-0000-4000-8000-000000000001";
const stateId = "50000000-0000-4000-8000-000000000002";
const groupId = "50000000-0000-4000-8000-000000000003";
const regionBase = {
  timezone: "America/Los_Angeles",
  latitude: null,
  longitude: null,
  isActive: true,
  sortOrder: 0,
  aliases: [],
} satisfies Partial<RegionTaxonomyRecord>;
const regions: RegionTaxonomyRecord[] = [
  {
    ...regionBase,
    id: countryId,
    parentId: null,
    code: "US",
    type: "COUNTRY",
    slug: "us",
    nameZhHans: "美国",
    nameEn: "United States",
  },
  {
    ...regionBase,
    id: stateId,
    parentId: countryId,
    code: "US-CA",
    type: "STATE",
    slug: "us-ca",
    nameZhHans: "加利福尼亚州",
    nameEn: "California",
  },
  {
    ...regionBase,
    id: groupId,
    parentId: stateId,
    code: "US-CA-SOCAL",
    type: "REGION_GROUP",
    slug: "us-ca-socal",
    nameZhHans: "南加州",
    nameEn: "Southern California",
    aliases: [{ locale: "en-US", value: "SoCal" }],
  },
  {
    ...regionBase,
    id: "50000000-0000-4000-8000-000000000004",
    parentId: groupId,
    code: "US-CA-LA",
    type: "CITY",
    slug: "us-ca-la",
    nameZhHans: "洛杉矶",
    nameEn: "Los Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    aliases: [{ locale: "und", value: "L.A." }],
  },
  {
    ...regionBase,
    id: "50000000-0000-4000-8000-000000000005",
    parentId: groupId,
    code: "US-CA-MONTEREY-PARK",
    type: "CITY",
    slug: "us-ca-monterey-park",
    nameZhHans: "蒙特利公园",
    nameEn: "Monterey Park",
    aliases: [{ locale: "und", value: "MPK" }],
  },
  {
    ...regionBase,
    id: "50000000-0000-4000-8000-000000000006",
    parentId: groupId,
    code: "US-CA-IRVINE",
    type: "CITY",
    slug: "us-ca-irvine",
    nameZhHans: "尔湾",
    nameEn: "Irvine",
    isActive: false,
  },
];

const jobsId = "60000000-0000-4000-8000-000000000001";
const servicesId = "60000000-0000-4000-8000-000000000002";
const categoryBase = {
  iconKey: null,
  formSchemaVersion: 1,
  isActive: true,
  sortOrder: 0,
  aliases: [],
} satisfies Partial<CategoryTaxonomyRecord>;
const categories: CategoryTaxonomyRecord[] = [
  {
    ...categoryBase,
    id: jobsId,
    parentId: null,
    vertical: "JOB",
    slug: "jobs",
    nameZhHans: "招聘招工",
    nameEn: "Jobs",
  },
  {
    ...categoryBase,
    id: "60000000-0000-4000-8000-000000000003",
    parentId: jobsId,
    vertical: "JOB",
    slug: "restaurant",
    nameZhHans: "餐饮服务",
    nameEn: "Restaurant & Food Service",
  },
  {
    ...categoryBase,
    id: servicesId,
    parentId: null,
    vertical: "SERVICE",
    slug: "services",
    nameZhHans: "本地服务/找师傅",
    nameEn: "Local Services",
    aliases: [{ locale: "zh-Hans", value: "生活服务" }],
  },
  {
    ...categoryBase,
    id: "60000000-0000-4000-8000-000000000004",
    parentId: servicesId,
    vertical: "SERVICE",
    slug: "plumbing-electric",
    nameZhHans: "水电维修",
    nameEn: "Plumbing & Electrical",
  },
  {
    ...categoryBase,
    id: "60000000-0000-4000-8000-000000000005",
    parentId: servicesId,
    vertical: "SERVICE",
    slug: "inactive-service",
    nameZhHans: "未启用服务",
    nameEn: "Inactive Service",
    isActive: false,
  },
];

const formSchemaDefinition = {
  categoryId: jobsId,
  version: 1,
  fields: [
    {
      key: "employmentType",
      type: "SELECT",
      label: { "zh-Hans": "雇佣类型", "en-US": "Employment type" },
      required: true,
      filterable: true,
      searchable: true,
      visibility: "PUBLIC",
      sortOrder: 10,
      options: [
        {
          value: "full-time",
          label: { "zh-Hans": "全职", "en-US": "Full time" },
        },
      ],
    },
  ],
} as const;
const formSchemaVersions: CategoryFormSchemaVersionRecord[] = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    categoryId: jobsId,
    version: 1,
    revision: 1,
    definition: formSchemaDefinition,
    contentHash: "a".repeat(64),
    basedOnVersion: null,
    createdById: null,
    updatedById: null,
    publishedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    categoryId: jobsId,
    version: 2,
    revision: 1,
    definition: { ...formSchemaDefinition, version: 2 },
    contentHash: "b".repeat(64),
    basedOnVersion: null,
    createdById: null,
    updatedById: null,
    publishedById: null,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    publishedAt: null,
  },
];

describe("taxonomy HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      logger: false,
      taxonomyStore: new MemoryTaxonomyStore(regions, categories, formSchemaVersions),
      observability: createObservabilityRuntime({
        serviceName: "socal-api-taxonomy-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves a public bilingual region tree with stable hierarchy and cache policy", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/regions" });
    const data = response.json<{ data: Region[] }>().data;

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      code: "US",
      name: { "zh-Hans": "美国", "en-US": "United States" },
      children: [
        {
          code: "US-CA",
          children: [{ code: "US-CA-SOCAL", type: "REGION_GROUP" }],
        },
      ],
    });
    expect(JSON.stringify(data)).not.toContain("normalized");
  });

  it("resolves region/category aliases and preserves direct-child and vertical filters", async () => {
    const [alias, children, serviceAlias, serviceTree] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/regions?q=MPK" }),
      server.inject({ method: "GET", url: "/v1/regions?parentCode=US-CA-SOCAL" }),
      server.inject({
        method: "GET",
        url: `/v1/categories?q=${encodeURIComponent("生活服务")}`,
      }),
      server.inject({ method: "GET", url: "/v1/categories?vertical=SERVICE" }),
    ]);

    expect(alias.json<{ data: Region[] }>().data.map((region) => region.code)).toEqual([
      "US-CA-MONTEREY-PARK",
    ]);
    expect(children.json<{ data: Region[] }>().data.map((region) => region.code)).toEqual([
      "US-CA-LA",
      "US-CA-MONTEREY-PARK",
    ]);
    expect(serviceAlias.json<{ data: Category[] }>().data.map((category) => category.slug)).toEqual(
      ["services"],
    );
    expect(serviceTree.json<{ data: Category[] }>().data).toMatchObject([
      {
        slug: "services",
        children: [{ slug: "plumbing-electric" }],
      },
    ]);
  });

  it("never exposes inactive rows through the public active-only contract", async () => {
    const active = await server.inject({ method: "GET", url: "/v1/regions?type=CITY" });
    const bypass = await server.inject({
      method: "GET",
      url: "/v1/regions?type=CITY&activeOnly=false",
    });

    expect(active.json<{ data: Region[] }>().data.map((region) => region.code)).not.toContain(
      "US-CA-IRVINE",
    );
    expect(bypass.statusCode).toBe(400);
  });

  it("serves only published form schema versions with strong cache identity", async () => {
    const [current, historical, draft, missing] = await Promise.all([
      server.inject({ method: "GET", url: `/v1/categories/${jobsId}/form-schema` }),
      server.inject({
        method: "GET",
        url: `/v1/categories/${jobsId}/form-schema?version=1`,
      }),
      server.inject({
        method: "GET",
        url: `/v1/categories/${jobsId}/form-schema?version=2`,
      }),
      server.inject({
        method: "GET",
        url: "/v1/categories/60000000-0000-4000-8000-000000000099/form-schema",
      }),
    ]);

    expect(current.statusCode).toBe(200);
    expect(current.headers.etag).toBe(`"${"a".repeat(64)}"`);
    expect(current.headers["cache-control"]).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
    expect(current.json()).toEqual(formSchemaDefinition);
    expect(historical.statusCode).toBe(200);
    expect(historical.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(draft.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(draft.body).not.toContain("bbbb");
  });

  it("rejects ambiguous, over-posted, malformed, and control-character queries", async () => {
    const responses = await Promise.all([
      server.inject({ method: "GET", url: "/v1/regions?activeOnly=1" }),
      server.inject({ method: "GET", url: "/v1/regions?parentCode=us-ca" }),
      server.inject({ method: "GET", url: "/v1/regions?offset=0" }),
      server.inject({
        method: "GET",
        url: `/v1/categories?q=${encodeURIComponent("unsafe\u202Equery")}`,
      }),
      server.inject({
        method: "GET",
        url: `/v1/categories/${jobsId}/form-schema?version=0`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
    for (const response of responses) {
      expect(response.json()).toMatchObject({
        title: "Bad Request",
        detail: "Request validation failed",
      });
      expect(response.body).not.toContain("stack");
    }
  });
});
