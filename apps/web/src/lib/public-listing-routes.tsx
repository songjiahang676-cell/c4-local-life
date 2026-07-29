import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { ListingType, Locale } from "@socal/contracts";
import {
  PublicListingDetailUnavailable,
  PublicListingDetailView,
  PublicListingIndexView,
  publicSearchTitle,
  publicVerticalTitle,
} from "../components/public-listing-pages";
import {
  listingIdFromSlug,
  loadPublicListingDetail,
  loadPublicListingIndex,
  publicListingPath,
  publicSearchPath,
  publicVerticalPath,
  type PublicSearchParams,
  verticalSlug,
} from "./public-listings";

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

function hasFilterParameters(params: PublicSearchParams): boolean {
  return ["q", "type", "categoryId", "regionCode", "minPrice", "maxPrice", "sort", "cursor"].some(
    (key) => params[key] !== undefined,
  );
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
  const detail = listingPath.length === 2;
  const indexable = detail || (listingPath.length <= 1 && !hasFilterParameters(searchParams));
  return {
    title: detail
      ? locale === "zh-Hans"
        ? `信息详情 — ${publicVerticalTitle(locale, type)}`
        : `Listing details — ${publicVerticalTitle(locale, type)}`
      : publicVerticalTitle(locale, type),
    description:
      locale === "zh-Hans"
        ? "南加州本地已发布公开信息；支持城市、分类、价格与排序筛选。"
        : "Published Southern California listings with city, category, price, and sort filters.",
    robots: { index: indexable, follow: true },
  };
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
  return <PublicListingDetailView locale={locale} listing={model.listing} pathname={canonical} />;
}

export async function publicSearchMetadata(props: PublicSearchRouteProps): Promise<Metadata> {
  const { locale: rawLocale } = await props.params;
  const locale = localeValue(rawLocale);
  return {
    title: publicSearchTitle(locale),
    description:
      locale === "zh-Hans"
        ? "搜索南加州招聘、租房、转让、二手和本地服务。"
        : "Search Southern California jobs, rentals, transfers, secondhand items, and services.",
    robots: { index: false, follow: true },
  };
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
