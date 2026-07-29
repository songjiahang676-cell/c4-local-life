import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ListingSearchInput } from "@socal/contracts";
import type { SearchCriteria, SearchSortValue } from "./search.store";

const cursorVersion = 1;
const fingerprintPattern = /^[0-9a-f]{64}$/;
const maximumSnapshotIdLength = 1_024;
const maximumSearchAfterValues = 8;

type SearchCursorPayload = Readonly<{
  v: typeof cursorVersion;
  fingerprint: string;
  snapshotId: string;
  snapshotAt: string;
  searchAfter: readonly SearchSortValue[];
  expiresAt: number;
}>;

export class SearchCursorInvalidError extends Error {
  readonly code = "SEARCH_CURSOR_INVALID";

  constructor(message = "The search cursor is invalid") {
    super(message);
    this.name = "SearchCursorInvalidError";
  }
}

export class SearchCursorExpiredError extends Error {
  readonly code = "SEARCH_CURSOR_EXPIRED";

  constructor() {
    super("The search cursor has expired");
    this.name = "SearchCursorExpiredError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSearchSortValue(value: unknown): value is SearchSortValue {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function parsePayload(value: unknown): SearchCursorPayload {
  if (!isRecord(value) || Object.keys(value).length !== 6) {
    throw new SearchCursorInvalidError();
  }
  const { v, fingerprint, snapshotId, snapshotAt, searchAfter, expiresAt } = value;
  if (
    v !== cursorVersion ||
    typeof fingerprint !== "string" ||
    !fingerprintPattern.test(fingerprint) ||
    typeof snapshotId !== "string" ||
    snapshotId.length < 1 ||
    snapshotId.length > maximumSnapshotIdLength ||
    typeof snapshotAt !== "string" ||
    !Number.isFinite(Date.parse(snapshotAt)) ||
    !Array.isArray(searchAfter) ||
    searchAfter.length < 1 ||
    searchAfter.length > maximumSearchAfterValues ||
    !searchAfter.every(isSearchSortValue) ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0
  ) {
    throw new SearchCursorInvalidError();
  }
  return {
    v,
    fingerprint,
    snapshotId,
    snapshotAt,
    searchAfter,
    expiresAt,
  };
}

function criteriaFingerprintValue(criteria: SearchCriteria): Record<string, unknown> {
  return {
    q: criteria.q ?? null,
    type: criteria.type ?? null,
    categoryId: criteria.categoryId ?? null,
    regionCode: criteria.regionCode ?? null,
    latitude: criteria.latitude ?? null,
    longitude: criteria.longitude ?? null,
    radiusMiles: criteria.radiusMiles ?? null,
    minPrice: criteria.minPrice ?? null,
    maxPrice: criteria.maxPrice ?? null,
    sort: criteria.sort ?? "RELEVANCE",
    limit: criteria.limit ?? 20,
  };
}

export function searchCriteria(input: ListingSearchInput): SearchCriteria {
  return {
    q: input.q,
    type: input.type,
    categoryId: input.categoryId,
    regionCode: input.regionCode,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMiles: input.radiusMiles,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    sort: input.sort,
    limit: input.limit,
  };
}

export function searchCriteriaFingerprint(criteria: SearchCriteria): string {
  return createHash("sha256")
    .update(JSON.stringify(criteriaFingerprintValue(criteria)))
    .digest("hex");
}

export class SearchCursorCodec {
  readonly #key: Buffer;

  constructor(secret: string) {
    this.#key = createHmac("sha256", secret).update("socal-life:search-cursor:v1").digest();
  }

  encode(input: {
    fingerprint: string;
    snapshotId: string;
    snapshotAt: string;
    searchAfter: readonly SearchSortValue[];
    expiresAt: number;
  }): string {
    const payload = parsePayload({ v: cursorVersion, ...input });
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.#key).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  decode(token: string, expectedFingerprint: string, now: Date): SearchCursorPayload {
    const segments = token.split(".");
    if (segments.length !== 2) throw new SearchCursorInvalidError();
    const [encoded = "", suppliedSignature = ""] = segments;
    let expectedSignature: Buffer;
    let actualSignature: Buffer;
    try {
      expectedSignature = createHmac("sha256", this.#key).update(encoded).digest();
      actualSignature = Buffer.from(suppliedSignature, "base64url");
    } catch {
      throw new SearchCursorInvalidError();
    }
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new SearchCursorInvalidError();
    }

    let payload: SearchCursorPayload;
    try {
      payload = parsePayload(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    } catch (error: unknown) {
      if (error instanceof SearchCursorInvalidError) throw error;
      throw new SearchCursorInvalidError();
    }
    if (payload.fingerprint !== expectedFingerprint) {
      throw new SearchCursorInvalidError("The search cursor does not match this query");
    }
    if (payload.expiresAt <= Math.floor(now.getTime() / 1_000)) {
      throw new SearchCursorExpiredError();
    }
    return payload;
  }
}
