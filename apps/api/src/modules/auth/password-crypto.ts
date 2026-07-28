import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptCost = 2 ** 17;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const scryptKeyLength = 64;
const scryptMaximumMemory = 256 * 1024 * 1024;
const encodedPasswordPattern =
  /^\$scrypt\$ln=17,r=8,p=1\$([A-Za-z0-9_-]{43})\$([A-Za-z0-9_-]{86})$/;

const blockedPasswords = new Set(
  [
    "123456789012345",
    "1234567890123456",
    "passwordpassword",
    "password123456",
    "qwertyuiopasdfgh",
    "letmeinletmein",
    "iloveyouiloveyou",
    "adminadminadmin",
    "administrator",
    "welcome123456789",
    "changemechangeme",
    "correcthorsebatterystaple",
    "socal life admin",
    "socal life platform",
    "socal-life-platform",
  ].map((value) => value.normalize("NFC").toLocaleLowerCase("en-US")),
);

export class WeakPasswordError extends Error {
  constructor(readonly reason: "length" | "encoding" | "blocked") {
    super("Choose a longer password that is not commonly used or compromised");
    this.name = "WeakPasswordError";
  }
}

function passwordMaterial(password: string, pepper: string): Buffer {
  return createHmac("sha256", pepper)
    .update("socal-password-pepper-v1\0", "utf8")
    .update(password, "utf8")
    .digest();
}

function derive(password: string, pepper: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passwordMaterial(password, pepper),
      salt,
      scryptKeyLength,
      {
        N: scryptCost,
        r: scryptBlockSize,
        p: scryptParallelization,
        maxmem: scryptMaximumMemory,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export function normalizeAndValidatePassword(password: string): string {
  const normalized = password.normalize("NFC");
  const codePointLength = [...normalized].length;
  if (codePointLength < 15 || codePointLength > 128) {
    throw new WeakPasswordError("length");
  }
  if (
    Buffer.byteLength(normalized, "utf8") > 512 ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new WeakPasswordError("encoding");
  }
  if (blockedPasswords.has(normalized.toLocaleLowerCase("en-US"))) {
    throw new WeakPasswordError("blocked");
  }
  return normalized;
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const normalized = normalizeAndValidatePassword(password);
  const salt = randomBytes(32);
  const derived = await derive(normalized, pepper, salt);
  return `$scrypt$ln=17,r=8,p=1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
  pepper: string,
): Promise<boolean> {
  const match = encodedPasswordPattern.exec(encoded);
  if (!match) return false;
  const salt = Buffer.from(match[1] ?? "", "base64url");
  const expected = Buffer.from(match[2] ?? "", "base64url");
  if (salt.length !== 32 || expected.length !== scryptKeyLength) return false;
  const normalized = password.normalize("NFC");
  if (Buffer.byteLength(normalized, "utf8") > 512) return false;
  const actual = await derive(normalized, pepper, salt);
  return timingSafeEqual(actual, expected);
}
