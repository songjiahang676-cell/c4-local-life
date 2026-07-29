import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type ProxyContext = {
  params: Promise<{ path: string[] }>;
};

const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const requestHeaderAllowlist = new Set([
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "idempotency-key",
  "if-match",
  "origin",
  "traceparent",
  "tracestate",
  "user-agent",
  "x-csrf-token",
  "x-device-id",
  "x-request-id",
]);
const responseHeaderBlocklist = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const pathRules: Readonly<Record<string, readonly RegExp[]>> = {
  GET: [
    /^auth\/session$/,
    /^notifications$/,
    /^regions$/,
    /^categories$/,
    new RegExp(`^categories/${uuid}/form-schema$`),
    new RegExp(`^listings/${uuid}$`),
    new RegExp(`^media/${uuid}$`),
  ],
  POST: [/^listings$/, /^media\/uploads$/, new RegExp(`^media/${uuid}/complete$`)],
  PATCH: [new RegExp(`^listings/${uuid}$`)],
  PUT: [new RegExp(`^notifications/${uuid}/read$`)],
};

export function isAllowedWebApiPath(method: string, path: string): boolean {
  return Boolean(pathRules[method]?.some((rule) => rule.test(path)));
}

function apiBaseUrl(): URL | null {
  try {
    const url = new URL(process.env.API_BASE_URL ?? "http://127.0.0.1:4000/v1");
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function proxyApi(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  const path = (await context.params).path.join("/");
  if (!isAllowedWebApiPath(request.method, path)) {
    return NextResponse.json(
      { title: "Not Found", status: 404, detail: "The requested resource was not found." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { title: "Service Unavailable", status: 503, detail: "Draft service is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const upstreamUrl = new URL(`${baseUrl.toString().replace(/\/$/, "")}/${path}`);
  upstreamUrl.search = request.nextUrl.search;
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (requestHeaderAllowlist.has(name.toLowerCase())) headers.set(name, value);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers();
    upstream.headers.forEach((value, name) => {
      if (!responseHeaderBlocklist.has(name.toLowerCase())) responseHeaders.set(name, value);
    });
    const setCookies = (
      upstream.headers as Headers & { getSetCookie?: () => readonly string[] }
    ).getSetCookie?.();
    for (const cookie of setCookies ?? []) responseHeaders.append("set-cookie", cookie);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("pragma", "no-cache");
    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { title: "Service Unavailable", status: 503, detail: "Draft service is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = proxyApi;
export const POST = proxyApi;
export const PATCH = proxyApi;
export const PUT = proxyApi;
