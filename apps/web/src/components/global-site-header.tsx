"use client";

import type { Locale, SearchSuggestion } from "@socal/contracts";
import Link from "next/link";
import { Languages, MapPin, Search, Tag, UserRound, UserPlus } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { primaryNavigation } from "../data/homepage";
import { localizedPath, ROUTES } from "../data/routes";
import { AppIcon } from "./icons/app-icon";
import { parseAccountSessionResponse } from "./account-shell";

type HeaderRegion = Readonly<{ code: string; name: string }>;
type LoadState = "idle" | "loading" | "ready" | "empty" | "unavailable";

const regionCodePattern = /^[A-Z0-9-]{2,80}$/;
const categorySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

const copy = {
  "zh-Hans": {
    brand: "南加生活网",
    brandSubtitle: "SOCAL LIFE",
    brandHome: "南加生活网首页",
    allRegions: "南加州",
    region: "选择搜索地区",
    regionLoading: "城市加载中",
    regionUnavailable: "城市列表暂不可用，可继续搜索整个南加州",
    search: "搜索",
    searchPlaceholder: "搜索职位、房源、转让、二手或服务",
    primaryNav: "主导航",
    language: "中文 / English",
    accountActions: "账户操作",
    signIn: "登录",
    register: "注册",
    account: "账户中心",
    suggestions: "搜索建议",
    suggestionLoading: "正在加载搜索建议",
    suggestionEmpty: "没有可用建议，可直接提交搜索",
    suggestionUnavailable: "搜索建议暂不可用，可直接提交搜索",
    suggestionCount: (count: number) => `${count} 条搜索建议可用`,
    suggestionTypes: { QUERY: "搜索词", CATEGORY: "分类", REGION: "地区" },
  },
  "en-US": {
    brand: "SoCal Life",
    brandSubtitle: "南加生活网",
    brandHome: "SoCal Life home",
    allRegions: "Southern California",
    region: "Choose search region",
    regionLoading: "Loading cities",
    regionUnavailable: "Cities are unavailable; you can still search all Southern California",
    search: "Search",
    searchPlaceholder: "Search jobs, rentals, transfers, items, or services",
    primaryNav: "Primary navigation",
    language: "中文 / English",
    accountActions: "Account actions",
    signIn: "Sign in",
    register: "Register",
    account: "Account",
    suggestions: "Search suggestions",
    suggestionLoading: "Loading search suggestions",
    suggestionEmpty: "No suggestions are available; submit your search directly",
    suggestionUnavailable: "Suggestions are unavailable; submit your search directly",
    suggestionCount: (count: number) => `${count} search suggestions available`,
    suggestionTypes: { QUERY: "Query", CATEGORY: "Category", REGION: "Region" },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !unsafeTextPattern.test(value)
  );
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validSuggestionInput(value: string): boolean {
  const normalized = value.trim().normalize("NFKC");
  return normalized.length <= 50 && !unsafeTextPattern.test(normalized);
}

export function parseHeaderSuggestions(value: unknown, locale: Locale): SearchSuggestion[] | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "generatedAt"]) ||
    !Array.isArray(value.data) ||
    value.data.length > 10 ||
    !isIsoInstant(value.generatedAt)
  ) {
    return null;
  }
  const suggestions: SearchSuggestion[] = [];
  const keys = new Set<string>();
  for (const rawSuggestion of value.data) {
    if (
      !isRecord(rawSuggestion) ||
      !hasExactKeys(rawSuggestion, ["type", "label", "value", "locale"]) ||
      (rawSuggestion.type !== "QUERY" &&
        rawSuggestion.type !== "CATEGORY" &&
        rawSuggestion.type !== "REGION") ||
      rawSuggestion.locale !== locale ||
      !safeText(rawSuggestion.label, 120) ||
      !safeText(rawSuggestion.value, 120) ||
      (rawSuggestion.type === "REGION" && !regionCodePattern.test(rawSuggestion.value)) ||
      (rawSuggestion.type === "CATEGORY" && !categorySlugPattern.test(rawSuggestion.value))
    ) {
      return null;
    }
    const key = `${rawSuggestion.type}:${rawSuggestion.value.normalize("NFKC").toLocaleLowerCase()}`;
    if (keys.has(key)) return null;
    keys.add(key);
    suggestions.push(rawSuggestion as SearchSuggestion);
  }
  return suggestions;
}

export function parseHeaderRegions(value: unknown, locale: Locale): HeaderRegion[] | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["data"]) ||
    !Array.isArray(value.data) ||
    value.data.length > 250
  ) {
    return null;
  }
  const regions: HeaderRegion[] = [];
  const codes = new Set<string>();
  for (const rawRegion of value.data) {
    if (
      !isRecord(rawRegion) ||
      rawRegion.type !== "CITY" ||
      rawRegion.active !== true ||
      !safeText(rawRegion.code, 80) ||
      !regionCodePattern.test(rawRegion.code) ||
      !isRecord(rawRegion.name) ||
      !safeText(rawRegion.name[locale], 160) ||
      codes.has(rawRegion.code)
    ) {
      return null;
    }
    codes.add(rawRegion.code);
    regions.push({ code: rawRegion.code, name: rawRegion.name[locale] });
  }
  return regions.sort((left, right) => left.name.localeCompare(right.name, locale));
}

