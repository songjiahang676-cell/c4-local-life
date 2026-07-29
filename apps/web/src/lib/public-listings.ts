import {
  categoryCollectionResponseSchema,
  listingCollectionSchema,
  listingSearchSchema,
  publicListingResponseSchema,
  regionCollectionResponseSchema,
  searchResponseSchema,
  type Category,
  type ListingSearchInput,
  type ListingType,
  type Locale,
  type Money,
  type PublicListingSummaryView,
  type PublicListingView,
  type Region,
  type SearchListingResult,
  type SearchResponse,
} from "@socal/contracts";

export const PUBLIC_VERTICALS = {
  jobs: "JOB",
  rentals: "RENTAL",
  transfers: "TRANSFER",
  marketplace: "SECONDHAND",
  services: "SERVICE",
} as const satisfies Readonly<Record<string, ListingType>>;

export type PublicVertical = keyof typeof PUBLIC_VERTICALS;
export type PublicSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export type PublicListingCard = Readonly<{
  id: string;
  type: ListingType;
  title: string;
  slug: string;
  summary: string | null;
  price: Money | null;
  region: Readonly<{
    code: string;
    slug: string;
    nameZhHans: string;
    nameEn: string;
  }>;
  category: Readonly<{
    id: string;
    nameZhHans: string;
    nameEn: string;
  }>;
  ownerName: string;
  verified: boolean;
  precision: "CITY" | "NEIGHBORHOOD" | "APPROXIMATE" | "EXACT";
  sponsored: boolean;
  publishedAt: string;
  expiresAt: string;
  updatedAt: string;
}>;

export type PublicFilterOption = Readonly<{
  value: string;
  label: string;
  count?: number;
}>;

export type PublicListingFilters = Readonly<{
  q: string;
  type: ListingType | "";
  categoryId: string;
  regionCode: string;
  minPrice: string;
  maxPrice: string;
  sort: "RELEVANCE" | "NEWEST" | "PRICE_ASC" | "PRICE_DESC";
}>;

export type PublicListingIndexModel =
  | Readonly<{
      kind: "ready";
      filters: PublicListingFilters;
      items: readonly PublicListingCard[];
      categoryOptions: readonly PublicFilterOption[];
      regionOptions: readonly PublicFilterOption[];
      typeOptions: readonly PublicFilterOption[];
      nextCursor: string | null;
      correctedQuery: string | null;
      degraded: boolean;
      taxonomyDegraded: boolean;
    }>
  | Readonly<{
      kind: "invalid";
      filters: PublicListingFilters;
      reason: string;
    }>
  | Readonly<{
      kind: "cursor-expired";
      filters: PublicListingFilters;
    }>
  | Readonly<{
      kind: "unavailable";
      filters: PublicListingFilters;
    }>
  | Readonly<{
      kind: "not-found";
      filters: PublicListingFilters;
    }>;

export type PublicListingDetailModel =
  | Readonly<{ kind: "ready"; listing: PublicListingView }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "unavailable" }>;

type RuntimeSchema<T> = Readonly<{
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}>;

type ApiResult<T> =
  | Readonly<{ kind: "ok"; data: T }>
  | Readonly<{ kind: "http"; status: number }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "unavailable" }>;

type LoadedTaxonomy = Readonly<{
  categories: readonly Category[];
  regions: readonly Region[];
  degraded: boolean;
}>;

type ParsedFilters =
  | Readonly<{
      kind: "ok";
      query: ListingSearchInput;
      values: PublicListingFilters;
    }>
  | Readonly<{
      kind: "invalid";
      values: PublicListingFilters;
      reason: string;
    }>;

const responseLimit = 1_000_000;
const publicRequestTimeoutMilliseconds = 5_000;
const uuidSuffix = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const supportedSorts = new Set(["RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC"]);

