import type { Locale } from "@socal/contracts";

export const SUPPORTED_LOCALES = ["zh-Hans", "en-US"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = "zh-Hans";
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";
export const ROUTE_LOCALE_HEADER = "x-socal-route-locale";

const englishRouteAlias = "en";
const unsafeRouteCharacters = /[\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function alternateLocale(locale: Locale): Locale {
  return locale === "zh-Hans" ? "en-US" : "zh-Hans";
}

function assertCanonicalPathname(pathname: string): void {
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("//") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    unsafeRouteCharacters.test(pathname)
  ) {
    throw new Error("Locale routes require a canonical same-origin pathname");
  }
}

function firstPathSegment(pathname: string): string {
  return pathname.slice(1).split("/", 1)[0] ?? "";
}

export function localeFromPathname(pathname: string): Locale | null {
  assertCanonicalPathname(pathname);
  const segment = firstPathSegment(pathname);
  if (isSupportedLocale(segment)) return segment;
  return segment === englishRouteAlias ? "en-US" : null;
}

export function localeFromRequestHeader(value: string | null): Locale {
  return value !== null && isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function canonicalLocaleAliasPathname(pathname: string): string | null {
  assertCanonicalPathname(pathname);
  if (firstPathSegment(pathname) !== englishRouteAlias) return null;
  return `/en-US${pathname.slice(`/${englishRouteAlias}`.length)}`;
}

export function localizedPath(locale: Locale, pathname: string): string {
  assertCanonicalPathname(pathname);
  if (localeFromPathname(pathname) !== null) {
    throw new Error("localizedPath expects a pathname without a locale segment");
  }
  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}

export function switchLocalePath(locale: Locale, pathname: string): string {
  assertCanonicalPathname(pathname);
  const routeLocale = localeFromPathname(pathname);
  if (routeLocale === null || routeLocale !== locale) return `/${alternateLocale(locale)}`;

  const firstSegment = firstPathSegment(pathname);
  const suffix = pathname.slice(firstSegment.length + 1);
  return `/${alternateLocale(locale)}${suffix}`;
}

export function formatNumber(
  locale: Locale,
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDateTime(
  locale: Locale,
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const instant = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Invalid UTC instant");
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
  }).format(instant);
}

export function formatRelativeTime(
  locale: Locale,
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
): string {
  if (!Number.isFinite(value)) throw new RangeError("Relative time must be finite");
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
}

export function formatFixedDecimalCurrency(
  locale: Locale,
  amount: string,
  currency: string,
): string {
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/u.exec(amount);
  if (!match || !/^[A-Z]{3}$/u.test(currency)) {
    throw new RangeError("Currency values require a non-negative fixed decimal and ISO code");
  }
  const wholeUnits = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(wholeUnits);
  return parts.map((part) => (part.type === "fraction" ? fraction : part.value)).join("");
}
