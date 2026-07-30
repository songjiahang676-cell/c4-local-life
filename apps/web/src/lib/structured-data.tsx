import type { ListingType, Locale, PublicListingView } from "@socal/contracts";
import { absolutePublicUrl, publicWebOrigin, sanitizeMetadataText } from "./seo";

type WebSiteStructuredData = Readonly<{
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  alternateName: string;
  url: string;
  inLanguage: Locale;
  potentialAction: Readonly<{
    "@type": "SearchAction";
    target: string;
    "query-input": "required name=search_term_string";
  }>;
}>;

type BreadcrumbStructuredData = Readonly<{
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: readonly Readonly<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>[];
}>;

type JobPostingStructuredData = Readonly<{
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  description: string;
  identifier: Readonly<{
    "@type": "PropertyValue";
    name: string;
    value: string;
  }>;
  datePosted: string;
  validThrough: string;
  employmentType: string;
  hiringOrganization: Readonly<{
    "@type": "Organization";
    name: string;
  }>;
  jobLocation: Readonly<{
    "@type": "Place";
    address: Readonly<{
      "@type": "PostalAddress";
      addressLocality: string;
      addressRegion: "CA";
      addressCountry: "US";
    }>;
  }>;
  url: string;
  inLanguage: Locale;
}>;

export type StructuredDataNode =
  WebSiteStructuredData | BreadcrumbStructuredData | JobPostingStructuredData;

type BreadcrumbInput = Readonly<{
  name: string;
  path: string;
}>;

const employmentTypeValues: Readonly<Record<string, string>> = {
  "full-time": "FULL_TIME",
  full_time: "FULL_TIME",
  "part-time": "PART_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  contractor: "CONTRACTOR",
  temporary: "TEMPORARY",
  intern: "INTERN",
  internship: "INTERN",
  volunteer: "VOLUNTEER",
  per_diem: "PER_DIEM",
  "per-diem": "PER_DIEM",
  other: "OTHER",
};

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximum
  );
}

function sameOriginPublicUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === publicWebOrigin().origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function validWebSite(value: WebSiteStructuredData): boolean {
  const action = value.potentialAction;
  return (
    exactObjectKeys(value, [
      "@context",
      "@type",
      "alternateName",
      "inLanguage",
      "name",
      "potentialAction",
      "url",
    ]) &&
    boundedText(value.name, 160) &&
    boundedText(value.alternateName, 160) &&
    sameOriginPublicUrl(value.url) &&
    value.url === publicWebOrigin().href &&
    (value.inLanguage === "zh-Hans" || value.inLanguage === "en-US") &&
    exactObjectKeys(action, ["@type", "query-input", "target"]) &&
    action["@type"] === "SearchAction" &&
    action["query-input"] === "required name=search_term_string" &&
    action.target.startsWith(`${value.url}${value.inLanguage}/search?q=`) &&
    action.target.endsWith("{search_term_string}")
  );
}

function validBreadcrumb(value: BreadcrumbStructuredData): boolean {
  if (
    !exactObjectKeys(value, ["@context", "@type", "itemListElement"]) ||
    value.itemListElement.length === 0 ||
    value.itemListElement.length > 10
  ) {
    return false;
  }
  return value.itemListElement.every(
    (item, index) =>
      exactObjectKeys(item, ["@type", "item", "name", "position"]) &&
      item["@type"] === "ListItem" &&
      item.position === index + 1 &&
      boundedText(item.name, 160) &&
      sameOriginPublicUrl(item.item) &&
      !new URL(item.item).search,
  );
}

function validJobPosting(value: JobPostingStructuredData): boolean {
  const posted = Date.parse(value.datePosted);
  const expires = Date.parse(value.validThrough);
  return (
    exactObjectKeys(value, [
      "@context",
      "@type",
      "datePosted",
      "description",
      "employmentType",
      "hiringOrganization",
      "identifier",
      "inLanguage",
      "jobLocation",
      "title",
      "url",
      "validThrough",
    ]) &&
    boundedText(value.title, 120) &&
    boundedText(value.description, 5_000) &&
    boundedText(value.employmentType, 40) &&
    Number.isFinite(posted) &&
    Number.isFinite(expires) &&
    expires > posted &&
    exactObjectKeys(value.identifier, ["@type", "name", "value"]) &&
    value.identifier["@type"] === "PropertyValue" &&
    boundedText(value.identifier.name, 160) &&
    boundedText(value.identifier.value, 100) &&
    exactObjectKeys(value.hiringOrganization, ["@type", "name"]) &&
    value.hiringOrganization["@type"] === "Organization" &&
    boundedText(value.hiringOrganization.name, 160) &&
    exactObjectKeys(value.jobLocation, ["@type", "address"]) &&
    value.jobLocation["@type"] === "Place" &&
    exactObjectKeys(value.jobLocation.address, [
      "@type",
      "addressCountry",
      "addressLocality",
      "addressRegion",
    ]) &&
    value.jobLocation.address["@type"] === "PostalAddress" &&
    boundedText(value.jobLocation.address.addressLocality, 160) &&
    value.jobLocation.address.addressRegion === "CA" &&
    value.jobLocation.address.addressCountry === "US" &&
    sameOriginPublicUrl(value.url) &&
    (value.inLanguage === "zh-Hans" || value.inLanguage === "en-US")
  );
}

