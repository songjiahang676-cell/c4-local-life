import "@testing-library/jest-dom/vitest";
import type { ListingType, PublicListingSummaryView, PublicListingView } from "@socal/contracts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getSitemapIndex } from "../src/app/sitemap.xml/route";
import { GET as getSitemapShard } from "../src/app/sitemaps/[locale]/[resource]/route";
import {
  StructuredData,
  breadcrumbStructuredData,
  isStructuredDataNode,
  jobPostingStructuredData,
  serializeStructuredData,
  websiteStructuredData,
} from "../src/lib/structured-data";
import {
  loadListingSitemapShard,
  renderSitemapIndexXml,
  renderSitemapXml,
} from "../src/lib/sitemap";

const listingId = "11111111-1111-4111-8111-111111111111";
const secondListingId = "11111111-1111-4111-8111-111111111112";
const regionId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";

function summary(
  type: ListingType,
  overrides: Partial<PublicListingSummaryView> = {},
): PublicListingSummaryView {
  return {
    id: listingId,
    type,
    status: "PUBLISHED",
    locale: "en-US",
    title: "Synthetic public listing",
    slug: "synthetic-public-listing",
    summary: "Fictional contract data.",
    price: { amount: "22.00", currency: "USD", unit: "HOURLY" },
    region: {
      id: regionId,
      code: "US-CA-SYNTHETIC",
      slug: "synthetic-city",
      nameZhHans: "测试城市",
      nameEn: "Synthetic City",
      type: "CITY",
      timezone: "America/Los_Angeles",
    },
    category: {
      id: categoryId,
      vertical: type,
      slug: `synthetic-${type.toLowerCase()}`,
      nameZhHans: "测试分类",
      nameEn: "Synthetic category",
    },
    owner: {
      id: ownerId,
      displayName: "Synthetic Publisher",
      avatarUrl: null,
    },
    organization: null,
    location: { precision: "CITY" },
    attributes: {},
    featured: false,
    featuredUntil: null,
    publishedAt: "2026-07-01T12:00:00.000Z",
    expiresAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function detail(overrides: Partial<PublicListingView> = {}): PublicListingView {
  return {
    ...summary("JOB"),
    body: "Safe visible body with <script>text markers</script>.",
    attributes: {
      employerName: "Synthetic Employer",
      employmentType: "full-time",
      wageMax: "24.00",
    },
    createdAt: "2026-07-01T11:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sitemapFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/regions")) {
      return jsonResponse({
        data: [
          {
            id: regionId,
            parentId: null,
            code: "US-CA-SYNTHETIC",
            type: "CITY",
            slug: "synthetic-city",
            name: { "zh-Hans": "测试城市", "en-US": "Synthetic City" },
            timezone: "America/Los_Angeles",
            centroid: null,
            active: true,
            aliases: [],
            children: [],
          },
        ],
      });
    }
    if (url.pathname.endsWith("/listings")) {
      const type = (url.searchParams.get("type") ?? "RENTAL") as ListingType;
      if (!url.searchParams.has("cursor")) {
        return jsonResponse({
          data: [
            summary(type),
            summary(type, {
              id: "11111111-1111-4111-8111-111111111113",
              slug: "expired-listing",
              expiresAt: "2026-07-20T12:00:00.000Z",
            }),
            summary(type, {
              id: "11111111-1111-4111-8111-111111111114",
              slug: "future-listing",
              publishedAt: "2026-08-01T12:00:00.000Z",
            }),
          ],
          page: { hasMore: true, nextCursor: "second-page" },
          generatedAt: "2026-07-29T13:00:00.000Z",
        });
      }
      return jsonResponse({
        data: [
          summary(type, {
            id: secondListingId,
            slug: "second-public-listing",
            updatedAt: "2026-07-29T13:00:00.000Z",
          }),
        ],
        page: { hasMore: false, nextCursor: null },
        generatedAt: "2026-07-29T13:00:00.000Z",
      });
    }
    return jsonResponse({ status: 404 }, 404);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("canonical sitemap partitions", () => {
  it("paginates canonical records and removes expired and future resources", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubGlobal("fetch", sitemapFetch());

    const result = await loadListingSitemapShard("en-US", "JOB", {
      now: new Date("2026-07-29T14:00:00.000Z"),
    });
    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind !== "ready") throw new Error("expected ready sitemap");
    expect(result.entries).toHaveLength(2);
    const xml = renderSitemapXml(result.entries);
    expect(xml).toContain(`/en-US/jobs/synthetic-city/synthetic-public-listing-${listingId}`);
    expect(xml).toContain(`/zh-Hans/jobs/synthetic-city/synthetic-public-listing-${listingId}`);
    expect(xml).not.toContain("expired-listing");
    expect(xml).not.toContain("future-listing");
    expect(xml).not.toContain("?q=");
    expect(xml).not.toContain("aggregateRating");
  });

  it("fails closed on source-record budgets instead of truncating a shard", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubGlobal("fetch", sitemapFetch());
    await expect(
      loadListingSitemapShard("zh-Hans", "RENTAL", {
        now: new Date("2026-07-29T14:00:00.000Z"),
        maxSourceRecords: 1,
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "budget" });
  });

  it("rejects repeated cursors and returns a non-disclosing no-store 503", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          data: [summary("RENTAL")],
          page: { hasMore: true, nextCursor: "repeated-cursor" },
          generatedAt: "2026-07-29T13:00:00.000Z",
        }),
      ),
    );
    await expect(
      loadListingSitemapShard("en-US", "RENTAL", {
        now: new Date("2026-07-29T14:00:00.000Z"),
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "cursor" });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await getSitemapShard(new Request("https://www.socal.test"), {
      params: Promise.resolve({ locale: "en-US", resource: "rentals-2026-07.xml" }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.text()).not.toContain("cursor");
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "seo.sitemap_generation_failed", scope: "listing" }),
    );
  });

  it("caps unique empty cursor pages independently of source-record counts", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        page += 1;
        return jsonResponse({
          data: [],
          page: { hasMore: true, nextCursor: `cursor-${page}` },
          generatedAt: "2026-07-29T13:00:00.000Z",
        });
      }),
    );
    await expect(
      loadListingSitemapShard("en-US", "RENTAL", {
        now: new Date("2026-07-29T14:00:00.000Z"),
        maxPages: 2,
      }),
    ).resolves.toEqual({ kind: "unavailable", reason: "budget" });
    expect(page).toBe(2);
  });

  it("serves a bounded language/resource index and validates approved real city shards", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubEnv("SEO_INDEXABLE_CITY_ROUTES", "rentals:synthetic-city");
    vi.stubGlobal("fetch", sitemapFetch());

    const indexResponse = await getSitemapIndex();
    const indexXml = await indexResponse.text();
    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("content-type")).toContain("application/xml");
    expect(indexResponse.headers.get("x-socal-sitemap-entries")).toBe("12");
    expect(indexXml.match(/<sitemap>/g)).toHaveLength(12);
    expect(indexXml).toContain(
      "<loc>https://www.socal.test/sitemaps/en-US/jobs-2026-07.xml</loc><lastmod>",
    );
    expect(indexXml).not.toContain("/search");

    const staticResponse = await getSitemapShard(new Request("https://www.socal.test"), {
      params: Promise.resolve({ locale: "en-US", resource: "static.xml" }),
    });
    const staticXml = await staticResponse.text();
    expect(staticResponse.status).toBe(200);
    expect(staticXml).toContain("<loc>https://www.socal.test/en-US</loc>");
    expect(staticXml).toContain("<loc>https://www.socal.test/en-US/rentals/synthetic-city</loc>");
    expect(staticXml).not.toContain("/account");

    const listingResponse = await getSitemapShard(new Request("https://www.socal.test"), {
      params: Promise.resolve({ locale: "en-US", resource: "rentals-2026-07.xml" }),
    });
    expect(listingResponse.status).toBe(200);
    expect(await listingResponse.text()).not.toContain("expired-listing");

    const missingResponse = await getSitemapShard(new Request("https://www.socal.test"), {
      params: Promise.resolve({ locale: "fr-FR", resource: "rentals-2026-07.xml" }),
    });
    expect(missingResponse.status).toBe(404);
  });

  it("rejects malformed sitemap XML inputs before serialization", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    expect(
      renderSitemapIndexXml([{ location: "https://attacker.invalid/sitemap.xml" }]),
    ).toBeNull();
    expect(
      renderSitemapXml([
        {
          location: "https://attacker.invalid/listing",
          alternates: {
            "zh-Hans": "https://www.socal.test/zh-Hans",
            "en-US": "https://www.socal.test/en-US",
          },
        },
      ]),
    ).toBeNull();
  });
});

