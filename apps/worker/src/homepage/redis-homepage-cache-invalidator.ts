import type { HomepageCacheInvalidator } from "./homepage-cache-invalidation";

type RedisScriptClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...arguments_: Array<string | number>
  ): Promise<unknown>;
};

const invalidateScript = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local incoming = tonumber(ARGV[1])
if incoming <= current then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2], KEYS[3], KEYS[4])
return 1
`;

function scopePrefix(locale: "zh-Hans" | "en-US", regionCode: string): string {
  return `socal:homepage:v1:${locale}:${regionCode}`;
}

export class RedisHomepageCacheInvalidator implements HomepageCacheInvalidator {
  constructor(private readonly redis: RedisScriptClient) {}

  async invalidate(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version: number;
  }): Promise<"invalidated" | "stale"> {
    const prefix = scopePrefix(input.locale, input.regionCode);
    const result = await this.redis.eval(
      invalidateScript,
      4,
      `${prefix}:layout-version`,
      `${prefix}:desktop`,
      `${prefix}:tablet`,
      `${prefix}:mobile`,
      input.version,
    );
    if (result === 1 || result === "1") return "invalidated";
    if (result === 0 || result === "0") return "stale";
    throw new Error("Unexpected Redis homepage invalidation result");
  }
}
