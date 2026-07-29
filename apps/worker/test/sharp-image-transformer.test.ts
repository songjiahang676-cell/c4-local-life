import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpImageTransformer } from "../src/media/sharp-image-transformer";

describe("SharpImageTransformer", () => {
  it("really decodes and re-encodes bounded WebP variants without carrying EXIF", async () => {
    const source = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const transformed = await new SharpImageTransformer(40_000_000).transform(source);

    expect(transformed.variants.map((variant) => variant.kind)).toEqual([
      "THUMBNAIL",
      "CARD",
      "FULL",
    ]);
    for (const variant of transformed.variants) {
      const metadata = await sharp(variant.data).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(variant.width).toBeLessThanOrEqual(
        variant.kind === "THUMBNAIL" ? 320 : variant.kind === "CARD" ? 960 : 1920,
      );
    }
    expect(transformed.width).toBe(480);
    expect(transformed.height).toBe(640);
    expect(transformed.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects undecodable input instead of copying it through", async () => {
    await expect(
      new SharpImageTransformer(40_000_000).transform(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])),
    ).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });
});
