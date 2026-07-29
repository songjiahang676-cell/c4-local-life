import { Client, type ClientOptions } from "@opensearch-project/opensearch";
import type { SecretValue } from "@socal/config";

export type OpenSearchConnectionOptions = Readonly<{
  node: string;
  username?: string;
  password?: SecretValue;
}>;

export function createOpenSearchClient(options: OpenSearchConnectionOptions): Client {
  const clientOptions: ClientOptions = {
    node: options.node,
    requestTimeout: 5_000,
    maxRetries: 2,
  };
  if (options.username && options.password) {
    clientOptions.auth = {
      username: options.username,
      password: options.password.reveal(),
    };
  }
  return new Client(clientOptions);
}