export function isStructuredDataNode(value: unknown): value is StructuredDataNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const candidate = value as StructuredDataNode;
    if (candidate["@context"] !== "https://schema.org") return false;
    if (candidate["@type"] === "WebSite") return validWebSite(candidate);
    if (candidate["@type"] === "BreadcrumbList") return validBreadcrumb(candidate);
    if (candidate["@type"] === "JobPosting") return validJobPosting(candidate);
    return false;
  } catch {
    return false;
  }
}

export function serializeStructuredData(value: unknown): string | null {
  if (!isStructuredDataNode(value)) return null;
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function StructuredData({
  nodes,
}: {
  nodes: StructuredDataNode | readonly StructuredDataNode[];
}) {
  const values = Array.isArray(nodes) ? nodes : [nodes];
  const serialized = values
    .map((node) => serializeStructuredData(node))
    .filter((value): value is string => value !== null);
  if (serialized.length === 0) return null;
  return (
    <>
      {serialized.map((value, index) => (
        <script
          data-structured-data
          dangerouslySetInnerHTML={{ __html: value }}
          key={`${index}:${value.slice(0, 80)}`}
          type="application/ld+json"
        />
      ))}
    </>
  );
}

export function websiteStructuredData(locale: Locale): WebSiteStructuredData {
  const origin = publicWebOrigin().href;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: locale === "zh-Hans" ? "南加生活网" : "SoCal Life",
    alternateName: locale === "zh-Hans" ? "SoCal Life" : "南加生活网",
    url: origin,
    inLanguage: locale,
    potentialAction: {
      "@type": "SearchAction",
      target: `${origin}${locale}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbStructuredData(
  items: readonly BreadcrumbInput[],
): BreadcrumbStructuredData | null {
  if (items.length === 0 || items.length > 10) return null;
  const itemListElement = items.map((item, index) => ({
    "@type": "ListItem" as const,
    position: index + 1,
    name: sanitizeMetadataText(item.name, 160),
    item: absolutePublicUrl(item.path),
  }));
  const value: BreadcrumbStructuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
  return isStructuredDataNode(value) ? value : null;
}

function publicAttributeString(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
  maximum: number,
): string | null {
  const value = attributes[key];
  if (typeof value !== "string") return null;
  const sanitized = sanitizeMetadataText(value, maximum);
  return boundedText(sanitized, maximum) ? sanitized : null;
}

export function jobPostingStructuredData(
  locale: Locale,
  listing: PublicListingView,
  path: string,
  now = new Date(),
): JobPostingStructuredData | null {
  const published = Date.parse(listing.publishedAt);
  const expires = Date.parse(listing.expiresAt);
  const employerName = publicAttributeString(listing.attributes, "employerName", 160);
  const rawEmploymentType = publicAttributeString(listing.attributes, "employmentType", 40);
  const description = listing.summary ? sanitizeMetadataText(listing.summary, 240) : null;
  const employmentType = rawEmploymentType
    ? (employmentTypeValues[rawEmploymentType.toLowerCase()] ?? rawEmploymentType.toUpperCase())
    : null;
  if (
    listing.type !== "JOB" ||
    listing.status !== "PUBLISHED" ||
    !Number.isFinite(published) ||
    !Number.isFinite(expires) ||
    published > now.getTime() ||
    expires <= now.getTime() ||
    !employerName ||
    !employmentType ||
    !description ||
    !listing.region.code.startsWith("US-CA-")
  ) {
    return null;
  }
  const value: JobPostingStructuredData = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: sanitizeMetadataText(listing.title, 120),
    description,
    identifier: {
      "@type": "PropertyValue",
      name: employerName,
      value: listing.id,
    },
    datePosted: listing.publishedAt,
    validThrough: listing.expiresAt,
    employmentType,
    hiringOrganization: {
      "@type": "Organization",
      name: employerName,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: locale === "zh-Hans" ? listing.region.nameZhHans : listing.region.nameEn,
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
    url: absolutePublicUrl(path),
    inLanguage: listing.locale,
  };
  return isStructuredDataNode(value) ? value : null;
}

export function publicBreadcrumbItems(
  locale: Locale,
  type: ListingType,
  verticalName: string,
  city?: Readonly<{ name: string; path: string }>,
  detail?: Readonly<{ name: string; path: string }>,
): readonly BreadcrumbInput[] {
  const verticalSlugs: Readonly<Record<ListingType, string>> = {
    JOB: "jobs",
    RENTAL: "rentals",
    TRANSFER: "transfers",
    SECONDHAND: "marketplace",
    SERVICE: "services",
  };
  return [
    { name: locale === "zh-Hans" ? "首页" : "Home", path: `/${locale}` },
    { name: verticalName, path: `/${locale}/${verticalSlugs[type]}` },
    ...(city ? [city] : []),
    ...(detail ? [detail] : []),
  ];
}
