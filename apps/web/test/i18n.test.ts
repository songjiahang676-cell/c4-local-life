import { describe, expect, it } from "vitest";
import { formatCountMessage, messageCatalogs } from "../src/i18n/messages";
import {
  alternateLocale,
  canonicalLocaleAliasPathname,
  DEFAULT_LOCALE,
  formatDateTime,
  formatFixedDecimalCurrency,
  formatNumber,
  formatRelativeTime,
  isSupportedLocale,
  localeFromPathname,
  localeFromRequestHeader,
  localizedPath,
  SUPPORTED_LOCALES,
  switchLocalePath,
} from "../src/lib/i18n";

describe("Web i18n route contract", () => {
  it("keeps supported locales and alternate routes canonical", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-Hans", "en-US"]);
    expect(isSupportedLocale("zh-Hans")).toBe(true);
    expect(isSupportedLocale("en")).toBe(false);
    expect(alternateLocale("zh-Hans")).toBe("en-US");
    expect(localizedPath("en-US", "/rentals/synthetic-city")).toBe("/en-US/rentals/synthetic-city");
    expect(switchLocalePath("en-US", "/en-US/rentals/zh-Hans-guide")).toBe(
      "/zh-Hans/rentals/zh-Hans-guide",
    );
    expect(switchLocalePath("zh-Hans", "/unlocalized")).toBe("/en-US");
  });

  it("maps only the documented English alias and never trusts an incoming locale header", () => {
    expect(localeFromPathname("/en/rentals")).toBe("en-US");
    expect(canonicalLocaleAliasPathname("/en/rentals")).toBe("/en-US/rentals");
    expect(canonicalLocaleAliasPathname("/en-US/rentals")).toBeNull();
    expect(localeFromRequestHeader("en-US")).toBe("en-US");
    expect(localeFromRequestHeader("en")).toBe(DEFAULT_LOCALE);
    expect(localeFromRequestHeader("<script>")).toBe(DEFAULT_LOCALE);
  });

  it.each([
    "https://attacker.example/rentals",
    "//attacker.example/rentals",
    "/rentals//latest",
    "/rentals?q=test",
    "/rentals#results",
    "/rentals\\latest",
    "/rentals\u202e/latest",
  ])("rejects a non-canonical localizedPath input: %s", (pathname) => {
    expect(() => localizedPath("zh-Hans", pathname)).toThrow(
      "Locale routes require a canonical same-origin pathname",
    );
  });

  it("rejects a route that is already localized instead of duplicating its segment", () => {
    expect(() => localizedPath("zh-Hans", "/en-US/rentals")).toThrow(
      "localizedPath expects a pathname without a locale segment",
    );
  });
});

describe("Web i18n message and Intl contract", () => {
  it("keeps the common Chinese and English catalogs structurally equivalent", () => {
    expect(Object.keys(messageCatalogs["zh-Hans"]).sort()).toEqual(
      Object.keys(messageCatalogs["en-US"]).sort(),
    );
    expect(Object.keys(messageCatalogs["zh-Hans"].common).sort()).toEqual(
      Object.keys(messageCatalogs["en-US"].common).sort(),
    );
    expect(Object.keys(messageCatalogs["zh-Hans"].listings.resultCount).sort()).toEqual(
      Object.keys(messageCatalogs["en-US"].listings.resultCount).sort(),
    );
  });

  it("uses locale plural and number rules for parameterized messages", () => {
    expect(formatCountMessage("en-US", messageCatalogs["en-US"].listings.resultCount, 1)).toBe(
      "1 listing",
    );
    expect(formatCountMessage("en-US", messageCatalogs["en-US"].listings.resultCount, 2)).toBe(
      "2 listings",
    );
    expect(formatCountMessage("zh-Hans", messageCatalogs["zh-Hans"].listings.resultCount, 2)).toBe(
      "2 条信息",
    );
    expect(formatNumber("en-US", 12345)).toBe("12,345");
  });

  it("formats UTC instants, relative time and fixed-decimal money without float conversion", () => {
    expect(formatDateTime("en-US", "2026-01-02T08:00:00.000Z")).toBe("Jan 2, 2026");
    expect(formatRelativeTime("en-US", -1, "day")).toBe("yesterday");
    expect(formatFixedDecimalCurrency("en-US", "1234.5", "USD")).toBe("$1,234.50");
    expect(formatFixedDecimalCurrency("zh-Hans", "1234.05", "USD")).toContain("1,234.05");
    expect(() => formatFixedDecimalCurrency("en-US", "1.005", "USD")).toThrow(RangeError);
  });
});
