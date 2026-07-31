import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { ListingType, Locale } from "@socal/contracts";
import {
  PublicListingDetailUnavailable,
  PublicListingDetailView,
  PublicListingIndexView,
} from "../components/public-listing-pages";
import {
  listingIdFromSlug,
  loadPublicCity,
  loadPublicListingDetail,
  loadPublicListingIndex,
  publicListingPath,
  publicSearchPath,
  publicVerticalPath,
  type PublicSearchParams,
  verticalLabel,
  verticalSlug,
} from "./public-listings";
import { hasTrustedPublicOrigin, isSeoCityRouteApproved, publicPageMetadata } from "./seo";

export type PublicVerticalRouteProps = Readonly<{
  params: Promise<{
    locale: string;
    listingPath?: string[];
  }>;
  searchParams: Promise<PublicSearchParams>;
}>;

export type PublicSearchRouteProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<PublicSearchParams>;
}>;

function localeValue(value: string): Locale {
  if (value !== "zh-Hans" && value !== "en-US") notFound();
  return value;
}

function hasQueryParameters(params: PublicSearchParams): boolean {
  return Object.values(params).some((value) => value !== undefined);
}

export async function publicVerticalMetadata(
  type: ListingType,
  props: PublicVerticalRouteProps,
): Promise<Metadata> {
  const [{ locale: rawLocale, listingPath = [] }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const locale = localeValue(rawLocale);
  const vertical = verticalSlug(type);
  const filtered = hasQueryParameters(searchParams);
  const description =
    locale === "zh-Hans"
      ? "南加州本地已发布公开信息；支持城市、分类、价格与排序筛选。"
      : "Published Southern California listings with city, category, price, and sort filters.";

  if (listingPath.length === 0) {
    return publicPageMetadata({
      locale,
      title: verticalLabel(locale, type),
      description,
      canonicalPath: publicVerticalPath(locale, type),
      index: !filtered,
      follow: true,
      ...(!filtered
        ? {
            alternatePath: (alternateLocale: Locale) => publicVerticalPath(alternateLocale, type),
          }
        : {}),
    });
  }

  if (listingPath.length === 1) {
    const citySlug = listingPath[0];
    if (!citySlug) notFound();
    const city = await loadPublicCity(locale, citySlug);
    if (city.kind === "not-found") notFound();
    const approved =
      city.kind === "ready" && isSeoCityRouteApproved(vertical, citySlug) && !filtered;
    const cityName =
      city.kind === "ready" ? city.region.name[locale] : locale === "zh-Hans" ? "城市" : "City";
    const canonicalPath = `/${locale}/${vertical}/${encodeURIComponent(citySlug)}`;
    return publicPageMetadata({
      locale,
      title:
        locale === "zh-Hans"
          ? `${cityName}${verticalLabel(locale, type)}`
          : `${cityName} ${verticalLabel(locale, type)}`,
      description,
      canonicalPath,
      index: approved,
      follow: true,
      ...(approved
        ? {
            alternatePath: (alternateLocale: Locale) =>
              `/${alternateLocale}/${vertical}/${encodeURIComponent(citySlug)}`,
          }
        : {}),
    });
  }

  if (listingPath.length !== 2) notFound();
  const [citySlug, listingSlug] = listingPath;
  if (!citySlug || !listingSlug) notFound();
  const listingId = listingIdFromSlug(listingSlug);
  if (!listingId) notFound();
  const model = await loadPublicListingDetail(locale, listingId);
  if (model.kind === "not-found") notFound();
  if (model.kind === "unavailable") {
    return publicPageMetadata({
      locale,
      title: locale === "zh-Hans" ? "信息暂时不可用" : "Listing temporarily unavailable",
      description,
      canonicalPath: `/${locale}/${vertical}/${encodeURIComponent(
        citySlug,
      )}/${encodeURIComponent(listingSlug)}`,
      index: false,
      follow: true,
    });
  }
  if (model.listing.type !== type) notFound();
  const canonicalPath = publicListingPath(locale, model.listing);
  const listingDescription =
    model.listing.summary ??
    (locale === "zh-Hans"
      ? `查看${verticalLabel(locale, type)}公开信息、地区和有效期。`
      : `View this public ${verticalLabel(locale, type).toLowerCase()} listing, region, and expiry.`);
  return publicPageMetadata({
    locale,
    title: model.listing.title,
    description: listingDescription,
    canonicalPath,
    index: !filtered,
    follow: true,
    ...(!filtered
      ? {
          alternatePath: (alternateLocale: Locale) =>
            publicListingPath(alternateLocale, model.listing),
        }
      : {}),
    openGraphType: "article",
    publishedTime: model.listing.publishedAt,
    modifiedTime: model.listing.updatedAt,
    expirationTime: model.listing.expiresAt,
  });
}

export async function renderPublicVerticalRoute(
  type: ListingType,
  props: PublicVerticalRouteProps,
) {
  const [{ locale: rawLocale, listingPath = [] }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const locale = localeValue(rawLocale);
  const vertical = verticalSlug(type);

  if (listingPath.length <= 1) {
    const citySlug = listingPath[0];
    const pathname = `/${locale}/${vertical}${citySlug ? `/${encodeURIComponent(citySlug)}` : ""}`;
    const model = await loadPublicListingIndex({
      locale,
      params: searchParams,
      type,
      ...(citySlug ? { citySlug } : {}),
    });
    if (model.kind === "not-found") notFound();
    return (
      <PublicListingIndexView
        action={publicVerticalPath(locale, type)}
        citySlug={citySlug}
        includeStructuredData={
          hasTrustedPublicOrigin() &&
          !hasQueryParameters(searchParams) &&
          (!citySlug || isSeoCityRouteApproved(vertical, citySlug))
        }
        locale={locale}
        model={model}
        pathname={pathname}
        type={type}
      />
    );
  }

  if (listingPath.length !== 2) notFound();
  const [citySlug, listingSlug] = listingPath;
  if (!citySlug || !listingSlug) notFound();
  const listingId = listingIdFromSlug(listingSlug);
  if (!listingId) notFound();
  const pathname = `/${locale}/${vertical}/${encodeURIComponent(citySlug)}/${encodeURIComponent(
    listingSlug,
  )}`;
  const model = await loadPublicListingDetail(locale, listingId);
  if (model.kind === "not-found") notFound();
  if (model.kind === "unavailable") {
    return (
      <PublicListingDetailUnavailable
        firstPage={publicVerticalPath(locale, type)}
        locale={locale}
        pathname={pathname}
      />
    );
  }
  if (model.listing.type !== type) notFound();
  const canonical = publicListingPath(locale, model.listing);
  if (
    model.listing.region.slug !== citySlug ||
    `${model.listing.slug}-${model.listing.id}` !== listingSlug
  ) {
    permanentRedirect(canonical);
  }
  return (
    <PublicListingDetailView
      includeStructuredData={hasTrustedPublicOrigin() && !hasQueryParameters(searchParams)}
      locale={locale}
      listing={model.listing}
      pathname={canonical}
    />
  );
}

export async function publicSearchMetadata(props: PublicSearchRouteProps): Promise<Metadata> {
  const { locale: rawLocale } = await props.params;
  const locale = localeValue(rawLocale);
  return publicPageMetadata({
    locale,
    title: locale === "zh-Hans" ? "搜索公开信息" : "Search public listings",
    description:
      locale === "zh-Hans"
        ? "搜索南加州招聘、租房、转让、二手和本地服务。"
        : "Search Southern California jobs, rentals, transfers, secondhand items, and services.",
    canonicalPath: publicSearchPath(locale),
    index: false,
    follow: true,
  });
}

export async function renderPublicSearchRoute(props: PublicSearchRouteProps) {
  const [{ locale: rawLocale }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const locale = localeValue(rawLocale);
  const pathname = publicSearchPath(locale);
  const model = await loadPublicListingIndex({ locale, params: searchParams });
  return (
    <PublicListingIndexView action={pathname} locale={locale} model={model} pathname={pathname} />
  );
}
