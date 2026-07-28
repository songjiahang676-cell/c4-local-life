import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const totpPeriodSeconds = 30;

function derivedKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(`socal-admin-mfa-${purpose}-v1\0`, "utf8").digest();
}

export function encodeBase32(value: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let encoded = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += base32Alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) encoded += base32Alphabet[(accumulator << (5 - bits)) & 31];
  return encoded;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replaceAll("=", "").replaceAll(/\s+/g, "");
  let bits = 0;
  let accumulator = 0;
  const decoded: number[] = [];
  for (const character of normalized) {
    const digit = base32Alphabet.indexOf(character);
    if (digit < 0) throw new TypeError("Invalid base32 value");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((accumulator >>> bits) & 255);
    }
  }
  return Buffer.from(decoded);
}

export function hotpCode(
  secret: Uint8Array,
  counter: bigint,
  digits = 6,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac(algorithm, secret).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  const binary =
    ((digest[offset] ?? 0) & 127) * 0x1000000 +
    (digest[offset + 1] ?? 0) * 0x10000 +
    (digest[offset + 2] ?? 0) * 0x100 +
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(at: Date, periodSeconds = totpPeriodSeconds): bigint {
  return BigInt(Math.floor(at.getTime() / 1_000 / periodSeconds));
}

export function totpCode(
  secret: Uint8Array,
  at: Date,
  digits = 6,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
): string {
  return hotpCode(secret, totpStep(at), digits, algorithm);
}

export function matchTotpStep(
  base32Secret: string,
  candidate: string,
  at: Date,
  allowedDriftSteps = 1,
): bigint | null {
  if (!/^\d{6}$/.test(candidate)) return null;
  const secret = decodeBase32(base32Secret);
  const candidateBytes = Buffer.from(candidate, "ascii");
  const currentStep = totpStep(at);
  for (let drift = allowedDriftSteps; drift >= -allowedDriftSteps; drift -= 1) {
    const step = currentStep + BigInt(drift);
    if (step < 0n) continue;
    const expected = Buffer.from(hotpCode(secret, step), "ascii");
    if (timingSafeEqual(expected, candidateBytes)) return step;
  }
  return null;
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function encryptTotpSecret(base32Secret: string, masterSecret: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derivedKey(masterSecret, "encryption"),
    initializationVector,
  );
  const ciphertext = Buffer.concat([cipher.update(base32Secret, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return [
    "v1",
    initializationVector.toString("base64url"),
    ciphertext.toString("base64url"),
    authenticationTag.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(encrypted: string, masterSecret: string): string {
  const [version, initializationVector, ciphertext, authenticationTag, extra] =
    encrypted.split(".");
  if (version !== "v1" || !initializationVector || !ciphertext || !authenticationTag || extra) {
    throw new TypeError("Unsupported encrypted MFA secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey(masterSecret, "encryption"),
    Buffer.from(initializationVector, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authenticationTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    encodeBase32(randomBytes(10))
      .match(/.{1,4}/g)
      ?.join("-"),
  ).filter((code): code is string => Boolean(code));
}

export function normalizeRecoveryCode(value: string): string | null {
  const normalized = value.toUpperCase().replaceAll("-", "").replaceAll(/\s+/g, "");
  return /^[A-Z2-7]{16}$/.test(normalized) ? normalized : null;
}

export function hashRecoveryCode(value: string, masterSecret: string): string {
  const normalized = normalizeRecoveryCode(value);
  if (!normalized) throw new TypeError("Invalid recovery code");
  return createHmac("sha256", derivedKey(masterSecret, "recovery-code"))
    .update(normalized, "ascii")
    .digest("hex");
}

export function buildOtpAuthUri(userId: string, base32Secret: string): string {
  const issuer = "SoCal Life Admin";
  const label = `${issuer}:${userId}`;
  const parameters = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(totpPeriodSeconds),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`;
}
