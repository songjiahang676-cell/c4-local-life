import "@testing-library/jest-dom/vitest";
import type { PublicListingView, SearchListingResult } from "@socal/contracts";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublicListingDetailView,
  PublicListingIndexView,
} from "../src/components/public-listing-pages";
import {
  formatListingPrice,
  listingIdFromSlug,
  loadPublicListingDetail,
  loadPublicListingIndex,
  nextPagePath,
  parsePublicListingFilters,
  publicListingPath,
  publicAttributeEntries,
  type PublicListingIndexModel,
} from "../src/lib/public-listings";
import { publicSearchMetadata, publicVerticalMetadata } from "../src/lib/public-listing-routes";
import {
  hasTrustedPublicOrigin,
  homepageSeoMetadata,
  parseSeoCityRouteAllowlist,
  privatePageMetadata,
  publicWebOrigin,
  sanitizeMetadataText,
} from "../src/lib/seo";
import webRobots from "../src/app/robots";

const listingId = "11111111-1111-4111-8111-111111111111";

const searchListing = {
  id: listingId,
  type: "RENTAL",
  status: "PUBLISHED",
  locale: "en-US",
  slug: "synthetic-rental",
  title: "Synthetic Irvine rental",
  summary: "Fictional public content for a rendering boundary test.",
  price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
  region: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "US-CA-SYNTHETIC",
    slug: "synthetic-city",
    nameZhHans: "测试城市",
    nameEn: "Synthetic City",
  },
  category: {
    id: "33333333-3333-4333-8333-333333333333",
    vertical: "RENTAL",
    slug: "apartments",
    nameZhHans: "公寓",
    nameEn: "Apartments",
  },
  owner: {
    id: "44444444-4444-4444-8444-444444444444",
    displayName: "Synthetic Publisher",
    avatarUrl: null,
  },
  organization: {
    id: "55555555-5555-4555-8555-555555555555",
    slug: "synthetic-org",
    verificationStatus: "VERIFIED",
  },
  location: { precision: "CITY", point: null },
  attributes: { bedrooms: 2 },
  sponsored: true,
  distanceMiles: null,
  publishedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-08-29T12:00:00.000Z",
  updatedAt: "2026-07-29T12:30:00.000Z",
  version: 1,
} as const satisfies SearchListingResult;

const publicListing = {
  id: searchListing.id,
  type: searchListing.type,
  status: searchListing.status,
  locale: searchListing.locale,
  title: "Synthetic detail <script>alert(1)</script>",
  slug: searchListing.slug,
  summary: searchListing.summary,
  body: "Escaped body <script>window.bad = true</script>\nSecond line.",
  price: searchListing.price,
  region: {
    ...searchListing.region,
    type: "CITY",
    timezone: "America/Los_Angeles",
  },
  category: searchListing.category,
  organization: {
    ...searchListing.organization,
    displayName: "Synthetic Organization",
  },
  location: { precision: "CITY" },
  owner: searchListing.owner,
  attributes: {
    bedrooms: 2,
    furnished: false,
    nestedPrivateShape: { shouldNotRender: true },
  },
  featured: true,
  featuredUntil: "2026-08-01T12:00:00.000Z",
  publishedAt: searchListing.publishedAt,
  expiresAt: searchListing.expiresAt,
  createdAt: "2026-07-29T11:00:00.000Z",
  updatedAt: searchListing.updatedAt,
  version: searchListing.version,
} as const satisfies PublicListingView;

const regionResponse = {
  data: [
    {
      id: searchListing.region.id,
      parentId: null,
      code: searchListing.region.code,
      type: "CITY",
      slug: searchListing.region.slug,
      name: { "zh-Hans": searchListing.region.nameZhHans, "en-US": searchListing.region.nameEn },
      timezone: "America/Los_Angeles",
      centroid: null,
      active: true,
      aliases: [],
      children: [],
    },
  ],
};

