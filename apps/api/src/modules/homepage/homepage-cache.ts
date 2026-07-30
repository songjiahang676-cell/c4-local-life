import {
  homepageCacheEntryKey,
  homepageResponseSchema,
  type HomepageResponse,
  type ValidatedHomepageQuery,
} from "@socal/contracts";

export const HOMEPAGE_CACHE = Symbol("HOMEPAGE_CACHE");

export type HomepageCache = {
  read(query: ValidatedHomepageQuery): Promise<HomepageResponse | null>;
  write(
    query: ValidatedHomepageQuery,
    response: HomepageResponse,
    ttlSeconds: number,
  ): Promise<void>;
};

type HomepageRedisClient = {
  get(key: string): Promise<string | null>;
  setExpiring(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
};

const maximumCacheBytes = 1_000_000;
const maximumCompositeTtlSeconds = 300;

export class InvalidHomepageCacheEntryError extends Error {
  readonly code = "HOMEPAGE_CACHE_ENTRY_INVALID";

  constructor() {
    super("The homepage cache entry is invalid");
    this.name = "InvalidHomepageCacheEntryError";
  }
}

function matchesQuery(response: HomepageResponse, query: ValidatedHomepageQuery): boolean {
  return (
    response.layout.locale === query.locale &&
    response.layout.regionCode === query.regionCode &&
    response.layout.device === query.device
  );
}

export function homepageCompositeTtlSeconds(response: HomepageResponse): number {
  if (response.partial || response.modules.length === 0) return 0;
  const moduleTtl = response.modules.map((module) => module.cache.ttlSeconds);
  if (moduleTtl.some((ttl) => ttl === 0)) return 0;
  return Math.min(maximumCompositeTtlSeconds, ...moduleTtl);
}

export class RedisHomepageCache implements HomepageCache {
  constructor(private readonly redis: HomepageRedisClient) {}

  async read(query: ValidatedHomepageQuery): Promise<HomepageResponse | null> {
    const key = homepageCacheEntryKey(query);
    const serialized = await this.redis.get(key);
    if (serialized === null) return null;

    try {
      if (Buffer.byteLength(serialized, "utf8") > maximumCacheBytes) {
        throw new InvalidHomepageCacheEntryError();
      }
      const parsed = homepageResponseSchema.parse(JSON.parse(serialized) as unknown);
      if (!matchesQuery(parsed, query) || parsed.partial) {
        throw new InvalidHomepageCacheEntryError();
      }
      return parsed;
    } catch {
      await this.redis.delete(key).catch(() => undefined);
      throw new InvalidHomepageCacheEntryError();
    }
  }

  async write(
    query: ValidatedHomepageQuery,
    response: HomepageResponse,
    ttlSeconds: number,
  ): Promise<void> {
    const parsed = homepageResponseSchema.parse(response);
    if (
      !matchesQuery(parsed, query) ||
      parsed.partial ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > maximumCompositeTtlSeconds
    ) {
      throw new InvalidHomepageCacheEntryError();
    }
    const serialized = JSON.stringify(parsed);
    if (Buffer.byteLength(serialized, "utf8") > maximumCacheBytes) {
      throw new InvalidHomepageCacheEntryError();
    }
    await this.redis.setExpiring(homepageCacheEntryKey(query), serialized, ttlSeconds);
  }
}
