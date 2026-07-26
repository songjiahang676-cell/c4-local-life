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
  CSRF_SECRET: "contract-csrf-secret-with-more-than-32-bytes",
});

describe("canonical OpenAPI contract", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let contract: DereferencedOpenApi;
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));

  beforeAll(async () => {
    contract = (await SwaggerParser.validate(
      canonicalOpenApiPath(),
    )) as unknown as DereferencedOpenApi;
    app = await createApiApplication(environment, {
      logger: false,
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
    expect(Object.keys(contract.paths)).toHaveLength(31);
    expect(Object.keys(contract.components.schemas)).toHaveLength(52);
    expect(operationIds).toHaveLength(38);
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
    expect(Object.keys(servedJson.paths)).toHaveLength(31);
    expect(Object.keys(servedYaml.paths)).toHaveLength(31);
    expect(servedJson.info.version).toBe(contract.info.version);
  });

  it("validates implemented health and Problem Details responses against the contract", async () => {
    const healthResponse = await server.inject({ method: "GET", url: "/v1/health/live" });
    const invalidResponse = await server.inject({
      method: "POST",
      url: "/v1/listings",
      payload: { type: "RENTAL", title: "x" },
    });
    const healthSchema =
      contract.paths["/health/live"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
    const problemSchema =
      contract.paths["/listings"]?.post?.responses["400"]?.content?.["application/problem+json"]
        ?.schema;

    expect(healthSchema).toBeDefined();
    expect(problemSchema).toBeDefined();
    expect(healthResponse.statusCode).toBe(200);
    expect(invalidResponse.statusCode).toBe(400);
    expect(ajv.validate(healthSchema ?? false, healthResponse.json())).toBe(true);
    expect(ajv.validate(problemSchema ?? false, invalidResponse.json())).toBe(true);
  });
});