const categoryResponse = {
  data: [
    {
      id: searchListing.category.id,
      parentId: null,
      vertical: "RENTAL",
      slug: searchListing.category.slug,
      name: {
        "zh-Hans": searchListing.category.nameZhHans,
        "en-US": searchListing.category.nameEn,
      },
      iconKey: "building",
      formSchemaVersion: 1,
      active: true,
      aliases: [],
      children: [],
    },
  ],
};

const searchResponse = {
  data: [searchListing],
  page: { hasMore: true, nextCursor: "signed-search-cursor" },
  facets: {
    types: [{ value: "RENTAL", count: 1 }],
    categories: [{ value: searchListing.category.id, count: 1 }],
    regions: [{ value: searchListing.region.code, count: 1 }],
    priceUnits: [{ value: "MONTHLY", count: 1 }],
  },
  correctedQuery: null,
  tookMs: 6,
  generatedAt: "2026-07-29T13:00:00.000Z",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function routeFetch(options?: { searchStatus?: number; detail?: unknown }) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/categories")) return jsonResponse(categoryResponse);
    if (url.pathname.endsWith("/regions")) return jsonResponse(regionResponse);
    if (url.pathname.endsWith("/search")) {
      if (options?.searchStatus)
        return jsonResponse({ status: options.searchStatus }, options.searchStatus);
      const headers = new Headers(init?.headers);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.get("user-agent")).toContain("SSRBot");
      return jsonResponse(searchResponse);
    }
    if (url.pathname.endsWith(`/listings/${listingId}`)) {
      return jsonResponse(options?.detail ?? { data: publicListing });
    }
    if (url.pathname.endsWith("/listings")) {
      const summary = {
        ...publicListing,
      } as Record<string, unknown>;
      delete summary.body;
      delete summary.createdAt;
      return jsonResponse({
        data: [summary],
        page: { hasMore: true, nextCursor: "canonical-cursor" },
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

describe("SEO metadata matrix", () => {
  it("normalizes the public origin and removes markup, controls, and bidi overrides", () => {
    expect(publicWebOrigin("https://www.socal.test/path?query=1#fragment").href).toBe(
      "https://www.socal.test/",
    );
    expect(publicWebOrigin("https://user:secret@example.test").href).toBe("http://localhost:3000/");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_WEB_URL", "");
    expect(hasTrustedPublicOrigin()).toBe(false);
    expect(homepageSeoMetadata("en-US", false)).toMatchObject({
      robots: { index: false, follow: true },
    });
    expect(sanitizeMetadataText("  Safe\u202e <script>alert(1)</script>\n title  ", 40)).toBe(
      "Safe alert(1) title",
    );
    expect(parseSeoCityRouteAllowlist("rentals:irvine, jobs:los-angeles")).toEqual(
      new Set(["rentals:irvine", "jobs:los-angeles"]),
    );
    expect(parseSeoCityRouteAllowlist("rentals:irvine,invalid/path")).toEqual(new Set());
  });

  it("indexes clean homepage and channel URLs with absolute bilingual alternates", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test/base");

    const homepage = homepageSeoMetadata("en-US", false);
    expect(homepage).toMatchObject({
      title: { absolute: "Southern California Local Services | SoCal Life" },
      alternates: {
        canonical: "https://www.socal.test/en-US",
        languages: {
          "zh-Hans": "https://www.socal.test/zh-Hans",
          "en-US": "https://www.socal.test/en-US",
          "x-default": "https://www.socal.test/zh-Hans",
        },
      },
      robots: { index: true, follow: true },
      openGraph: { type: "website", locale: "en_US" },
      twitter: { card: "summary" },
    });
    expect(homepageSeoMetadata("en-US", true)).toMatchObject({
      alternates: { canonical: "https://www.socal.test/en-US" },
      robots: { index: false, follow: true },
    });
    expect(homepageSeoMetadata("en-US", true).alternates).not.toHaveProperty("languages");

    const vertical = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({ locale: "en-US" }),
      searchParams: Promise.resolve({}),
    });
    expect(vertical).toMatchObject({
      title: { absolute: "Rentals | SoCal Life" },
      alternates: {
        canonical: "https://www.socal.test/en-US/rentals",
        languages: {
          "zh-Hans": "https://www.socal.test/zh-Hans/rentals",
          "en-US": "https://www.socal.test/en-US/rentals",
        },
      },
      robots: { index: true, follow: true },
    });
  });

  it("canonicalizes but does not index search, arbitrary filters, or unapproved city pages", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubGlobal("fetch", routeFetch());

    const filtered = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({ locale: "en-US" }),
      searchParams: Promise.resolve({ unknown: "value" }),
    });
    expect(filtered).toMatchObject({
      alternates: { canonical: "https://www.socal.test/en-US/rentals" },
      robots: { index: false, follow: true },
    });
    expect(filtered.alternates).not.toHaveProperty("languages");

    vi.stubEnv("SEO_INDEXABLE_CITY_ROUTES", "");
    const unapprovedCity = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({ locale: "en-US", listingPath: ["synthetic-city"] }),
      searchParams: Promise.resolve({}),
    });
    expect(unapprovedCity).toMatchObject({
      title: { absolute: "Synthetic City Rentals | SoCal Life" },
      alternates: { canonical: "https://www.socal.test/en-US/rentals/synthetic-city" },
      robots: { index: false, follow: true },
    });
    expect(unapprovedCity.alternates).not.toHaveProperty("languages");

    vi.stubEnv("SEO_INDEXABLE_CITY_ROUTES", "rentals:synthetic-city");
    const approvedCity = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({ locale: "en-US", listingPath: ["synthetic-city"] }),
      searchParams: Promise.resolve({}),
    });
    expect(approvedCity).toMatchObject({
      alternates: {
        canonical: "https://www.socal.test/en-US/rentals/synthetic-city",
        languages: {
          "zh-Hans": "https://www.socal.test/zh-Hans/rentals/synthetic-city",
          "en-US": "https://www.socal.test/en-US/rentals/synthetic-city",
        },
      },
      robots: { index: true, follow: true },
    });

    const search = await publicSearchMetadata({
      params: Promise.resolve({ locale: "zh-Hans" }),
      searchParams: Promise.resolve({ q: "租房" }),
    });
    expect(search).toMatchObject({
      alternates: { canonical: "https://www.socal.test/zh-Hans/search" },
      robots: { index: false, follow: true },
    });
  });

  it("uses only sanitized public Listing fields for canonical article metadata", async () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    vi.stubGlobal("fetch", routeFetch());

    const metadata = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({
        locale: "en-US",
        listingPath: ["wrong-city", `old-title-${listingId}`],
      }),
      searchParams: Promise.resolve({}),
    });
    expect(metadata).toMatchObject({
      title: { absolute: "Synthetic detail alert(1) | SoCal Life" },
      description: searchListing.summary,
      alternates: {
        canonical: `https://www.socal.test/en-US/rentals/synthetic-city/synthetic-rental-${listingId}`,
        languages: {
          "zh-Hans": `https://www.socal.test/zh-Hans/rentals/synthetic-city/synthetic-rental-${listingId}`,
          "en-US": `https://www.socal.test/en-US/rentals/synthetic-city/synthetic-rental-${listingId}`,
        },
      },
      robots: { index: true, follow: true },
      openGraph: {
        type: "article",
        publishedTime: publicListing.publishedAt,
        modifiedTime: publicListing.updatedAt,
        expirationTime: publicListing.expiresAt,
      },
    });
    expect(JSON.stringify(metadata)).not.toContain(publicListing.body);
    expect(JSON.stringify(metadata)).not.toContain("<script>");

    const duplicate = await publicVerticalMetadata("RENTAL", {
      params: Promise.resolve({
        locale: "en-US",
        listingPath: ["synthetic-city", `synthetic-rental-${listingId}`],
      }),
      searchParams: Promise.resolve({ tracking: "untrusted" }),
    });
    expect(duplicate).toMatchObject({
      robots: { index: false, follow: true },
      alternates: {
        canonical: `https://www.socal.test/en-US/rentals/synthetic-city/synthetic-rental-${listingId}`,
      },
    });
    expect(duplicate.alternates).not.toHaveProperty("languages");
  });

  it("fails placeholder templates and private crawler paths closed", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "https://www.socal.test");
    expect(
      privatePageMetadata("en-US", "Sign In", "/en-US/login", "Private authentication boundary."),
    ).toMatchObject({
      alternates: { canonical: "https://www.socal.test/en-US/login" },
      robots: { index: false, follow: false },
    });
    expect(webRobots()).toEqual({
      rules: expect.objectContaining({
        userAgent: "*",
        allow: "/",
        disallow: expect.arrayContaining(["/v1/", "/health/", "/zh-Hans/account", "/en-US/post"]),
      }),
      host: "https://www.socal.test",
    });
    expect(webRobots()).not.toHaveProperty("sitemap");
  });
});