function apiBaseUrl(): URL | null {
  try {
    const url = new URL(process.env.API_BASE_URL ?? "http://127.0.0.1:4000/v1");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function requestPublicJson<T>(
  path: string,
  query: Readonly<Record<string, string | number | undefined>>,
  schema: RuntimeSchema<T>,
  locale: Locale,
): Promise<ApiResult<T>> {
  const base = apiBaseUrl();
  if (!base || path.startsWith("/") || path.includes("..")) return { kind: "unavailable" };
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "accept-language": locale,
        // The SSR request is not an end-user source and must never inflate search trends.
        "user-agent": "SoCalLifeWebSSRBot/0.1",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(publicRequestTimeoutMilliseconds),
    });
    if (!response.ok) return { kind: "http", status: response.status };
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > responseLimit) {
      return { kind: "invalid" };
    }
    const body = await response.text();
    if (body.length > responseLimit) return { kind: "invalid" };
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return { kind: "invalid" };
    }
    const parsed = schema.safeParse(value);
    return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "invalid" };
  } catch {
    return { kind: "unavailable" };
  }
}

function singleValue(
  params: PublicSearchParams,
  key: string,
): { valid: true; value: string | undefined } | { valid: false } {
  const value = params[key];
  if (value === undefined || typeof value === "string") return { valid: true, value };
  return { valid: false };
}

function filterValues(
  params: PublicSearchParams,
  fixedType?: ListingType,
  forcedRegionCode?: string,
): PublicListingFilters {
  const value = (key: string): string => {
    const candidate = singleValue(params, key);
    return candidate.valid ? (candidate.value ?? "").trim() : "";
  };
  const rawType = value("type");
  const rawSort = value("sort");
  return {
    q: value("q"),
    type: fixedType ?? PUBLIC_VERTICALS[rawType as PublicVertical] ?? (rawType as ListingType | ""),
    categoryId: value("categoryId"),
    regionCode: forcedRegionCode ?? value("regionCode"),
    minPrice: value("minPrice"),
    maxPrice: value("maxPrice"),
    sort: supportedSorts.has(rawSort) ? (rawSort as PublicListingFilters["sort"]) : "RELEVANCE",
  };
}

export function parsePublicListingFilters(
  params: PublicSearchParams,
  fixedType?: ListingType,
  forcedRegionCode?: string,
): ParsedFilters {
  const values = filterValues(params, fixedType, forcedRegionCode);
  for (const key of [
    "q",
    "type",
    "categoryId",
    "regionCode",
    "minPrice",
    "maxPrice",
    "sort",
    "cursor",
  ]) {
    if (!singleValue(params, key).valid) {
      return { kind: "invalid", values, reason: "duplicate" };
    }
  }

  const cursor = singleValue(params, "cursor");
  const candidate = {
    ...(values.q ? { q: values.q } : {}),
    ...(values.type ? { type: values.type } : {}),
    ...(values.categoryId ? { categoryId: values.categoryId } : {}),
    ...(values.regionCode ? { regionCode: values.regionCode } : {}),
    ...(values.minPrice ? { minPrice: values.minPrice } : {}),
    ...(values.maxPrice ? { maxPrice: values.maxPrice } : {}),
    sort: values.sort,
    ...(cursor.valid && cursor.value?.trim() ? { cursor: cursor.value.trim() } : {}),
    limit: 20,
  };
  const parsed = listingSearchSchema.safeParse(candidate);
  return parsed.success
    ? { kind: "ok", query: parsed.data, values }
    : { kind: "invalid", values, reason: "validation" };
}

function flattenTaxonomy<T extends { readonly children: readonly T[] }>(
  roots: readonly T[],
): readonly T[] {
  const output: T[] = [];
  const pending = [...roots];
  while (pending.length > 0 && output.length < 2_000) {
    const current = pending.shift();
    if (!current) break;
    output.push(current);
    pending.push(...current.children);
  }
  return output;
}

async function loadTaxonomy(locale: Locale, type?: ListingType): Promise<LoadedTaxonomy> {
  const [categories, regions] = await Promise.all([
    requestPublicJson(
      "categories",
      { ...(type ? { vertical: type } : {}), activeOnly: "true" },
      categoryCollectionResponseSchema,
      locale,
    ),
    requestPublicJson(
      "regions",
      { type: "CITY", activeOnly: "true" },
      regionCollectionResponseSchema,
      locale,
    ),
  ]);
  return {
    categories:
      categories.kind === "ok"
        ? flattenTaxonomy(categories.data.data).filter(
            (category) => category.active && (!type || category.vertical === type),
          )
        : [],
    regions:
      regions.kind === "ok"
        ? flattenTaxonomy(regions.data.data).filter(
            (region) => region.active && region.type === "CITY",
          )
        : [],
    degraded: categories.kind !== "ok" || regions.kind !== "ok",
  };
}

