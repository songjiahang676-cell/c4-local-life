import { createHash } from "node:crypto";
import {
  MediaStatus,
  type FinalizeMediaProcessingInput,
  type MediaProcessingRecord,
  type RejectMediaProcessingInput,
} from "@socal/database/media";
import { describe, expect, it } from "vitest";
import {
  MediaProcessingHandler,
  type ImageTransformer,
  type MalwareScanner,
  type MediaProcessingStorage,
  type MediaProcessingStore,
} from "../src/media/media-processing";

const mediaId = "70000000-0000-4000-8000-000000000021";
const source = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function event(lifecycleVersion = 1): unknown {
  return {
    version: 1,
    eventId: "70000000-0000-4000-8000-000000000022",
    aggregateType: "MEDIA_ASSET",
    aggregateId: mediaId,
    eventType: "media.upload.completed",
    occurredAt: "2026-07-29T00:30:00.000Z",
    payload: { mediaId, lifecycleVersion },
  };
}

class MemoryProcessingStore implements MediaProcessingStore {
  record: MediaProcessingRecord | null = {
    id: mediaId,
    status: MediaStatus.SCANNING,
    lifecycleVersion: 1,
    bucket: "private-quarantine",
    objectKey: `quarantine/70/${mediaId}/original`,
    mimeType: "image/jpeg",
    byteSize: source.byteLength,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
  readonly finalized: FinalizeMediaProcessingInput[] = [];
  readonly rejected: RejectMediaProcessingInput[] = [];

  getForProcessing(): Promise<MediaProcessingRecord | null> {
    return Promise.resolve(this.record);
  }

  finalizeProcessing(input: FinalizeMediaProcessingInput): Promise<"updated"> {
    this.finalized.push(input);
    if (this.record) this.record.status = MediaStatus.READY;
    return Promise.resolve("updated");
  }

  rejectProcessing(input: RejectMediaProcessingInput): Promise<"updated"> {
    this.rejected.push(input);
    if (this.record) this.record.status = MediaStatus.REJECTED;
    return Promise.resolve("updated");
  }
}

class MemoryProcessingStorage implements MediaProcessingStorage {
  readonly writes: { objectKey: string; sha256: string }[] = [];
  readResult = source;

  readSource(): Promise<Buffer> {
    return Promise.resolve(this.readResult);
  }

  putVariant(input: { objectKey: string; sha256: string }): Promise<void> {
    this.writes.push(input);
    return Promise.resolve();
  }
}

function transformer(): ImageTransformer {
  return {
    transform: () =>
      Promise.resolve({
        width: 6,
        height: 4,
        perceptualHash: "0123456789abcdef",
        variants: [
          {
            kind: "THUMBNAIL",
            data: Buffer.from("thumbnail"),
            mimeType: "image/webp",
            width: 6,
            height: 4,
          },
          {
            kind: "CARD",
            data: Buffer.from("card"),
            mimeType: "image/webp",
            width: 6,
            height: 4,
          },
          {
            kind: "FULL",
            data: Buffer.from("full"),
            mimeType: "image/webp",
            width: 6,
            height: 4,
          },
        ],
      }),
  };
}

function scanner(result: "clean" | "infected" = "clean"): MalwareScanner {
  return { scan: () => Promise.resolve(result) };
}

function handler(input?: {
  store?: MemoryProcessingStore;
  storage?: MemoryProcessingStorage;
  malwareScanner?: MalwareScanner;
  imageTransformer?: ImageTransformer;
}): {
  service: MediaProcessingHandler;
  store: MemoryProcessingStore;
  storage: MemoryProcessingStorage;
} {
  const store = input?.store ?? new MemoryProcessingStore();
  const storage = input?.storage ?? new MemoryProcessingStorage();
  return {
    store,
    storage,
    service: new MediaProcessingHandler(
      store,
      storage,
      input?.malwareScanner ?? scanner(),
      input?.imageTransformer ?? transformer(),
      {
        maximumBytes: 20_971_520,
        processedBucket: "safe-processed",
        onOutcome: () => undefined,
      },
    ),
  };
}

describe("MediaProcessingHandler", () => {
  it("validates, scans, writes exactly three deterministic safe variants and finalizes once", async () => {
    const fixture = handler();

    await fixture.service.handle(event());
    await fixture.service.handle(event());

    expect(fixture.storage.writes.map((write) => write.objectKey)).toEqual([
      `processed/70/${mediaId}/thumbnail.webp`,
      `processed/70/${mediaId}/card.webp`,
      `processed/70/${mediaId}/full.webp`,
    ]);
    expect(fixture.store.finalized).toHaveLength(1);
    expect(fixture.store.finalized[0]).toMatchObject({
      id: mediaId,
      lifecycleVersion: 1,
      detectedMimeType: "image/jpeg",
      width: 6,
      height: 4,
      perceptualHash: "0123456789abcdef",
    });
    expect(fixture.store.finalized[0]?.variants).toHaveLength(3);
    expect(fixture.store.rejected).toHaveLength(0);
  });

  it.each([
    {
      name: "content hash mismatch",
      configure: (fixture: ReturnType<typeof handler>) => {
        fixture.storage.readResult = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
      },
      scannerResult: "clean" as const,
      code: "SOURCE_INTEGRITY_MISMATCH",
    },
    {
      name: "malware",
      configure: () => undefined,
      scannerResult: "infected" as const,
      code: "MALWARE_DETECTED",
    },
  ])("durably rejects $name without publishing variants", async (scenario) => {
    const fixture = handler({ malwareScanner: scanner(scenario.scannerResult) });
    scenario.configure(fixture);

    await fixture.service.handle(event());

    expect(fixture.store.rejected).toHaveLength(1);
    expect(fixture.store.rejected[0]?.rejectionCode).toBe(scenario.code);
    expect(fixture.store.finalized).toHaveLength(0);
    expect(fixture.storage.writes).toHaveLength(0);
  });

  it("leaves SCANNING retryable for transient scanner failures", async () => {
    const fixture = handler({
      malwareScanner: {
        scan: () => Promise.reject(new Error("scanner provider detail")),
      },
    });

    await expect(fixture.service.handle(event())).rejects.toThrow("scanner provider detail");
    expect(fixture.store.rejected).toHaveLength(0);
    expect(fixture.store.finalized).toHaveLength(0);
  });

  it("rejects malformed queue envelopes before touching storage", async () => {
    const fixture = handler();

    await expect(
      fixture.service.handle({ version: 1, eventType: "media.upload.completed", payload: {} }),
    ).rejects.toEqual(expect.objectContaining({ code: "EVENT_INVALID" }));
    expect(fixture.storage.writes).toHaveLength(0);
  });
});
