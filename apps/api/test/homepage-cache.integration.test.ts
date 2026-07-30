import { randomUUID } from "node:crypto";
import type { HomepageResponse, ValidatedHomepageQuery } from "@socal/contracts";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidHomepageCacheEntryError,
  RedisHomepageCache,
} from "../src/modules/homepage/homepage-cache";

const redisUrl = process.env.REDIS_INTEGRATION_URL ?? "";
const integration = describe.skipIf(redisUrl.length === 0);

integration("homepage response cache with Redis", () => {
  let connection: IORedis;
  let cache: RedisHomepageCache;
  const regionCode = `TEST-${randomUUID()}`;
  const query: ValidatedHomepageQuery = {
    locale: "zh-Hans",
    regionCode,
    device: "desktop",
  };
  const key = `socal:homepage:v1:zh-Hans:${regionCode}:desktop`;
  const response: HomepageResponse = {
    layout: {
      version: 1,
      locale: query.locale,
      regionCode: query.regionCode,
      device: query.device,
    },
    modules: [
      {
        key: "hero",
        kind: "HERO",
        dataVersion: "a".repeat(64),
        cache: { ttlSeconds: 120, tags: [`homepage.config.zh-Hans.${regionCode}.v1`] },
        data: {
          contentKey: "homepage.hero",
          title: "南加州本地生活",
          subtitle: "真实公开信息",
          searchPlaceholder: "搜索本地信息",
        },
      },
    ],
    partial: false,
    generatedAt: "2026-07-29T12:00:00.000Z",
  };

  beforeAll(() => {
    connection = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    cache = new RedisHomepageCache({
      get: (entryKey) => connection.get(entryKey),
      setExpiring: async (entryKey, value, ttlSeconds) => {
        await connection.set(entryKey, value, "EX", ttlSeconds);
      },
      delete: async (entryKey) => {
        await connection.del(entryKey);
      },
    });
  });

  afterAll(async () => {
    if (connection) {
      await connection.del(key);
      await connection.quit();
    }
  });

  it("round-trips a strict bounded entry with a real expiry", async () => {
    await cache.write(query, response, 120);
    await expect(cache.read(query)).resolves.toEqual(response);
    const ttl = await connection.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it("removes a poisoned Redis value before returning to the caller", async () => {
    await connection.set(key, '{"private":"poison"}', "EX", 120);
    await expect(cache.read(query)).rejects.toBeInstanceOf(InvalidHomepageCacheEntryError);
    await expect(connection.exists(key)).resolves.toBe(0);
  });
});
