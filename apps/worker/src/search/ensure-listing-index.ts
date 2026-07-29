import { parseWorkerEnvironment } from "@socal/config";
import { ListingIndexManager } from "./listing-index-manager";
import { createOpenSearchClient } from "./opensearch-client";

async function main(): Promise<void> {
  const environment = parseWorkerEnvironment(process.env);
  const client = createOpenSearchClient({
    node: environment.OPENSEARCH_NODE,
    username: environment.OPENSEARCH_USERNAME || undefined,
    password: environment.OPENSEARCH_PASSWORD,
  });
  try {
    const result = await new ListingIndexManager(
      client,
      environment.OPENSEARCH_INDEX_PREFIX,
    ).ensure();
    console.log(
      JSON.stringify({
        event: "search.listing_index.ready",
        outcome: result.outcome,
        physicalIndex: result.names.physical,
        readAlias: result.names.readAlias,
        writeAlias: result.names.writeAlias,
        schemaVersion: result.schemaVersion,
      }),
    );
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "search.listing_index.failed",
      errorCode:
        error instanceof Error && "code" in error
          ? String((error as Error & { code: unknown }).code)
          : "OPENSEARCH_REQUEST_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