function publicListingCard(
  listing: SearchListingResult | PublicListingSummaryView,
): PublicListingCard {
  const searchResult = "sponsored" in listing;
  return {
    id: listing.id,
    type: listing.type,
    title: listing.title,
    slug: listing.slug,
    summary: listing.summary,
    price: listing.price,
    region: {
      code: listing.region.code,
      slug: listing.region.slug,
      nameZhHans: listing.region.nameZhHans,
      nameEn: listing.region.nameEn,
    },
    category: {
      id: listing.category.id,
      nameZhHans: listing.category.nameZhHans,
      nameEn: listing.category.nameEn,
    },
    ownerName: listing.owner.displayName,
    verified: listing.organization?.verificationStatus === "VERIFIED",
    precision: listing.location.precision,
    sponsored: searchResult ? listing.sponsored : listing.featured,
    publishedAt: listing.publishedAt,
    expiresAt: listing.expiresAt,
    updatedAt: listing.updatedAt,
  };
}

function searchQueryParameters(
  query: ListingSearchInput,
): Readonly<Record<string, string | number | undefined>> {
  return {
    q: query.q,
    type: query.type,
    categoryId: query.categoryId,
    regionCode: query.regionCode,
    latitude: query.latitude,
    longitude: query.longitude,
    radiusMiles: query.radiusMiles,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sort: query.sort ?? "RELEVANCE",
    cursor: query.cursor,
    limit: query.limit ?? 20,
  };
}

function canUseCanonicalFallback(query: ListingSearchInput): query is ListingSearchInput & {
  type: ListingType;
} {
  return Boolean(
    query.type &&
    !query.q &&
    !query.minPrice &&
    !query.maxPrice &&
    !query.cursor &&
    query.latitude === undefined &&
    query.longitude === undefined &&
    query.radiusMiles === undefined &&
    (query.sort === undefined || query.sort === "RELEVANCE" || query.sort === "NEWEST"),
  );
}

function typeOptions(locale: Locale, response?: SearchResponse): readonly PublicFilterOption[] {
  const counts = new Map(response?.facets.types.map((item) => [item.value, item.count]) ?? []);
  return Object.values(PUBLIC_VERTICALS).map((value) => ({
    value,
    label: verticalLabel(locale, value),
    ...(counts.has(value) ? { count: counts.get(value) } : {}),
  }));
}

function categoryOptions(
  locale: Locale,
  taxonomy: LoadedTaxonomy,
  response?: SearchResponse,
): readonly PublicFilterOption[] {
  const counts = new Map(response?.facets.categories.map((item) => [item.value, item.count]) ?? []);
  return taxonomy.categories.map((category) => ({
    value: category.id,
    label: category.name[locale],
    ...(counts.has(category.id) ? { count: counts.get(category.id) } : {}),
  }));
}

function regionOptions(
  locale: Locale,
  taxonomy: LoadedTaxonomy,
  response?: SearchResponse,
): readonly PublicFilterOption[] {
  const counts = new Map(response?.facets.regions.map((item) => [item.value, item.count]) ?? []);
  return taxonomy.regions.map((region) => ({
    value: region.code,
    label: region.name[locale],
    ...(counts.has(region.code) ? { count: counts.get(region.code) } : {}),
  }));
}

