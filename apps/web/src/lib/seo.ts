import type { Metadata } from "next";
import type { Locale } from "@socal/contracts";
export { isSupportedLocale, SUPPORTED_LOCALES } from "./i18n";

const defaultPublicOrigin = "http://localhost:3000";
const metadataControlCharacters = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const htmlLikeTag = /<[^>]*>/gu;
const cityRoutePattern =
  /^(jobs|rentals|transfers|marketplace|services):[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const localeCopy: Readonly<
  Record<
    Locale,
    Readonly<{
      brand: string;
      description: string;
      separator: string;
      openGraphLocale: string;
    }>
  >
> = {
  "zh-Hans": {
    brand: "南加生活网",
    description: "服务南加州华人的本地分类信息、商家、师傅、社区与生活服务平台。",
    separator: "｜",
    openGraphLocale: "zh_CN",
  },
  "en-US": {
    brand: "SoCal Life",
    description:
      "Local listings, businesses, professionals, community, and everyday services for Southern California.",
    separator: " | ",
    openGraphLocale: "en_US",
  },
};

type PublicPageMetadataInput = Readonly<{
  locale: Locale;
  title: string;
  description: string;
  canonicalPath: string;
  index: boolean;
  follow: boolean;
  alternatePath?: (locale: Locale) => string;
  openGraphType?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  expirationTime?: string;
}>;

export function sanitizeMetadataText(value: string, maximumCodePoints: number): string {
  const normalized = value
    .normalize("NFKC")
    .replace(metadataControlCharacters, " ")
    .replace(htmlLikeTag, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(normalized).slice(0, maximumCodePoints).join("");
}

function validatedPublicOrigin(candidate: string | undefined): URL | null {
  try {
    if (!candidate) return null;
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

export function hasTrustedPublicOrigin(candidate = process.env.PUBLIC_WEB_URL): boolean {
  if (validatedPublicOrigin(candidate)) return true;
  return !candidate && process.env.NODE_ENV !== "production";
}

export function publicWebOrigin(candidate = process.env.PUBLIC_WEB_URL): URL {
  return validatedPublicOrigin(candidate) ?? new URL(defaultPublicOrigin);
}

export function absolutePublicUrl(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("SEO pathname must be an absolute same-origin path");
  }
  const url = new URL(pathname, publicWebOrigin());
  url.search = "";
  url.hash = "";
  return url.href;
}

function brandedTitle(locale: Locale, subject: string): string {
  const copy = localeCopy[locale];
  const safeSubject = sanitizeMetadataText(subject, 70);
  if (!safeSubject || safeSubject === copy.brand) return copy.brand;
  return `${safeSubject}${copy.separator}${copy.brand}`;
}

export function localeLayoutMetadata(locale: Locale): Metadata {
  const copy = localeCopy[locale];
  return {
    title: {
      default: copy.brand,
      template: `%s${copy.separator}${copy.brand}`,
    },
    description: copy.description,
  };
}

export function publicPageMetadata(input: PublicPageMetadataInput): Metadata {
  const copy = localeCopy[input.locale];
  const title = brandedTitle(input.locale, input.title);
  const description =
    sanitizeMetadataText(input.description, 160) || sanitizeMetadataText(copy.description, 160);
  const canonical = absolutePublicUrl(input.canonicalPath);
  const languages = input.alternatePath
    ? {
        "zh-Hans": absolutePublicUrl(input.alternatePath("zh-Hans")),
        "en-US": absolutePublicUrl(input.alternatePath("en-US")),
        "x-default": absolutePublicUrl(input.alternatePath("zh-Hans")),
      }
    : undefined;
  const commonOpenGraph = {
    title,
    description,
    siteName: copy.brand,
    locale: copy.openGraphLocale,
    alternateLocale: [localeCopy[input.locale === "zh-Hans" ? "en-US" : "zh-Hans"].openGraphLocale],
    url: canonical,
  };
  const openGraph: NonNullable<Metadata["openGraph"]> =
    input.openGraphType === "article"
      ? {
          ...commonOpenGraph,
          type: "article",
          ...(input.publishedTime ? { publishedTime: input.publishedTime } : {}),
          ...(input.modifiedTime ? { modifiedTime: input.modifiedTime } : {}),
          ...(input.expirationTime ? { expirationTime: input.expirationTime } : {}),
        }
      : { ...commonOpenGraph, type: "website" };

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      ...(languages ? { languages } : {}),
    },
    robots: {
      // A production domain misconfiguration must never make localhost canonicals indexable.
      index: input.index && hasTrustedPublicOrigin(),
      follow: input.follow,
    },
    openGraph,
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export function homepageSeoMetadata(locale: Locale, hasQueryParameters: boolean): Metadata {
  return publicPageMetadata({
    locale,
    title: locale === "zh-Hans" ? "南加州华人本地生活服务" : "Southern California Local Services",
    description: localeCopy[locale].description,
    canonicalPath: `/${locale}`,
    index: !hasQueryParameters,
    follow: true,
    ...(!hasQueryParameters
      ? {
          alternatePath: (alternateLocale: Locale) => `/${alternateLocale}`,
        }
      : {}),
  });
}

export function privatePageMetadata(
  locale: Locale,
  title: string,
  canonicalPath: string,
  description: string,
): Metadata {
  return publicPageMetadata({
    locale,
    title,
    description,
    canonicalPath,
    index: false,
    follow: false,
  });
}

export function parseSeoCityRouteAllowlist(
  value = process.env.SEO_INDEXABLE_CITY_ROUTES,
): ReadonlySet<string> {
  if (!value?.trim()) return new Set();
  if (value.length > 10_000) return new Set();
  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length > 200 || entries.some((entry) => !cityRoutePattern.test(entry))) {
    return new Set();
  }
  return new Set(entries);
}

export function isSeoCityRouteApproved(vertical: string, citySlug: string): boolean {
  return parseSeoCityRouteAllowlist().has(`${vertical}:${citySlug}`.toLowerCase());
}
