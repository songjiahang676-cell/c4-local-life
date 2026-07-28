import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClamAvScanner } from "../src/media/clamav-scanner";

describe("ClamAvScanner", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
  });

  it.each([
    { response: "stream: OK\0", expected: "clean" },
    { response: "stream: Eicar-Test-Signature FOUND\0", expected: "infected" },
  ] as const)("uses bounded clamd INSTREAM and classifies $expected", async (scenario) => {
    const source = Buffer.from("bounded synthetic scan payload");
    let received = Buffer.alloc(0);
    server = createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        const expectedLength = Buffer.byteLength("zINSTREAM\0") + 4 + source.byteLength + 4;
        if (received.byteLength >= expectedLength) socket.write(scenario.response);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test scanner port unavailable");

    await expect(
      new ClamAvScanner({
        host: "127.0.0.1",
        port: address.port,
        timeoutMilliseconds: 2_000,
      }).scan(source),
    ).resolves.toBe(scenario.expected);

    expect(received.subarray(0, 10).toString("utf8")).toBe("zINSTREAM\0");
    expect(received.readUInt32BE(10)).toBe(source.byteLength);
    expect(received.subarray(14, 14 + source.byteLength)).toEqual(source);
  });
});