export async function loadPublicListingIndex(input: {
  locale: Locale;
  params: PublicSearchParams;
  type?: ListingType;
  citySlug?: string;
}): Promise<PublicListingIndexModel> {
  let taxonomy: LoadedTaxonomy;
  let filters: Extract<ParsedFilters, { kind: "ok" }>;
  let searched: ApiResult<SearchResponse>;

  if (input.citySlug) {
    taxonomy = await loadTaxonomy(input.locale, input.type);
    const city = taxonomy.regions.find((region) => region.slug === input.citySlug);
    const initialValues = filterValues(input.params, input.type, city?.code);
    if (!city) return { kind: "not-found", filters: initialValues };
    const parsed = parsePublicListingFilters(input.params, input.type, city.code);
    if (parsed.kind === "invalid") {
      return {
        kind: "invalid",
        filters: parsed.values,
        reason: parsed.reason,
      };
    }
    filters = parsed;
    searched = await requestPublicJson(
      "search",
      searchQueryParameters(filters.query),
      searchResponseSchema,
      input.locale,
    );
  } else {
    const parsed = parsePublicListingFilters(input.params, input.type);
    if (parsed.kind === "invalid") {
      return {
        kind: "invalid",
        filters: parsed.values,
        reason: parsed.reason,
      };
    }
    filters = parsed;
    [taxonomy, searched] = await Promise.all([
      loadTaxonomy(input.locale, input.type),
      requestPublicJson(
        "search",
        searchQueryParameters(filters.query),
        searchResponseSchema,
        input.locale,
      ),
    ]);
  }

  if (searched.kind === "ok") {
    return {
      kind: "ready",
      filters: filters.values,
      items: searched.data.data.map(publicListingCard),
      categoryOptions: categoryOptions(input.locale, taxonomy, searched.data),
      regionOptions: regionOptions(input.locale, taxonomy, searched.data),
      typeOptions: typeOptions(input.locale, searched.data),
      nextCursor: searched.data.page.nextCursor,
      correctedQuery: searched.data.correctedQuery,
      degraded: false,
      taxonomyDegraded: taxonomy.degraded,
    };
  }
  if (searched.kind === "http" && searched.status === 410) {
    return { kind: "cursor-expired", filters: filters.values };
  }
  if (searched.kind === "http" && searched.status === 400) {
    return { kind: "invalid", filters: filters.values, reason: "validation" };
  }

  if (canUseCanonicalFallback(filters.query)) {
    const fallback = await requestPublicJson(
      "listings",
      {
        type: filters.query.type,
        categoryId: filters.query.categoryId,
        regionCode: filters.query.regionCode,
        limit: filters.query.limit ?? 20,
      },
      listingCollectionSchema,
      input.locale,
    );
    if (fallback.kind === "ok") {
      return {
        kind: "ready",
        filters: filters.values,
        items: fallback.data.data.map(publicListingCard),
        categoryOptions: categoryOptions(input.locale, taxonomy),
        regionOptions: regionOptions(input.locale, taxonomy),
        typeOptions: typeOptions(input.locale),
        // Search and canonical-list cursors are intentionally not interchangeable.
        nextCursor: null,
        correctedQuery: null,
        degraded: true,
        taxonomyDegraded: taxonomy.degraded,
      };
    }
  }
  return { kind: "unavailable", filters: filters.values };
}

export async function loadPublicListingDetail(
  locale: Locale,
  listingId: string,
): Promise<PublicListingDetailModel> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)) {
    return { kind: "not-found" };
  }
  const response = await requestPublicJson(
    `listings/${listingId}`,
    {},
    publicListingResponseSchema,
    locale,
  );
  if (response.kind === "ok") return { kind: "ready", listing: response.data.data };
  if (response.kind === "http" && response.status === 404) return { kind: "not-found" };
  return { kind: "unavailable" };
}

export function listingIdFromSlug(value: string): string | null {
  return uuidSuffix.exec(value)?.[1]?.toLowerCase() ?? null;
}

export function verticalFromSlug(value: string): ListingType | null {
  return PUBLIC_VERTICALS[value as PublicVertical] ?? null;
}

export function verticalSlug(type: ListingType): PublicVertical {
  const entry = Object.entries(PUBLIC_VERTICALS).find(([, candidate]) => candidate === type);
  if (!entry) throw new Error("Unsupported public Listing vertical");
  return entry[0] as PublicVertical;
}

export function publicListingPath(
  locale: Locale,
  listing: Pick<PublicListingCard, "id" | "type" | "slug" | "region"> | PublicListingView,
): string {
  return `/${locale}/${verticalSlug(listing.type)}/${encodeURIComponent(
    listing.region.slug,
  )}/${encodeURIComponent(listing.slug)}-${listing.id}`;
}

