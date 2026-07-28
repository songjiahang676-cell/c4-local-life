import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type ProxyContext = {
  params: Promise<{ path: string[] }>;
};

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
  "set-cookie",
  "transfer-encoding",
]);

const allowedApiPaths = new Set([
  "auth/session",
  "auth/otp/request",
  "auth/otp/verify",
  "admin/session",
]);

function isAllowedPath(path: string): boolean {
  return allowedApiPaths.has(path);
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
  if (!isAllowedPath(path)) {
    return NextResponse.json(
      { title: "Not Found", status: 404, detail: "The requested resource was not found." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { title: "Service Unavailable", status: 503, detail: "Admin sign-in is unavailable." },
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
      { title: "Service Unavailable", status: 503, detail: "Admin sign-in is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = proxyApi;
export const POST = proxyApi;
export const DELETE = proxyApi;
