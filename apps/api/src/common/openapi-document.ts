import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OpenAPIObject } from "@nestjs/swagger";
import { parseDocument } from "yaml";

export type CanonicalOpenApiDocument = {
  document: OpenAPIObject;
  source: string;
  path: string;
};

export function canonicalOpenApiPath(): string {
  return resolve(__dirname, "../../../../openapi/openapi.yaml");
}

export async function loadCanonicalOpenApiDocument(
  path = canonicalOpenApiPath(),
): Promise<CanonicalOpenApiDocument> {
  const source = await readFile(path, "utf8");
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length > 0) {
    throw new Error("Canonical OpenAPI document is invalid YAML");
  }
  const value: unknown = parsed.toJS();
  if (
    !value ||
    typeof value !== "object" ||
    !("openapi" in value) ||
    !String(value.openapi).startsWith("3.1.") ||
    !("paths" in value)
  ) {
    throw new Error("Canonical OpenAPI document must be OpenAPI 3.1 with paths");
  }

  return {
    document: value as OpenAPIObject,
    source,
    path,
  };
}
