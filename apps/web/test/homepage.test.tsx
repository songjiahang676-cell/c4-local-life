import type { HomepageResponse } from "@socal/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "../src/components/home-page";
import { loadHomepage } from "../src/lib/homepage";

const hash = "b".repeat(64);
const response: HomepageResponse = {
  layout: {
    version: 2,
    locale: "en-US",
    regionCode: "US-CA-SOCAL",
    device: "desktop",
  },
  modules: [
    {
      key: "hero",
      kind: "HERO",
      dataVersion: hash,
      cache: { ttlSeconds: 300, tags: ["homepage.config.en-US.US-CA-SOCAL.v2"] },
      data: {
        contentKey: "homepage.hero",
        title: "Southern California life, in one local place",
        subtitle: "Real local information",
        searchPlaceholder: "Search local listings",
      },
    },
    {
      key: "cities",
      kind: "CITY_CHIPS",
      dataVersion: hash,
      cache: { ttlSeconds: 3600, tags: ["homepage.regions"] },
      data: {
        items: [
          {
            id: "81000000-0000-4000-8000-000000000001",
            code: "US-CA-IRVINE",
            slug: "irvine",
            type: "CITY",
            name: "Irvine",
          },
        ],
      },
    },
    {
      key: "jobs",
      kind: "LISTING_FEED",
      dataVersion: hash,
      cache: { ttlSeconds: 60, tags: ["homepage.listings.JOB"] },
      data: {
        listingType: "JOB",
        items: [
          {
            id: "82000000-0000-4000-8000-000000000001",
            type: "JOB",
            status: "PUBLISHED",
            locale: "en-US",
            title: "Synthetic public job",
            slug: "synthetic-public-job",
            summary: "A fictional test fixture, not production data.",
            price: { amount: "24.00", currency: "USD", unit: "HOURLY" },
            region: {
              id: "81000000-0000-4000-8000-000000000001",
              type: "CITY",
              code: "US-CA-IRVINE",
              slug: "irvine",
              nameZhHans: "尔湾",
              nameEn: "Irvine",
              timezone: "America/Los_Angeles",
            },
            category: {
              id: "83000000-0000-4000-8000-000000000001",
              vertical: "JOB",
              slug: "jobs",
              nameZhHans: "招聘",
              nameEn: "Jobs",
            },
            owner: {
              id: "84000000-0000-4000-8000-000000000001",
              displayName: "Synthetic Publisher",
              avatarUrl: null,
            },
            organization: null,
            location: { precision: "CITY" },
            attributes: {},
            featured: false,
            featuredUntil: null,
            publishedAt: "2026-07-28T12:00:00.000Z",
            expiresAt: "2026-08-28T12:00:00.000Z",
            updatedAt: "2026-07-28T12:00:00.000Z",
            version: 1,
          },
        ],
      },
    },
  ],
  partial: false,
  generatedAt: "2026-07-29T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("real-data homepage", () => {
  it("renders bilingual API modules and actual posting routes without legacy fake claims", () => {
    const html = renderToStaticMarkup(
      <HomePage locale="en-US" model={{ kind: "ready", response }} />,
    );
    expect(html).toContain("Southern California life, in one local place");
    expect(html).toContain("Synthetic public job");
    expect(html).toContain("Irvine");
    expect(html).toContain("/en-US/post/job/new");
    expect(html).toContain("/en-US/post/service/new");
    expect(html).toContain("中文 / English");
    expect(html).not.toContain("256,893");
    expect(html).not.toContain("鼎泰丰");
    expect(html).not.toContain("5.0");
    expect(html).not.toContain("首页广告位合作");
  });

  it("renders an honest localized recovery state when the aggregate is unavailable", () => {
    const html = renderToStaticMarkup(
      <HomePage locale="zh-Hans" model={{ kind: "unavailable" }} />,
    );
    expect(html).toContain("首页内容暂时不可用");
    expect(html).toContain("发布招聘");
    expect(html).not.toContain("测试公开招聘");
  });

  it("loads and validates the bounded aggregate without forwarding cookies", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.example.invalid/v1");
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadHomepage("en-US")).resolves.toEqual({ kind: "ready", response });
    const [requestedUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestedUrl)).toBe(
      "http://api.example.invalid/v1/homepage?locale=en-US&regionCode=US-CA-SOCAL&device=desktop",
    );
    expect(requestInit).toEqual(
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: expect.not.objectContaining({ cookie: expect.anything() }),
      }),
    );
  });

  it("fails closed on an invalid or oversized response", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.example.invalid/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response('{"layout":{"version":2}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    await expect(loadHomepage("en-US")).resolves.toEqual({ kind: "unavailable" });
  });
});