describe("public listing SSR boundary", () => {
  it("normalizes bounded filters and rejects duplicate or contradictory input before fetch", async () => {
    expect(
      parsePublicListingFilters(
        {
          q: "  Irvine apartment  ",
          minPrice: "1000",
          maxPrice: "3000.00",
          sort: "PRICE_ASC",
        },
        "RENTAL",
      ),
    ).toMatchObject({
      kind: "ok",
      values: {
        q: "Irvine apartment",
        type: "RENTAL",
        minPrice: "1000",
        maxPrice: "3000.00",
        sort: "PRICE_ASC",
      },
    });
    expect(parsePublicListingFilters({ q: ["first", "second"] }, "RENTAL")).toMatchObject({
      kind: "invalid",
      reason: "duplicate",
    });
    expect(
      parsePublicListingFilters({ minPrice: "3000", maxPrice: "1000" }, "RENTAL"),
    ).toMatchObject({ kind: "invalid", reason: "validation" });

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      loadPublicListingIndex({
        locale: "en-US",
        params: { q: ["first", "second"] },
        type: "RENTAL",
      }),
    ).resolves.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads strict anonymous search data without forwarding cookies", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const model = await loadPublicListingIndex({
      locale: "en-US",
      params: { q: "synthetic", regionCode: searchListing.region.code },
      type: "RENTAL",
    });

    expect(model).toMatchObject({
      kind: "ready",
      degraded: false,
      items: [
        {
          id: listingId,
          sponsored: true,
          verified: true,
          ownerName: "Synthetic Publisher",
        },
      ],
      nextCursor: "signed-search-cursor",
    });
    const searchCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/search?"));
    expect(String(searchCall?.[0])).toContain("type=RENTAL");
    expect(String(searchCall?.[0])).toContain("q=synthetic");
  });

  it("falls back only to the strict canonical first page for simple search outages", async () => {
    const fetchMock = routeFetch({ searchStatus: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadPublicListingIndex({
        locale: "zh-Hans",
        params: {},
        type: "RENTAL",
      }),
    ).resolves.toMatchObject({
      kind: "ready",
      degraded: true,
      nextCursor: null,
      items: [{ id: listingId, sponsored: true }],
    });

    await expect(
      loadPublicListingIndex({
        locale: "zh-Hans",
        params: { q: "complex query" },
        type: "RENTAL",
      }),
    ).resolves.toMatchObject({ kind: "unavailable" });
  });

  it("fails closed when a detail response contains owner-only fields", async () => {
    vi.stubGlobal("fetch", routeFetch());
    await expect(loadPublicListingDetail("en-US", listingId)).resolves.toMatchObject({
      kind: "ready",
      listing: { status: "PUBLISHED" },
    });

    vi.stubGlobal(
      "fetch",
      routeFetch({
        detail: {
          data: {
            ...publicListing,
            ownerId: publicListing.owner.id,
            contactMode: "PHONE_REVEAL",
          },
        },
      }),
    );
    await expect(loadPublicListingDetail("en-US", listingId)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(loadPublicListingDetail("en-US", "not-a-uuid")).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("builds stable vertical routes, cursor links, localized money, and bounded attributes", () => {
    expect(listingIdFromSlug(`synthetic-rental-${listingId}`)).toBe(listingId);
    expect(listingIdFromSlug(`wrong-${listingId.replace("-4", "-7")}`)).toBeNull();
    expect(publicListingPath("en-US", publicListing)).toBe(
      `/en-US/rentals/synthetic-city/synthetic-rental-${listingId}`,
    );
    expect(formatListingPrice("en-US", searchListing.price)).toBe("$2,450.00/month");
    expect(
      nextPagePath(
        "/en-US/rentals",
        {
          q: "irvine",
          type: "RENTAL",
          categoryId: "",
          regionCode: "",
          minPrice: "",
          maxPrice: "",
          sort: "NEWEST",
        },
        "signed cursor",
      ),
    ).toContain("cursor=signed+cursor");
    expect(
      publicAttributeEntries("en-US", {
        bedrooms: 2,
        furnished: false,
        nested: { private: true },
        unsafe_key_with_a_value_that_is_still_bounded: "shown as plain text",
      }),
    ).toEqual(
      expect.arrayContaining([
        { label: "Bedrooms", value: "2" },
        { label: "Furnished", value: "No" },
      ]),
    );
  });
});

describe("public listing views", () => {
  const readyModel: Extract<PublicListingIndexModel, { kind: "ready" }> = {
    kind: "ready",
    filters: {
      q: "",
      type: "RENTAL",
      categoryId: "",
      regionCode: "",
      minPrice: "",
      maxPrice: "",
      sort: "RELEVANCE",
    },
    items: [
      {
        id: searchListing.id,
        type: searchListing.type,
        title: searchListing.title,
        slug: searchListing.slug,
        summary: searchListing.summary,
        price: searchListing.price,
        region: searchListing.region,
        category: {
          id: searchListing.category.id,
          nameZhHans: searchListing.category.nameZhHans,
          nameEn: searchListing.category.nameEn,
        },
        ownerName: searchListing.owner.displayName,
        verified: true,
        precision: "CITY",
        sponsored: true,
        publishedAt: searchListing.publishedAt,
        expiresAt: searchListing.expiresAt,
        updatedAt: searchListing.updatedAt,
      },
    ],
    categoryOptions: [
      { value: searchListing.category.id, label: searchListing.category.nameEn, count: 1 },
    ],
    regionOptions: [
      { value: searchListing.region.code, label: searchListing.region.nameEn, count: 1 },
    ],
    typeOptions: [{ value: "RENTAL", label: "Rentals", count: 1 }],
    nextCursor: "signed-search-cursor",
    correctedQuery: null,
    degraded: false,
    taxonomyDegraded: false,
  };

  it("renders English mobile-safe controls plus visible and semantic status labels", () => {
    render(
      <PublicListingIndexView
        action="/en-US/rentals"
        locale="en-US"
        model={readyModel}
        pathname="/en-US/rentals"
        type="RENTAL"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Rentals" })).toBeVisible();
    expect(screen.getByRole("search", { name: "Filters" })).toBeVisible();
    expect(screen.getByLabelText("Keywords")).toBeVisible();
    expect(screen.getByText("Sponsored")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Verified organization")).toBeVisible();
    expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute("rel", "nofollow");
  });

  it("renders an honest bilingual empty state without fabricated cards", () => {
    render(
      <PublicListingIndexView
        action="/zh-Hans/rentals"
        locale="zh-Hans"
        model={{ ...readyModel, items: [], nextCursor: null }}
        pathname="/zh-Hans/rentals"
        type="RENTAL"
      />,
    );

    const state = screen.getByRole("status");
    expect(within(state).getByRole("heading", { name: "暂时没有匹配的信息" })).toBeVisible();
    expect(within(state).getByText(/不会用模拟内容/)).toBeVisible();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("escapes user-authored title and body while showing public trust context", () => {
    const { container } = render(
      <PublicListingDetailView
        locale="en-US"
        listing={publicListing}
        pathname={publicListingPath("en-US", publicListing)}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Synthetic detail <script>alert(1)</script>",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Escaped body <script>window.bad = true<\/script>/)).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("heading", { name: "Safety reminder" })).toBeVisible();
    expect(screen.getByText("Sponsored")).toBeVisible();
    expect(screen.queryByText("shouldNotRender")).not.toBeInTheDocument();
  });
});
