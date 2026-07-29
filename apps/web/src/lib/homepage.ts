import { homepageResponseSchema, type HomepageResponse, type Locale } from "@socal/contracts";

export type HomepageModel =
  Readonly<{ kind: "ready"; response: HomepageResponse }> | Readonly<{ kind: "unavailable" }>;

const responseLimit = 1_000_000;
const requestTimeoutMilliseconds = 5_000;

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

export async function loadHomepage(locale: Locale): Promise<HomepageModel> {
  const base = apiBaseUrl();
  if (!base) return { kind: "unavailable" };
  const url = new URL("homepage", base);
  url.searchParams.set("locale", locale);
  url.searchParams.set("regionCode", "US-CA-SOCAL");
  url.searchParams.set("device", "desktop");

  try {
    const response = await fetch(url, {
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
    return parsed.success ? { kind: "ready", response: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
