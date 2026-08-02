import { createServer } from "node:http";

const port = Number(process.env.PORT ?? process.argv[2] ?? "4200");
const host = process.env.HOSTNAME ?? "127.0.0.1";
const listingId = "91000000-0000-4000-8000-000000000001";
const categoryId = "92000000-0000-4000-8000-000000000001";
const regionId = "93000000-0000-4000-8000-000000000001";
const ownerId = "94000000-0000-4000-8000-000000000001";
const organizationId = "95000000-0000-4000-8000-000000000001";
const publishedAt = "2026-07-29T12:00:00.000Z";
const expiresAt = "2026-08-29T12:00:00.000Z";

const region = {
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
};

function category(type) {
  const names = {
    JOB: ["测试招聘", "Synthetic jobs"],
    RENTAL: ["测试租房", "Synthetic rentals"],
    TRANSFER: ["测试转让", "Synthetic transfers"],
    SECONDHAND: ["测试二手", "Synthetic marketplace"],
    SERVICE: ["测试服务", "Synthetic services"],
  };
  const [zhHans, enUs] = names[type] ?? names.RENTAL;
  return {
    id: categoryId,
    parentId: null,
    vertical: type,
    slug: `synthetic-${type.toLowerCase()}`,
    name: { "zh-Hans": zhHans, "en-US": enUs },
    iconKey: null,
    formSchemaVersion: 1,
    active: true,
    aliases: [],
    children: [],
  };
}

function searchResult(type) {
  const listingCategory = category(type);
  return {
    id: listingId,
    type,
    status: "PUBLISHED",
    locale: "en-US",
    slug: "synthetic-public-listing",
    title: "Synthetic public listing",
    summary: "Fictional E2E content proving the anonymous SSR boundary.",
    price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
    region: {
      id: region.id,
      code: region.code,
      slug: region.slug,
      nameZhHans: region.name["zh-Hans"],
      nameEn: region.name["en-US"],
    },
    category: {
      id: listingCategory.id,
      vertical: type,
      slug: listingCategory.slug,
      nameZhHans: listingCategory.name["zh-Hans"],
      nameEn: listingCategory.name["en-US"],
    },
    owner: { id: ownerId, displayName: "Synthetic Public Publisher", avatarUrl: null },
    organization: {
      id: organizationId,
      slug: "synthetic-verified-organization",
      verificationStatus: "VERIFIED",
    },
    location: { precision: "CITY", point: null },
    attributes: { bedrooms: 2, furnished: false },
    sponsored: true,
    distanceMiles: null,
    publishedAt,
    expiresAt,
    updatedAt: publishedAt,
    version: 1,
  };
}

function publicDetail(type = "RENTAL") {
  const result = searchResult(type);
  const { sponsored: featured, distanceMiles: _distanceMiles, ...base } = result;
  void _distanceMiles;
  return {
    ...base,
    body: "This fictional description is rendered on the server and contains no real user data.",
    region: {
      ...base.region,
      type: "CITY",
      timezone: "America/Los_Angeles",
    },
    organization: {
      ...base.organization,
      displayName: "Synthetic Verified Organization",
    },
    location: { precision: "CITY" },
    featured,
    featuredUntil: "2026-08-01T12:00:00.000Z",
    createdAt: "2026-07-29T11:00:00.000Z",
  };
}

