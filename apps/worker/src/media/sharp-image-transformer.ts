import sharp from "sharp";
import {
  PermanentMediaProcessingError,
  type ImageTransformation,
  type ImageTransformer,
  type TransformedMediaVariant,
} from "./media-processing";

const specifications = [
  { kind: "THUMBNAIL", width: 320, quality: 78 },
  { kind: "CARD", width: 960, quality: 82 },
  { kind: "FULL", width: 1920, quality: 84 },
] as const;

function differenceHash(pixels: Buffer): string {
  if (pixels.byteLength !== 72) {
    throw new PermanentMediaProcessingError("IMAGE_DECODE_FAILED");
  }
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      hash <<= 1n;
      const offset = row * 9 + column;
      if ((pixels[offset] ?? 0) > (pixels[offset + 1] ?? 0)) hash |= 1n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export class SharpImageTransformer implements ImageTransformer {
  constructor(private readonly maximumPixels: number) {}

  async transform(input: Buffer): Promise<ImageTransformation> {
    try {
      const metadata = await sharp(input, {
        failOn: "error",
        limitInputPixels: this.maximumPixels,
      }).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        (metadata.pages !== undefined && metadata.pages > 1)
      ) {
        throw new PermanentMediaProcessingError("IMAGE_DECODE_FAILED");
      }

      const perceptualPixels = await sharp(input, {
        failOn: "error",
        limitInputPixels: this.maximumPixels,
      })
        .rotate()
        .grayscale()
        .resize(9, 8, { fit: "fill" })
        .raw()
        .toBuffer();
      const variants: TransformedMediaVariant[] = [];
      for (const specification of specifications) {
        const output = await sharp(input, {
          failOn: "error",
          limitInputPixels: this.maximumPixels,
        })
          .rotate()
          .resize({
            width: specification.width,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({
            quality: specification.quality,
            effort: 4,
          })
          .toBuffer({ resolveWithObject: true });
        variants.push({
          kind: specification.kind,
          data: output.data,
          mimeType: "image/webp",
          width: output.info.width,
          height: output.info.height,
        });
      }
      const full = variants.find((variant) => variant.kind === "FULL");
      if (!full) throw new PermanentMediaProcessingError("VARIANT_SET_INVALID");
      return {
        width: full.width,
        height: full.height,
        perceptualHash: differenceHash(perceptualPixels),
        variants,
      };
    } catch (error: unknown) {
      if (error instanceof PermanentMediaProcessingError) throw error;
      throw new PermanentMediaProcessingError("IMAGE_DECODE_FAILED");
    }
  }
}