describe("strict schema.org projection", () => {
  it("emits a same-origin WebSite SearchAction and strict breadcrumbs", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    const website = websiteStructuredData("en-US");
    const breadcrumb = breadcrumbStructuredData([
      { name: "Home", path: "/en-US" },
      { name: "Jobs", path: "/en-US/jobs" },
    ]);
    expect(isStructuredDataNode(website)).toBe(true);
    expect(website.potentialAction.target).toBe(
      "https://www.socal.test/en-US/search?q={search_term_string}",
    );
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb && isStructuredDataNode(breadcrumb)).toBe(true);
  });

  it("emits JobPosting only for a current real Job and safely serializes authored text", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    const node = jobPostingStructuredData(
      "en-US",
      detail(),
      `/en-US/jobs/synthetic-city/synthetic-public-listing-${listingId}`,
      new Date("2026-07-29T14:00:00.000Z"),
    );
    expect(node).toMatchObject({
      "@type": "JobPosting",
      employmentType: "FULL_TIME",
      hiringOrganization: { name: "Synthetic Employer" },
      jobLocation: {
        address: {
          addressLocality: "Synthetic City",
          addressRegion: "CA",
          addressCountry: "US",
        },
      },
    });
    expect(node && isStructuredDataNode(node)).toBe(true);
    const serialized = node ? serializeStructuredData(node) : null;
    expect(serialized).not.toContain("<script>");
    expect(serialized).not.toContain("aggregateRating");
    expect(serialized).not.toContain("phone");
    expect(JSON.parse(serialized ?? "{}")).toMatchObject({ "@type": "JobPosting" });

    expect(
      jobPostingStructuredData(
        "en-US",
        detail({ expiresAt: "2026-07-20T12:00:00.000Z" }),
        `/en-US/jobs/synthetic-city/synthetic-public-listing-${listingId}`,
        new Date("2026-07-29T14:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      jobPostingStructuredData(
        "en-US",
        detail({ summary: null }),
        `/en-US/jobs/synthetic-city/synthetic-public-listing-${listingId}`,
        new Date("2026-07-29T14:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      jobPostingStructuredData(
        "en-US",
        detail({ type: "RENTAL" }),
        `/en-US/rentals/synthetic-city/synthetic-public-listing-${listingId}`,
        new Date("2026-07-29T14:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("renders only nodes that pass the strict runtime schema", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    const website = websiteStructuredData("zh-Hans");
    const invalid = {
      ...website,
      aggregateRating: { ratingValue: 5 },
    } as typeof website;
    expect(serializeStructuredData(invalid)).toBeNull();
    expect(serializeStructuredData({ "@context": "https://schema.org", "@type": "WebSite" })).toBe(
      null,
    );
    const { container } = render(<StructuredData nodes={[website, invalid]} />);
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0]?.textContent ?? "{}")).toMatchObject({
      "@type": "WebSite",
      inLanguage: "zh-Hans",
    });
  });
});