function homepage(locale) {
  const detail = publicDetail("RENTAL");
  const { body: _body, createdAt: _createdAt, ...summary } = detail;
  void _body;
  void _createdAt;
  const localized =
    locale === "zh-Hans"
      ? {
          title: "南加州华人生活，一站式本地服务",
          subtitle: "连接真实的招聘、租房、转让、二手与本地服务信息。",
          searchPlaceholder: "搜索招聘、租房、转让、二手或本地服务",
          city: "测试城市",
          query: "测试租房",
        }
      : {
          title: "Southern California life, in one local place",
          subtitle: "Explore real local listings.",
          searchPlaceholder: "Search local listings",
          city: "Synthetic City",
          query: "Synthetic rentals",
        };
  return {
    layout: {
      version: 1,
      locale,
      regionCode: "US-CA-SOCAL",
      device: "desktop",
    },
    modules: [
      {
        key: "hero",
        kind: "HERO",
        dataVersion: "a".repeat(64),
        cache: { ttlSeconds: 300, tags: [`homepage.config.${locale}.US-CA-SOCAL.v1`] },
        data: {
          contentKey: "homepage.hero",
          title: localized.title,
          subtitle: localized.subtitle,
          searchPlaceholder: localized.searchPlaceholder,
        },
      },
      {
        key: "hot-searches",
        kind: "HOT_SEARCHES",
        dataVersion: "b".repeat(64),
        cache: { ttlSeconds: 120, tags: ["homepage.search-trends"] },
        data: {
          window: "DAY_7",
          items: [{ query: localized.query, rank: 1, locale }],
        },
      },
      {
        key: "cities",
        kind: "CITY_CHIPS",
        dataVersion: "c".repeat(64),
        cache: { ttlSeconds: 3600, tags: ["homepage.regions"] },
        data: {
          items: [
            {
              id: region.id,
              code: region.code,
              slug: region.slug,
              type: "CITY",
              name: localized.city,
            },
          ],
        },
      },
      {
        key: "rentals",
        kind: "LISTING_FEED",
        dataVersion: "d".repeat(64),
        cache: { ttlSeconds: 60, tags: ["homepage.listings.RENTAL"] },
        data: { listingType: "RENTAL", items: [summary] },
      },
    ],
    partial: false,
    generatedAt: publishedAt,
  };
}

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method !== "GET") {
    send(response, 405, { title: "Method Not Allowed", status: 405 });
    return;
  }
  if (url.pathname === "/health/ready") {
    send(response, 200, { status: "ready" });
    return;
  }
  if (url.pathname === "/v1/categories") {
    const type = url.searchParams.get("vertical") ?? "RENTAL";
    send(response, 200, { data: [category(type)] });
    return;
  }
  if (url.pathname === "/v1/regions") {
    send(response, 200, { data: [region] });
    return;
  }
  if (url.pathname === "/v1/auth/session") {
    send(response, 401, { title: "Unauthorized", status: 401 });
    return;
  }
  if (url.pathname === "/v1/search/suggestions") {
    const locale = url.searchParams.get("locale") === "en-US" ? "en-US" : "zh-Hans";
    const query = url.searchParams.get("q");
    const suggestions = [
      ...(query
        ? [
            {
              type: "QUERY",
              label: locale === "en-US" ? "Synthetic rentals" : "测试租房",
              value: locale === "en-US" ? "Synthetic rentals" : "测试租房",
              locale,
            },
          ]
        : []),
      {
        type: "CATEGORY",
        label: locale === "en-US" ? "Synthetic rentals" : "测试租房",
        value: "synthetic-rental",
        locale,
      },
      {
        type: "REGION",
        label: region.name[locale],
        value: region.code,
        locale,
      },
    ];
    send(response, 200, { data: suggestions, generatedAt: publishedAt });
    return;
  }
  if (url.pathname === "/v1/homepage") {
    const locale = url.searchParams.get("locale") === "en-US" ? "en-US" : "zh-Hans";
    send(response, 200, homepage(locale));
    return;
  }
  if (url.pathname === "/v1/search") {
    const type = url.searchParams.get("type") ?? "RENTAL";
    const result = searchResult(type);
    send(response, 200, {
      data: [result],
      page: { hasMore: false, nextCursor: null },
      facets: {
        types: [{ value: type, count: 1 }],
        categories: [{ value: categoryId, count: 1 }],
        regions: [{ value: region.code, count: 1 }],
        priceUnits: [{ value: "MONTHLY", count: 1 }],
      },
      correctedQuery: null,
      tookMs: 4,
      generatedAt: publishedAt,
    });
    return;
  }
  if (url.pathname === `/v1/listings/${listingId}`) {
    send(response, 200, { data: publicDetail() });
    return;
  }
  if (url.pathname === "/v1/listings") {
    const detail = publicDetail(url.searchParams.get("type") ?? "RENTAL");
    const { body: _body, createdAt: _createdAt, ...summary } = detail;
    void _body;
    void _createdAt;
    send(response, 200, {
      data: [summary],
      page: { hasMore: false, nextCursor: null },
      generatedAt: publishedAt,
    });
    return;
  }
  send(response, 404, {
    title: "Not Found",
    status: 404,
    detail: "The requested resource was not found.",
  });
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
