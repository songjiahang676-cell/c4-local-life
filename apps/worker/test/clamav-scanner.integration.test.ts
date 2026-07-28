import { describe, expect, it } from "vitest";
import { ClamAvScanner } from "../src/media/clamav-scanner";

const host = process.env.CLAMAV_INTEGRATION_HOST ?? "";
const port = Number(process.env.CLAMAV_INTEGRATION_PORT ?? "3310");
const integration = describe.skipIf(host.length === 0);

integration("ClamAvScanner with clamd", () => {
  const scanner = new ClamAvScanner({
    host,
    port,
    timeoutMilliseconds: 15_000,
  });

  it("accepts a clean stream and detects the standard anti-malware test signature", async () => {
    await expect(scanner.scan(Buffer.from("socal-life-clean-integration-sample"))).resolves.toBe(
      "clean",
    );

    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      "ascii",
    );
    await expect(scanner.scan(eicar)).resolves.toBe("infected");
  });
});
