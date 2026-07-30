import { homepageResponseSchema, type HomepageResponse, type Locale } from "@socal/contracts";

export type HomepageModel =
  Readonly<{ kind: "ready"; response: HomepageResponse }> | Readonly<{ kind: "unavailable" }>;

const responseLimit = 1_000_000;
const requestTimeoutMilliseconds = 5_000;
const maximumWebCacheTtlMilliseconds = 30_000;

type HomepageFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

type CachedHomepage = {
  expiresAt: number;
  model: Extract<HomepageModel, { kind: "ready" }>;
};

function apiBaseUrl(): URL | null {
  try {
    const url = new URL(process.env.API_BASE_URL ?? "http://127.0.0.1:4000/v1");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function createHomepageLoader(
  request: HomepageFetch = fetch,
  clock: () => number = Date.now,
): (locale: Locale) => Promise<HomepageModel> {
  const cache = new Map<Locale, CachedHomepage>();
  const inFlight = new Map<Locale, Promise<HomepageModel>>();

  return async (locale: Locale): Promise<HomepageModel> => {
    const cached = cache.get(locale);
    const now = clock();
    if (cached && cached.expiresAt > now) return cached.model;

    const pending = inFlight.get(locale);
    if (pending) return pending;

    const load = (async (): Promise<HomepageModel> => {
      const base = apiBaseUrl();
      if (!base) return { kind: "unavailable" };
      const url = new URL("homepage", base);
      url.searchParams.set("locale", locale);
      url.searchParams.set("regionCode", "US-CA-SOCAL");
      url.searchParams.set("device", "desktop");

      try {
        const response = await request(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            "accept-language": locale,
            "user-agent": "SoCalLifeWebSSRBot/0.1",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(requestTimeoutMilliseconds),
        });
        if (!response.ok) return { kind: "unavailable" };
        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > responseLimit) {
          return { kind: "unavailable" };
        }
        const body = await response.text();
        if (body.length > responseLimit) return { kind: "unavailable" };
        const parsed = homepageResponseSchema.safeParse(JSON.parse(body) as unknown);
        if (!parsed.success) return { kind: "unavailable" };
        const model = { kind: "ready", response: parsed.data } as const;
        const ttlSeconds =
          !parsed.data.partial && parsed.data.modules.length > 0
            ? Math.min(...parsed.data.modules.map((module) => module.cache.ttlSeconds))
            : 0;
        if (ttlSeconds > 0) {
          cache.set(locale, {
            expiresAt: now + Math.min(ttlSeconds * 1_000, maximumWebCacheTtlMilliseconds),
            model,
          });
        }
        return model;
      } catch {
        return { kind: "unavailable" };
      }
    })();
    inFlight.set(locale, load);
    try {
      return await load;
    } finally {
      inFlight.delete(locale);
    }
  };
}

export const loadHomepage = createHomepageLoader();
