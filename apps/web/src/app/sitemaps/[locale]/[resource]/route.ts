import { hasTrustedPublicOrigin, isSupportedLocale } from "../../../../lib/seo";
import {
  loadListingSitemapShard,
  loadStaticSitemapShard,
  renderSitemapXml,
  sitemapResourceType,
} from "../../../../lib/sitemap";
import { sitemapUnavailableResponse, sitemapXmlResponse } from "../../../../lib/sitemap-response";

export const dynamic = "force-dynamic";

type SitemapRouteContext = Readonly<{
  params: Promise<{
    locale: string;
    resource: string;
  }>;
}>;

export async function GET(_request: Request, context: SitemapRouteContext): Promise<Response> {
  const startedAt = performance.now();
  const { locale: rawLocale, resource } = await context.params;
  if (!isSupportedLocale(rawLocale)) return new Response("Not Found\n", { status: 404 });
  const partition = sitemapResourceType(resource);
  if (!partition) return new Response("Not Found\n", { status: 404 });
  const scope = partition === "static" ? "static" : "listing";
  if (!hasTrustedPublicOrigin()) return sitemapUnavailableResponse(scope, startedAt);
  const result =
    partition === "static"
      ? await loadStaticSitemapShard(rawLocale)
      : await loadListingSitemapShard(rawLocale, partition.type, {
          publishedMonth: partition.publishedMonth,
        });
  if (result.kind !== "ready") return sitemapUnavailableResponse(scope, startedAt);
  const xml = renderSitemapXml(result.entries);
  return xml
    ? sitemapXmlResponse(xml, result.entries.length, startedAt)
    : sitemapUnavailableResponse(scope, startedAt);
}
