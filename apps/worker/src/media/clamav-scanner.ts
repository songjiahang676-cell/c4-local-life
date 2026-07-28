import { createConnection, type Socket } from "node:net";
import type { MalwareScanner, MalwareScanResult } from "./media-processing";

const maximumResponseBytes = 4_096;
const streamChunkBytes = 64 * 1_024;

function write(socket: Socket, value: Buffer): Promise<void> {
  if (socket.write(value)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("drain", resolve);
    socket.once("error", reject);
  });
}

export class ClamAvScanner implements MalwareScanner {
  constructor(
    private readonly configuration: {
      host: string;
      port: number;
      timeoutMilliseconds: number;
    },
  ) {}

  scan(input: Buffer): Promise<MalwareScanResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.configuration.host,
        port: this.configuration.port,
      });
      const response: Buffer[] = [];
      let responseBytes = 0;
      let settled = false;

      const finish = (error: Error | null, result?: MalwareScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result ?? "clean");
      };
      socket.setTimeout(this.configuration.timeoutMilliseconds);
      socket.once("timeout", () => finish(new Error("ClamAV scan timed out")));
      socket.once("error", (error) => finish(error));
      socket.on("data", (chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > maximumResponseBytes) {
          finish(new Error("ClamAV response exceeded its limit"));
          return;
        }
        response.push(chunk);
        const combined = Buffer.concat(response).toString("utf8");
        if (!combined.includes("\0")) return;
        if (combined.includes(" FOUND")) {
          finish(null, "infected");
        } else if (combined.includes(" OK")) {
          finish(null, "clean");
        } else {
          finish(new Error("ClamAV returned an unrecognized response"));
        }
      });
      socket.once("connect", () => {
        void (async () => {
          await write(socket, Buffer.from("zINSTREAM\0", "utf8"));
          for (let offset = 0; offset < input.byteLength; offset += streamChunkBytes) {
            const chunk = input.subarray(
              offset,
              Math.min(input.byteLength, offset + streamChunkBytes),
            );
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(chunk.byteLength);
            await write(socket, length);
            await write(socket, chunk);
          }
          await write(socket, Buffer.alloc(4));
        })().catch((error: unknown) =>
          finish(error instanceof Error ? error : new Error("ClamAV stream failed")),
        );
      });
    });
  }
}