function switchLocalePath(locale: Locale, pathname: string): string {
  const target = locale === "zh-Hans" ? "en-US" : "zh-Hans";
  return pathname.startsWith(`/${locale}`)
    ? pathname.replace(`/${locale}`, `/${target}`)
    : `/${target}`;
}

function currentRoute(locale: Locale, pathname: string, route: string): boolean {
  const localized = localizedPath(locale, route);
  return route === "/"
    ? pathname === localized
    : pathname === localized || pathname.startsWith(`${localized}/`);
}

function loginPath(locale: Locale, pathname: string): string {
  return `${localizedPath(locale, ROUTES.login)}?returnTo=${encodeURIComponent(pathname)}`;
}

function suggestionIcon(type: SearchSuggestion["type"]) {
  return type === "REGION" ? MapPin : type === "CATEGORY" ? Tag : Search;
}

export function GlobalSiteHeader({
  locale,
  pathname,
  initialRegion,
}: Readonly<{
  locale: Locale;
  pathname: string;
  initialRegion?: HeaderRegion;
}>) {
  const labels = copy[locale];
  const listboxId = useId();
  const statusId = useId();
  const regionStatusId = useId();
  const [query, setQuery] = useState("");
  const [regionCode, setRegionCode] = useState(initialRegion?.code ?? "");
  const [regions, setRegions] = useState<readonly HeaderRegion[]>(
    initialRegion ? [initialRegion] : [],
  );
  const [regionState, setRegionState] = useState<LoadState>("loading");
  const [accountState, setAccountState] = useState<
    "loading" | "guest" | "authenticated" | "unavailable"
  >("loading");
  const [suggestions, setSuggestions] = useState<readonly SearchSuggestion[]>([]);
  const [suggestionState, setSuggestionState] = useState<LoadState>("idle");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/v1/regions?type=CITY&activeOnly=true", {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok ? parseHeaderRegions((await response.json()) as unknown, locale) : null,
      )
      .then((parsed) => {
        if (!parsed) {
          setRegionState("unavailable");
          return;
        }
        setRegions((current) => {
          const combined = new Map(current.map((region) => [region.code, region]));
          for (const region of parsed) combined.set(region.code, region);
          return [...combined.values()];
        });
        setRegionState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setRegionState("unavailable");
        }
      });

    void fetch("/v1/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return "guest" as const;
        if (!response.ok) return "unavailable" as const;
        const parsed = parseAccountSessionResponse((await response.json()) as unknown);
        return parsed && new Date(parsed.data.expiresAt).getTime() > Date.now()
          ? ("authenticated" as const)
          : ("unavailable" as const);
      })
      .then(setAccountState)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccountState("unavailable");
        }
      });
    return () => controller.abort();
  }, [locale]);

  useEffect(() => {
    if (!suggestionsOpen || !validSuggestionInput(query)) return;
    const normalized = query.trim().normalize("NFKC");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSuggestionState("loading");
      const parameters = new URLSearchParams({ locale, limit: "8" });
      if (normalized) parameters.set("q", normalized);
      if (regionCode) parameters.set("regionCode", regionCode);
      void fetch(`/v1/search/suggestions?${parameters.toString()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      })
        .then(async (response) =>
          response.ok ? parseHeaderSuggestions((await response.json()) as unknown, locale) : null,
        )
        .then((parsed) => {
          if (!parsed) {
            setSuggestions([]);
            setSuggestionState("unavailable");
          } else {
            setSuggestions(parsed);
            setSuggestionState(parsed.length > 0 ? "ready" : "empty");
          }
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setSuggestions([]);
            setSuggestionState("unavailable");
            setActiveIndex(-1);
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [locale, query, regionCode, suggestionsOpen]);

  const status = useMemo(() => {
    if (suggestionState === "loading") return labels.suggestionLoading;
    if (suggestionState === "ready") return labels.suggestionCount(suggestions.length);
    if (suggestionState === "empty") return labels.suggestionEmpty;
    if (suggestionState === "unavailable") return labels.suggestionUnavailable;
    return "";
  }, [labels, suggestionState, suggestions.length]);

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    if (suggestion.type === "REGION") {
      setRegionCode(suggestion.value);
      if (!regions.some((region) => region.code === suggestion.value)) {
        setRegions((current) => [...current, { code: suggestion.value, name: suggestion.label }]);
      }
      setQuery("");
    } else {
      setQuery(suggestion.label);
    }
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && suggestionsOpen && activeIndex >= 0) {
      event.preventDefault();
      const selected = suggestions[activeIndex];
      if (selected) chooseSuggestion(selected);
    }
  };

  return (
    <header className="globalSiteHeader">
      <div className="globalHeaderTop pageShell">
        <Link
          className="globalBrand"
          href={localizedPath(locale, ROUTES.home)}
          aria-label={labels.brandHome}
        >
          <span aria-hidden="true">
            <AppIcon icon={MapPin} size={23} />
          </span>
          <span>
            <strong>{labels.brand}</strong>
            <small>{labels.brandSubtitle}</small>
          </span>
        </Link>

        <form
          action={localizedPath(locale, ROUTES.classified)}
          className="globalHeaderSearch"
          role="search"
        >
          <label className="globalRegionPicker">
            <span className="srOnly">{labels.region}</span>
            <AppIcon icon={MapPin} size={18} />
            <select
              aria-describedby={regionStatusId}
              aria-label={labels.region}
              name="regionCode"
              onChange={(event) => setRegionCode(event.currentTarget.value)}
              value={regionCode}
            >
              <option value="">{labels.allRegions}</option>
              {regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <span aria-live="polite" className="srOnly" id={regionStatusId}>
            {regionState === "loading"
              ? labels.regionLoading
              : regionState === "unavailable"
                ? labels.regionUnavailable
                : ""}
          </span>

          <div className="globalSearchCombobox">
            <label className="srOnly" htmlFor={`${listboxId}-input`}>
              {labels.search}
            </label>
            <input
              aria-activedescendant={
                activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-describedby={statusId}
              aria-expanded={suggestionsOpen && suggestionState === "ready"}
              autoComplete="off"
              id={`${listboxId}-input`}
              maxLength={120}
              name="q"
              onBlur={() => setSuggestionsOpen(false)}
              onChange={(event) => {
                const nextQuery = event.currentTarget.value;
                setQuery(nextQuery);
                setSuggestionsOpen(true);
                setActiveIndex(-1);
                if (validSuggestionInput(nextQuery)) {
                  setSuggestionState("loading");
                } else {
                  setSuggestions([]);
                  setSuggestionState("empty");
                }
              }}
              onFocus={() => {
                setSuggestionsOpen(true);
                if (validSuggestionInput(query)) setSuggestionState("loading");
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={labels.searchPlaceholder}
              role="combobox"
              value={query}
            />
            {suggestionsOpen && suggestionState === "ready" ? (
              <ul
                aria-label={labels.suggestions}
                className="globalSearchSuggestions"
                id={listboxId}
                role="listbox"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    aria-selected={activeIndex === index}
                    id={`${listboxId}-option-${index}`}
                    key={`${suggestion.type}:${suggestion.value}`}
                    onClick={() => chooseSuggestion(suggestion)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                  >
                    <AppIcon icon={suggestionIcon(suggestion.type)} size={17} />
                    <span>{suggestion.label}</span>
                    <small>{labels.suggestionTypes[suggestion.type]}</small>
                  </li>
                ))}
              </ul>
            ) : null}
            {suggestionsOpen &&
            (suggestionState === "loading" ||
              suggestionState === "empty" ||
              suggestionState === "unavailable") ? (
              <div aria-hidden="true" className="globalSearchState">
                {status}
              </div>
            ) : null}
            <span aria-live="polite" className="srOnly" id={statusId}>
              {status}
            </span>
          </div>
          <button aria-label={labels.search} type="submit">
            <AppIcon icon={Search} size={18} />
            <span>{labels.search}</span>
          </button>
        </form>

        <nav className="globalHeaderActions" aria-label={labels.accountActions}>
          <Link
            aria-label={labels.language}
            className="globalLanguageAction"
            href={switchLocalePath(locale, pathname)}
          >
            <AppIcon icon={Languages} size={17} />
            <span>{labels.language}</span>
          </Link>
          {accountState === "authenticated" ? (
            <Link
              aria-label={labels.account}
              className="globalAccountAction"
              href={localizedPath(locale, ROUTES.userCenter)}
            >
              <AppIcon icon={UserRound} size={18} />
              <span>{labels.account}</span>
            </Link>
          ) : (
            <>
              <Link
                aria-label={labels.signIn}
                aria-busy={accountState === "loading"}
                className="globalAccountAction"
                href={loginPath(locale, pathname)}
              >
                <AppIcon icon={UserRound} size={18} />
                <span>{labels.signIn}</span>
              </Link>
              {accountState === "guest" ? (
                <Link
                  aria-label={labels.register}
                  className="globalRegisterAction"
                  href={localizedPath(locale, ROUTES.register)}
                >
                  <AppIcon icon={UserPlus} size={17} />
                  <span>{labels.register}</span>
                </Link>
              ) : null}
            </>
          )}
        </nav>
      </div>
      <nav className="globalPrimaryNav pageShell" aria-label={labels.primaryNav}>
        {primaryNavigation(locale).map(([label, route]) => (
          <Link
            aria-current={currentRoute(locale, pathname, route) ? "page" : undefined}
            className={currentRoute(locale, pathname, route) ? "active" : undefined}
            href={localizedPath(locale, route)}
            key={route}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