export function publicVerticalPath(locale: Locale, type: ListingType): string {
  return `/${locale}/${verticalSlug(type)}`;
}

export function publicSearchPath(locale: Locale): string {
  return `/${locale}/search`;
}

export function nextPagePath(
  pathname: string,
  filters: PublicListingFilters,
  cursor: string,
): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.type) query.set("type", filters.type);
  if (filters.categoryId) query.set("categoryId", filters.categoryId);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  if (filters.minPrice) query.set("minPrice", filters.minPrice);
  if (filters.maxPrice) query.set("maxPrice", filters.maxPrice);
  if (filters.sort !== "RELEVANCE") query.set("sort", filters.sort);
  query.set("cursor", cursor);
  return `${pathname}?${query.toString()}`;
}

export function verticalLabel(locale: Locale, type: ListingType): string {
  const labels: Readonly<Record<ListingType, Readonly<Record<Locale, string>>>> = {
    JOB: { "zh-Hans": "招聘", "en-US": "Jobs" },
    RENTAL: { "zh-Hans": "租房", "en-US": "Rentals" },
    TRANSFER: { "zh-Hans": "生意转让", "en-US": "Transfers" },
    SECONDHAND: { "zh-Hans": "二手物品", "en-US": "Marketplace" },
    SERVICE: { "zh-Hans": "本地服务", "en-US": "Services" },
  };
  return labels[type][locale];
}

export function formatListingPrice(locale: Locale, price: Money | null): string {
  if (!price) return locale === "zh-Hans" ? "价格未提供" : "Price not provided";
  if (price.unit === "FREE") return locale === "zh-Hans" ? "免费" : "Free";
  if (price.unit === "NEGOTIABLE") return locale === "zh-Hans" ? "面议" : "Negotiable";
  if (!price.amount) return locale === "zh-Hans" ? "价格未提供" : "Price not provided";
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: 2,
  }).format(Number(price.amount));
  const units: Readonly<Record<Exclude<Money["unit"], "FREE" | "NEGOTIABLE">, [string, string]>> = {
    FIXED: ["", ""],
    HOURLY: ["/小时", "/hour"],
    DAILY: ["/天", "/day"],
    WEEKLY: ["/周", "/week"],
    MONTHLY: ["/月", "/month"],
    YEARLY: ["/年", "/year"],
    SQFT: ["/平方英尺", "/sq ft"],
  };
  return `${amount}${units[price.unit][locale === "zh-Hans" ? 0 : 1]}`;
}

export function formatListingDate(locale: Locale, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

export function publicAttributeEntries(
  locale: Locale,
  attributes: Readonly<Record<string, unknown>>,
): readonly Readonly<{ label: string; value: string }>[] {
  const known: Readonly<Record<string, readonly [string, string]>> = {
    bedrooms: ["卧室", "Bedrooms"],
    bathrooms: ["浴室", "Bathrooms"],
    furnished: ["家具", "Furnished"],
    condition: ["成色", "Condition"],
    employmentType: ["雇佣类型", "Employment type"],
    experienceYears: ["经验年限", "Experience"],
    serviceRadiusMiles: ["服务范围", "Service radius"],
  };
  const entries: Array<Readonly<{ label: string; value: string }>> = [];
  for (const [key, raw] of Object.entries(attributes)) {
    if (entries.length >= 20 || !/^[a-z][a-zA-Z0-9_]{0,79}$/.test(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (
      values.length === 0 ||
      values.length > 20 ||
      values.some(
        (value) =>
          (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
          (typeof value === "string" && value.length > 200),
      )
    ) {
      continue;
    }
    const label =
      known[key]?.[locale === "zh-Hans" ? 0 : 1] ??
      key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
    entries.push({
      label,
      value: values
        .map((value) => {
          if (typeof value === "boolean") {
            return value
              ? locale === "zh-Hans"
                ? "是"
                : "Yes"
              : locale === "zh-Hans"
                ? "否"
                : "No";
          }
          return String(value);
        })
        .join(", "),
    });
  }
  return entries;
}
