import { hasTrustedPublicOrigin } from "../../lib/seo";
import { loadSitemapIndex, renderSitemapIndexXml } from "../../lib/sitemap";
import { sitemapUnavailableResponse, sitemapXmlResponse } from "../../lib/sitemap-response";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = performance.now();
  if (!hasTrustedPublicOrigin()) return sitemapUnavailableResponse("index", startedAt);
  const result = await loadSitemapIndex();
  if (result.kind !== "ready") return sitemapUnavailableResponse("index", startedAt);
  const xml = renderSitemapIndexXml(result.entries);
  return xml
    ? sitemapXmlResponse(xml, result.entries.length, startedAt)
    : sitemapUnavailableResponse("index", startedAt);
}
