const successCacheControl = "no-store";

function durationMilliseconds(startedAt: number): number {
  return Math.max(0, Math.min(60_000, Math.round(performance.now() - startedAt)));
}

export function sitemapXmlResponse(xml: string, entryCount: number, startedAt: number): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "cache-control": successCacheControl,
      "content-type": "application/xml; charset=utf-8",
      "server-timing": `sitemap;dur=${durationMilliseconds(startedAt)}`,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
      "x-socal-sitemap-entries": String(entryCount),
    },
  });
}

export function sitemapUnavailableResponse(scope: string, startedAt: number): Response {
  console.error(
    JSON.stringify({
      event: "seo.sitemap_generation_failed",
      scope,
    }),
  );
  return new Response("Sitemap temporarily unavailable.\n", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "60",
      "server-timing": `sitemap;dur=${durationMilliseconds(startedAt)}`,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}
