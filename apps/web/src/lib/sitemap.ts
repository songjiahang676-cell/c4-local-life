import type { ListingType, Locale, PublicListingSummaryView } from "@socal/contracts";
import {
  PUBLIC_VERTICALS,
  loadPublicCities,
  loadPublicListingSitemapPage,
  publicListingPath,
  publicVerticalPath,
  type PublicVertical,
} from "./public-listings";
import { SUPPORTED_LOCALES, absolutePublicUrl, parseSeoCityRouteAllowlist } from "./seo";

export const SITEMAP_MAX_URLS = 10_000;
export const SITEMAP_MAX_SOURCE_RECORDS = 10_000;
export const SITEMAP_MAX_XML_BYTES = 10_000_000;
export const SITEMAP_MAX_PAGES = 200;
export const SITEMAP_GENERATION_TIMEOUT_MILLISECONDS = 15_000;

export type SitemapUrlEntry = Readonly<{
  location: string;
  lastModified?: string;
  publishedMonth?: string;
  alternates: Readonly<Record<Locale, string>>;
}>;

export type SitemapIndexEntry = Readonly<{
  location: string;
  lastModified?: string;
}>;

export type SitemapShardResult =
  | Readonly<{ kind: "ready"; entries: readonly SitemapUrlEntry[] }>
  | Readonly<{ kind: "unavailable"; reason: "source" | "budget" | "cursor" }>;

export type SitemapIndexResult =
  | Readonly<{ kind: "ready"; entries: readonly SitemapIndexEntry[] }>
  | Readonly<{ kind: "unavailable"; reason: "source" | "budget" | "cursor" }>;

type SitemapLoadOptions = Readonly<{
  now?: Date;
  maxUrls?: number;
  maxSourceRecords?: number;
  maxPages?: number;
  timeoutMilliseconds?: number;
  publishedMonth?: string;
}>;

const listingTypes = Object.values(PUBLIC_VERTICALS) as readonly ListingType[];
const verticalByType = new Map<ListingType, PublicVertical>(
  Object.entries(PUBLIC_VERTICALS).map(([vertical, type]) => [type, vertical as PublicVertical]),
);

function publicInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentPublicListing(listing: PublicListingSummaryView, now: number): boolean {
  const published = publicInstant(listing.publishedAt);
  const expires = publicInstant(listing.expiresAt);
  return (
    listing.status === "PUBLISHED" &&
    published !== null &&
    expires !== null &&
    published <= now &&
    expires > now
  );
}

function listingEntry(locale: Locale, listing: PublicListingSummaryView): SitemapUrlEntry {
  const alternateEntries = SUPPORTED_LOCALES.map((alternateLocale) => [
    alternateLocale,
    absolutePublicUrl(publicListingPath(alternateLocale, listing)),
  ]);
  return {
    location: absolutePublicUrl(publicListingPath(locale, listing)),
    lastModified: listing.updatedAt,
    publishedMonth: listing.publishedAt.slice(0, 7),
    alternates: Object.fromEntries(alternateEntries) as Readonly<Record<Locale, string>>,
  };
}

function sortEntries(entries: readonly SitemapUrlEntry[]): readonly SitemapUrlEntry[] {
  return [...entries].sort((left, right) => left.location.localeCompare(right.location));
}

