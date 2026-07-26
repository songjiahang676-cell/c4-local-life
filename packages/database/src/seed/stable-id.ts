import { createHash } from "node:crypto";

const namespace = Buffer.from("53d5673a5f2b4bc78765fddad6f7ea0c", "hex");

export function stableSeedUuid(key: string): string {
  const digest = createHash("sha1").update(namespace).update(key, "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