export async function loadListingSitemapShard(
  locale: Locale,
  type: ListingType,
  options: SitemapLoadOptions = {},
): Promise<SitemapShardResult> {
  const now = (options.now ?? new Date()).getTime();
  const maxUrls = options.maxUrls ?? SITEMAP_MAX_URLS;
  const maxSourceRecords = options.maxSourceRecords ?? SITEMAP_MAX_SOURCE_RECORDS;
  const maxPages = options.maxPages ?? SITEMAP_MAX_PAGES;
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? SITEMAP_GENERATION_TIMEOUT_MILLISECONDS;
  const publishedMonth = options.publishedMonth;
  if (
    !Number.isFinite(now) ||
    !Number.isSafeInteger(maxUrls) ||
    maxUrls < 1 ||
    !Number.isSafeInteger(maxSourceRecords) ||
    maxSourceRecords < 1 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    (publishedMonth !== undefined && !/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(publishedMonth))
  ) {
    return { kind: "unavailable", reason: "budget" };
  }

  const byId = new Map<string, PublicListingSummaryView>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let sourceRecords = 0;
  let pages = 0;
  const startedAt = Date.now();

  while (true) {
    pages += 1;
    if (pages > maxPages || Date.now() - startedAt > timeoutMilliseconds) {
      return { kind: "unavailable", reason: "budget" };
    }
    const page = await loadPublicListingSitemapPage(locale, type, cursor);
    if (page.kind !== "ready") return { kind: "unavailable", reason: "source" };
    sourceRecords += page.items.length;
    if (sourceRecords > maxSourceRecords) {
      return { kind: "unavailable", reason: "budget" };
    }
    for (const listing of page.items) {
      if (!isCurrentPublicListing(listing, now)) continue;
      if (publishedMonth && listing.publishedAt.slice(0, 7) !== publishedMonth) continue;
      const existing = byId.get(listing.id);
      if (!existing || listing.updatedAt > existing.updatedAt) byId.set(listing.id, listing);
      if (byId.size > maxUrls) return { kind: "unavailable", reason: "budget" };
    }
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) {
      return { kind: "unavailable", reason: "cursor" };
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return {
    kind: "ready",
    entries: sortEntries([...byId.values()].map((listing) => listingEntry(locale, listing))),
  };
}

function staticEntry(locale: Locale, path: string): SitemapUrlEntry {
  const alternates = Object.fromEntries(
    SUPPORTED_LOCALES.map((alternateLocale) => [
      alternateLocale,
      absolutePublicUrl(path.replace(`/${locale}`, `/${alternateLocale}`)),
    ]),
  ) as Readonly<Record<Locale, string>>;
  return {
    location: absolutePublicUrl(path),
    alternates,
  };
}

export async function loadStaticSitemapShard(locale: Locale): Promise<SitemapShardResult> {
  const entries: SitemapUrlEntry[] = [
    staticEntry(locale, `/${locale}`),
    ...listingTypes.map((type) => staticEntry(locale, publicVerticalPath(locale, type))),
  ];
  const approved = [...parseSeoCityRouteAllowlist()].sort();
  if (approved.length === 0) return { kind: "ready", entries: sortEntries(entries) };
  const cities = await loadPublicCities(locale);
  if (cities.kind !== "ready") return { kind: "unavailable", reason: "source" };
  for (const value of approved) {
    const [vertical, citySlug, extra] = value.split(":");
    const type = PUBLIC_VERTICALS[vertical as PublicVertical];
    if (!type || !citySlug || extra) continue;
    const city = cities.regions.find((candidate) => candidate.slug === citySlug);
    if (!city) continue;
    entries.push(
      staticEntry(locale, `${publicVerticalPath(locale, type)}/${encodeURIComponent(city.slug)}`),
    );
  }
  return { kind: "ready", entries: sortEntries(entries) };
}

function latestModified(entries: readonly SitemapUrlEntry[]): string | undefined {
  return entries
    .map((entry) => entry.lastModified)
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
}

export async function loadSitemapIndex(): Promise<SitemapIndexResult> {
  const entries: SitemapIndexEntry[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    entries.push({
      location: absolutePublicUrl(`/sitemaps/${locale}/static.xml`),
    });
  }
  const shards = await Promise.all(
    listingTypes.map(async (type) => ({
      type,
      shard: await loadListingSitemapShard("zh-Hans", type),
    })),
  );
  for (const { type, shard } of shards) {
    const vertical = verticalByType.get(type);
    if (!vertical) return { kind: "unavailable", reason: "source" };
    if (shard.kind !== "ready") return shard;
    const months = [
      ...new Set(
        shard.entries
          .map((entry) => entry.publishedMonth)
          .filter((value): value is string => value !== undefined),
      ),
    ].sort();
    for (const month of months) {
      const lastModified = latestModified(
        shard.entries.filter((entry) => entry.publishedMonth === month),
      );
      for (const locale of SUPPORTED_LOCALES) {
        entries.push({
          location: absolutePublicUrl(`/sitemaps/${locale}/${vertical}-${month}.xml`),
          ...(lastModified ? { lastModified } : {}),
        });
      }
    }
  }
  return {
    kind: "ready",
    entries: [...entries].sort((left, right) => left.location.localeCompare(right.location)),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function validLastModified(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

export function renderSitemapXml(entries: readonly SitemapUrlEntry[]): string | null {
  const urls = entries.map((entry) => {
    if (!sameOriginUrl(entry.location)) return null;
    const lastModified = validLastModified(entry.lastModified)
      ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>`
      : "";
    const alternates = SUPPORTED_LOCALES.map((locale) => {
      const alternate = entry.alternates[locale];
      return sameOriginUrl(alternate)
        ? `<xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(alternate)}"/>`
        : null;
    });
    if (alternates.some((alternate) => alternate === null)) return null;
    return `<url><loc>${escapeXml(entry.location)}</loc>${lastModified}${alternates.join("")}</url>`;
  });
  if (urls.some((url) => url === null)) return null;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`;
  return new TextEncoder().encode(xml).byteLength <= SITEMAP_MAX_XML_BYTES ? xml : null;
}

export function renderSitemapIndexXml(entries: readonly SitemapIndexEntry[]): string | null {
  const sitemaps = entries.map((entry) => {
    if (!sameOriginUrl(entry.location)) return null;
    const lastModified = validLastModified(entry.lastModified)
      ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>`
      : "";
    return `<sitemap><loc>${escapeXml(entry.location)}</loc>${lastModified}</sitemap>`;
  });
  if (sitemaps.some((sitemap) => sitemap === null)) return null;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemaps.join("")}</sitemapindex>`;
  return new TextEncoder().encode(xml).byteLength <= SITEMAP_MAX_XML_BYTES ? xml : null;
}

function sameOriginUrl(value: string | undefined): value is string {
  if (!value || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === new URL(absolutePublicUrl("/")).origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function sitemapResourceType(
  resource: string,
): Readonly<{ type: ListingType; publishedMonth: string }> | "static" | null {
  if (resource === "static.xml") return "static";
  const match =
    /^(jobs|rentals|transfers|marketplace|services)-((?:19|20)\d{2}-(?:0[1-9]|1[0-2]))\.xml$/.exec(
      resource,
    );
  if (!match?.[1] || !match[2]) return null;
  const type = PUBLIC_VERTICALS[match[1] as PublicVertical];
  return type ? { type, publishedMonth: match[2] } : null;
}
