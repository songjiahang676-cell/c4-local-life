import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { ListingType, Locale, PublicListingView } from "@socal/contracts";
import { AppIcon } from "./icons/app-icon";
import {
  PUBLIC_VERTICALS,
  formatListingDate,
  formatListingPrice,
  nextPagePath,
  publicAttributeEntries,
  publicListingPath,
  publicSearchPath,
  publicVerticalPath,
  type PublicListingCard,
  type PublicListingFilters,
  type PublicListingIndexModel,
  type PublicVertical,
  verticalLabel,
} from "../lib/public-listings";
import {
  StructuredData,
  breadcrumbStructuredData,
  jobPostingStructuredData,
  publicBreadcrumbItems,
  type StructuredDataNode,
} from "../lib/structured-data";

const copy = {
  "zh-Hans": {
    brand: "南加生活网",
    brandSubtitle: "SOCAL LIFE",
    home: "首页",
    search: "全站搜索",
    searchPlaceholder: "搜索职位、房源、转让、二手或服务",
    language: "English",
    filters: "筛选条件",
    query: "关键词",
    allTypes: "全部类型",
    type: "信息类型",
    category: "分类",
    allCategories: "全部分类",
    region: "城市",
    allRegions: "全部城市",
    minPrice: "最低价格（美元）",
    maxPrice: "最高价格（美元）",
    sort: "排序",
    relevance: "相关度",
    newest: "最新发布",
    priceAsc: "价格从低到高",
    priceDesc: "价格从高到低",
    apply: "应用筛选",
    reset: "清除筛选",
    resultCount: (count: number, more: boolean) => `本页 ${count} 条${more ? "，还有更多" : ""}`,
    active: "有效发布",
    sponsored: "推广",
    verified: "已验证机构",
    updated: "更新",
    expires: "有效至",
    publisher: "发布者",
    loadMore: "加载更多",
    degraded:
      "搜索服务暂时不可用，当前显示主数据库中的最新公开信息；复杂筛选和相关度排序暂不可用。",
    taxonomyDegraded: "分类或城市选项暂未完整加载，已有结果仍可正常查看。",
    corrected: (query: string) => `已按“${query}”查找`,
    emptyTitle: "暂时没有匹配的信息",
    emptyBody: "可以清除部分筛选条件，或稍后再试。平台不会用模拟内容填充空位。",
    invalidTitle: "筛选条件无效",
    invalidBody: "请检查价格范围、分类、城市或搜索文字后重试。",
    cursorTitle: "本页结果已过期",
    cursorBody: "搜索结果使用短期一致快照。请从第一页重新开始。",
    unavailableTitle: "公开信息暂时无法加载",
    unavailableBody: "服务正在恢复，请稍后重试。你的筛选条件没有被提交或保存。",
    unknownCityTitle: "找不到该城市页面",
    retry: "重新加载",
    backToFirst: "返回第一页",
    detail: "信息详情",
    body: "详细说明",
    facts: "信息属性",
    locationPrecision: "地点精度",
    published: "发布于",
    safety: "交易安全提醒",
    safetyBody:
      "请使用站内沟通，不要预付无法核实的费用，不要发送身份证件、验证码、银行卡或其他敏感资料。",
    detailUnavailable:
      "该详情暂时无法加载。请稍后重试；未公开、已下架和不存在的信息统一不会泄露内部状态。",
    city: "城市",
    categoryLabel: "分类",
    listingLanguage: "内容语言",
  },
  "en-US": {
    brand: "SoCal Life",
    brandSubtitle: "南加生活网",
    home: "Home",
    search: "Search",
    searchPlaceholder: "Search jobs, rentals, transfers, items, or services",
    language: "简体中文",
    filters: "Filters",
    query: "Keywords",
    allTypes: "All types",
    type: "Listing type",
    category: "Category",
    allCategories: "All categories",
    region: "City",
    allRegions: "All cities",
    minPrice: "Minimum price (USD)",
    maxPrice: "Maximum price (USD)",
    sort: "Sort",
    relevance: "Relevance",
    newest: "Newest",
    priceAsc: "Price: low to high",
    priceDesc: "Price: high to low",
    apply: "Apply filters",
    reset: "Clear filters",
    resultCount: (count: number, more: boolean) =>
      `${count} on this page${more ? ", with more available" : ""}`,
    active: "Active",
    sponsored: "Sponsored",
    verified: "Verified organization",
    updated: "Updated",
    expires: "Available until",
    publisher: "Publisher",
    loadMore: "Load more",
    degraded:
      "Search is temporarily unavailable. These are the latest public records from the primary database; complex filters and relevance sorting are unavailable.",
    taxonomyDegraded:
      "Some category or city options are temporarily unavailable. Existing results remain usable.",
    corrected: (query: string) => `Showing results for “${query}”`,
    emptyTitle: "No matching listings yet",
    emptyBody:
      "Clear one or more filters or try again later. The platform does not fill empty states with simulated content.",
    invalidTitle: "These filters are not valid",
    invalidBody: "Check the price range, category, city, or search text and try again.",
    cursorTitle: "This result page has expired",
    cursorBody: "Search uses a short-lived consistent snapshot. Start again from the first page.",
    unavailableTitle: "Public listings are temporarily unavailable",
    unavailableBody:
      "The service is recovering. Try again shortly; your filter values were not submitted or stored.",
    unknownCityTitle: "This city page was not found",
    retry: "Reload",
    backToFirst: "Back to first page",
    detail: "Listing details",
    body: "Description",
    facts: "Listing facts",
    locationPrecision: "Location precision",
    published: "Published",
    safety: "Safety reminder",
    safetyBody:
      "Use in-platform communication. Do not prepay unverifiable fees or share identity documents, verification codes, bank details, or other sensitive data.",
    detailUnavailable:
      "This detail is temporarily unavailable. Try again later; unpublished, removed, and unknown listings share a non-disclosing public response.",
    city: "City",
    categoryLabel: "Category",
    listingLanguage: "Content language",
  },
} as const;

const verticalIntro: Readonly<Record<ListingType, Readonly<Record<Locale, string>>>> = {
  JOB: {
    "zh-Hans": "浏览南加州公开招聘信息；请独立核实雇主、薪资、工时和用工条件。",
    "en-US":
      "Browse public Southern California job listings and independently verify employers, pay, hours, and working conditions.",
  },
  RENTAL: {
    "zh-Hans": "查找南加州公开租房信息；地点仅按发布者允许的精度展示。",
    "en-US":
      "Find public Southern California rentals. Locations are shown only at the precision permitted by the publisher.",
  },
  TRANSFER: {
    "zh-Hans": "查看生意、店铺和设备转让；请在交易前核实租约、许可和财务声明。",
    "en-US":
      "Explore business, storefront, and equipment transfers. Verify leases, permits, and financial claims before transacting.",
  },
  SECONDHAND: {
    "zh-Hans": "浏览本地二手物品；请当面核验物品状态并使用安全的交易方式。",
    "en-US": "Browse local secondhand items. Inspect condition and use a safe exchange method.",
  },
  SERVICE: {
    "zh-Hans": "查找本地服务信息；资质、报价和保险应在委托前另行核实。",
    "en-US": "Find local services. Verify credentials, estimates, and insurance before hiring.",
  },
};

function switchLocalePath(locale: Locale, pathname: string): string {
  const target = locale === "zh-Hans" ? "en-US" : "zh-Hans";
  return pathname.replace(`/${locale}`, `/${target}`);
}

function PublicSiteHeader({ locale, pathname }: { locale: Locale; pathname: string }) {
  const text = copy[locale];
  return (
    <>
      <header className="publicSiteHeader">
        <div className="publicHeaderTop pageShell">
          <Link
            className="publicBrand"
            href={`/${locale}`}
            aria-label={`${text.brand} ${text.home}`}
          >
            <span aria-hidden="true">SL</span>
            <span>
              <strong>{text.brand}</strong>
              <small>{text.brandSubtitle}</small>
            </span>
          </Link>
          <form
            action={publicSearchPath(locale)}
            aria-label={text.search}
            className="publicHeaderSearch"
            role="search"
          >
            <label className="srOnly" htmlFor="site-search">
              {text.search}
            </label>
            <input id="site-search" name="q" placeholder={text.searchPlaceholder} maxLength={120} />
            <button aria-label={text.search} type="submit">
              <AppIcon icon={Search} size={18} />
              <span>{text.search}</span>
            </button>
          </form>
          <Link className="publicLocaleSwitch" href={switchLocalePath(locale, pathname)}>
            {text.language}
          </Link>
        </div>
        <nav
          className="publicNav pageShell"
          aria-label={locale === "zh-Hans" ? "主要导航" : "Primary"}
        >
          <Link href={`/${locale}`}>{text.home}</Link>
          {Object.entries(PUBLIC_VERTICALS).map(([slug, type]) => (
            <Link href={`/${locale}/${slug}`} key={type}>
              {verticalLabel(locale, type)}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}

function optionLabel(label: string, count?: number): string {
  return count === undefined ? label : `${label} (${count})`;
}

function sortLabel(locale: Locale, sort: PublicListingFilters["sort"]): string {
  const labels: Readonly<Record<PublicListingFilters["sort"], Readonly<Record<Locale, string>>>> = {
    RELEVANCE: { "zh-Hans": "相关度", "en-US": "Relevance" },
    NEWEST: { "zh-Hans": "最新发布", "en-US": "Newest" },
    PRICE_ASC: { "zh-Hans": "价格从低到高", "en-US": "Price: low to high" },
    PRICE_DESC: { "zh-Hans": "价格从高到低", "en-US": "Price: high to low" },
  };
  return labels[sort][locale];
}

function precisionLabel(locale: Locale, precision: PublicListingView["location"]["precision"]) {
  const labels: Readonly<
    Record<PublicListingView["location"]["precision"], Readonly<Record<Locale, string>>>
  > = {
    CITY: { "zh-Hans": "城市", "en-US": "City" },
    NEIGHBORHOOD: { "zh-Hans": "社区", "en-US": "Neighborhood" },
    APPROXIMATE: { "zh-Hans": "近似位置", "en-US": "Approximate" },
    EXACT: { "zh-Hans": "精确位置已隐藏", "en-US": "Exact location hidden" },
  };
  return labels[precision][locale];
}

function FilterForm({
  locale,
  model,
  action,
  fixedType,
}: {
  locale: Locale;
  model: Extract<PublicListingIndexModel, { kind: "ready" }>;
  action: string;
  fixedType?: ListingType;
}) {
  const text = copy[locale];
  return (
    <form action={action} aria-label={text.filters} className="publicFilters" role="search">
      <div className="publicFilterTitle">
        <AppIcon icon={SlidersHorizontal} size={19} />
        <strong>{text.filters}</strong>
      </div>
      <label>
        <span>{text.query}</span>
        <input defaultValue={model.filters.q} maxLength={120} name="q" type="search" />
      </label>
      {!fixedType ? (
        <label>
          <span>{text.type}</span>
          <select defaultValue={model.filters.type} name="type">
            <option value="">{text.allTypes}</option>
            {model.typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {optionLabel(option.label, option.count)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>{text.category}</span>
        <select defaultValue={model.filters.categoryId} name="categoryId">
          <option value="">{text.allCategories}</option>
          {model.categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option.label, option.count)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.region}</span>
        <select defaultValue={model.filters.regionCode} name="regionCode">
          <option value="">{text.allRegions}</option>
          {model.regionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option.label, option.count)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.minPrice}</span>
        <input
          defaultValue={model.filters.minPrice}
          inputMode="decimal"
          name="minPrice"
          pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
        />
      </label>
      <label>
        <span>{text.maxPrice}</span>
        <input
          defaultValue={model.filters.maxPrice}
          inputMode="decimal"
          name="maxPrice"
          pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
        />
      </label>
      <label>
        <span>{text.sort}</span>
        <select defaultValue={model.filters.sort} name="sort">
          <option value="RELEVANCE">{text.relevance}</option>
          <option value="NEWEST">{text.newest}</option>
          <option value="PRICE_ASC">{text.priceAsc}</option>
          <option value="PRICE_DESC">{text.priceDesc}</option>
        </select>
      </label>
      <div className="publicFilterActions">
        <button type="submit">{text.apply}</button>
        <Link href={action}>{text.reset}</Link>
      </div>
    </form>
  );
}

function ListingCard({ locale, listing }: { locale: Locale; listing: PublicListingCard }) {
  const text = copy[locale];
  return (
    <article className="publicListingCard">
      <div className="publicListingBadges">
        <span className="publicStatusBadge">
          <AppIcon icon={CheckCircle2} size={14} /> {text.active}
        </span>
        {listing.sponsored ? (
          <span className="publicSponsoredBadge" aria-label={text.sponsored}>
            {text.sponsored}
          </span>
        ) : null}
        {listing.verified ? (
          <span className="publicVerifiedBadge">
            <AppIcon icon={BadgeCheck} size={14} /> {text.verified}
          </span>
        ) : null}
      </div>
      <div className="publicListingCardMain">
        <div>
          <p className="publicListingEyebrow">
            {locale === "zh-Hans" ? listing.category.nameZhHans : listing.category.nameEn}
          </p>
          <h2>
            <Link href={publicListingPath(locale, listing)}>
              <bdi>{listing.title}</bdi>
            </Link>
          </h2>
          {listing.summary ? (
            <p className="publicListingSummary">
              <bdi>{listing.summary}</bdi>
            </p>
          ) : null}
        </div>
        <strong className="publicListingPrice">{formatListingPrice(locale, listing.price)}</strong>
      </div>
      <dl className="publicListingMeta">
        <div>
          <dt>
            <AppIcon icon={MapPin} size={15} />
            <span className="srOnly">{text.city}</span>
          </dt>
          <dd>{locale === "zh-Hans" ? listing.region.nameZhHans : listing.region.nameEn}</dd>
        </div>
        <div>
          <dt>
            <AppIcon icon={UserRound} size={15} />
            <span className="srOnly">{text.publisher}</span>
          </dt>
          <dd>
            <bdi>{listing.ownerName}</bdi>
          </dd>
        </div>
        <div>
          <dt>
            <AppIcon icon={Clock3} size={15} />
            <span className="srOnly">{text.updated}</span>
          </dt>
          <dd>
            {text.updated} {formatListingDate(locale, listing.updatedAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function IndexState({
  locale,
  kind,
  firstPage,
}: {
  locale: Locale;
  kind: "invalid" | "cursor-expired" | "unavailable" | "not-found";
  firstPage: string;
}) {
  const text = copy[locale];
  const content = {
    invalid: [text.invalidTitle, text.invalidBody, text.reset],
    "cursor-expired": [text.cursorTitle, text.cursorBody, text.backToFirst],
    unavailable: [text.unavailableTitle, text.unavailableBody, text.retry],
    "not-found": [text.unknownCityTitle, text.invalidBody, text.backToFirst],
  } as const;
  const [title, body, action] = content[kind];
  return (
    <section className="publicState card" role={kind === "unavailable" ? "alert" : "status"}>
      <span aria-hidden="true">
        <AppIcon icon={Search} size={25} />
      </span>
      <h1>{title}</h1>
      <p>{body}</p>
      <Link href={firstPage}>{action}</Link>
    </section>
  );
}

export function PublicListingIndexView({
  locale,
  model,
  pathname,
  action,
  type,
  citySlug,
  includeStructuredData = false,
}: {
  locale: Locale;
  model: PublicListingIndexModel;
  pathname: string;
  action: string;
  type?: ListingType;
  citySlug?: string;
  includeStructuredData?: boolean;
}) {
  const text = copy[locale];
  const verticalTitle = type
    ? verticalLabel(locale, type)
    : locale === "zh-Hans"
      ? "全站公开信息"
      : "All public listings";
  const cityName =
    citySlug && model.kind === "ready"
      ? (model.regionOptions.find((option) => option.value === model.filters.regionCode)?.label ??
        citySlug)
      : citySlug;
  const title =
    cityName && type
      ? locale === "zh-Hans"
        ? `${cityName}${verticalTitle}`
        : `${cityName} ${verticalTitle}`
      : verticalTitle;
  const intro = type
    ? verticalIntro[type][locale]
    : locale === "zh-Hans"
      ? "搜索五类公开信息；所有结果均来自已发布且未过期的最小公开投影。"
      : "Search five public verticals. Results use only the minimal published, unexpired projection.";
  const hasMore = model.kind === "ready" && Boolean(model.nextCursor);
  const breadcrumb =
    includeStructuredData && type && model.kind === "ready"
      ? breadcrumbStructuredData(
          publicBreadcrumbItems(
            locale,
            type,
            verticalTitle,
            citySlug && cityName
              ? {
                  name: cityName,
                  path: pathname,
                }
              : undefined,
          ),
        )
      : null;

  return (
    <>
      {breadcrumb ? <StructuredData nodes={breadcrumb} /> : null}
      <PublicSiteHeader locale={locale} pathname={pathname} />
      <main className="publicListingPage pageShell" id="main-content" tabIndex={-1}>
        <nav
          className="publicBreadcrumbs"
          aria-label={locale === "zh-Hans" ? "面包屑" : "Breadcrumb"}
        >
          <Link href={`/${locale}`}>{text.home}</Link>
          {citySlug && type ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={publicVerticalPath(locale, type)}>{verticalTitle}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{cityName}</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{title}</span>
            </>
          )}
        </nav>
        <header className="publicListingHero">
          <div>
            <p>
              {locale === "zh-Hans" ? "南加州本地公开信息" : "Public Southern California listings"}
            </p>
            <h1>{title}</h1>
            <span>{intro}</span>
          </div>
          {type ? (
            <Link href={publicSearchPath(locale)}>
              <AppIcon icon={Search} size={17} />
              {text.search}
            </Link>
          ) : null}
        </header>

        {model.kind === "ready" ? (
          <div className="publicListingLayout">
            <aside aria-label={text.filters}>
              <FilterForm action={action} fixedType={type} locale={locale} model={model} />
            </aside>
            <section className="publicResults" aria-labelledby="public-results-heading">
              {model.degraded ? (
                <div className="publicNotice isWarning" role="status">
                  {text.degraded}
                </div>
              ) : null}
              {model.taxonomyDegraded ? (
                <div className="publicNotice" role="status">
                  {text.taxonomyDegraded}
                </div>
              ) : null}
              {model.correctedQuery ? (
                <div className="publicNotice" role="status">
                  {text.corrected(model.correctedQuery)}
                </div>
              ) : null}
              <div className="publicResultsHeader">
                <h2 id="public-results-heading">{text.resultCount(model.items.length, hasMore)}</h2>
                <span>
                  {text.sort}: {sortLabel(locale, model.filters.sort)}
                </span>
              </div>
              {model.items.length === 0 ? (
                <div className="publicEmpty card" role="status">
                  <AppIcon icon={Search} size={28} />
                  <h2>{text.emptyTitle}</h2>
                  <p>{text.emptyBody}</p>
                  <Link href={action}>{text.reset}</Link>
                </div>
              ) : (
                <div className="publicListingCards">
                  {model.items.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} locale={locale} />
                  ))}
                </div>
              )}
              {model.nextCursor ? (
                <Link
                  className="publicLoadMore"
                  href={nextPagePath(pathname, model.filters, model.nextCursor)}
                  rel="nofollow"
                >
                  {text.loadMore}
                </Link>
              ) : null}
            </section>
          </div>
        ) : (
          <IndexState firstPage={action} kind={model.kind} locale={locale} />
        )}
      </main>
    </>
  );
}

function detailBadges(locale: Locale, listing: PublicListingView) {
  const text = copy[locale];
  return (
    <div className="publicListingBadges">
      <span className="publicStatusBadge">
        <AppIcon icon={CheckCircle2} size={14} /> {text.active}
      </span>
      {listing.featured ? (
        <span className="publicSponsoredBadge" aria-label={text.sponsored}>
          {text.sponsored}
        </span>
      ) : null}
      {listing.organization?.verificationStatus === "VERIFIED" ? (
        <span className="publicVerifiedBadge">
          <AppIcon icon={BadgeCheck} size={14} /> {text.verified}
        </span>
      ) : null}
    </div>
  );
}

export function PublicListingDetailView({
  locale,
  listing,
  pathname,
  includeStructuredData = false,
}: {
  locale: Locale;
  listing: PublicListingView;
  pathname: string;
  includeStructuredData?: boolean;
}) {
  const text = copy[locale];
  const categoryName = locale === "zh-Hans" ? listing.category.nameZhHans : listing.category.nameEn;
  const regionName = locale === "zh-Hans" ? listing.region.nameZhHans : listing.region.nameEn;
  const attributes = publicAttributeEntries(locale, listing.attributes);
  const structuredNodes: StructuredDataNode[] = [];
  if (includeStructuredData) {
    const breadcrumb = breadcrumbStructuredData(
      publicBreadcrumbItems(locale, listing.type, verticalLabel(locale, listing.type), undefined, {
        name: text.detail,
        path: pathname,
      }),
    );
    const jobPosting = jobPostingStructuredData(locale, listing, pathname);
    if (breadcrumb) structuredNodes.push(breadcrumb);
    if (jobPosting) structuredNodes.push(jobPosting);
  }

  return (
    <>
      {structuredNodes.length > 0 ? <StructuredData nodes={structuredNodes} /> : null}
      <PublicSiteHeader locale={locale} pathname={pathname} />
      <main className="publicDetailPage pageShell" id="main-content" tabIndex={-1}>
        <nav
          className="publicBreadcrumbs"
          aria-label={locale === "zh-Hans" ? "面包屑" : "Breadcrumb"}
        >
          <Link href={`/${locale}`}>{text.home}</Link>
          <span aria-hidden="true">/</span>
          <Link href={publicVerticalPath(locale, listing.type)}>
            {verticalLabel(locale, listing.type)}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{text.detail}</span>
        </nav>
        <Link className="publicBackLink" href={publicVerticalPath(locale, listing.type)}>
          <AppIcon icon={ArrowLeft} size={17} />
          {verticalLabel(locale, listing.type)}
        </Link>
        <div className="publicDetailLayout">
          <article className="publicDetailMain card">
            {detailBadges(locale, listing)}
            <p className="publicListingEyebrow">{categoryName}</p>
            <h1>
              <bdi>{listing.title}</bdi>
            </h1>
            {listing.summary ? (
              <p className="publicDetailSummary">
                <bdi>{listing.summary}</bdi>
              </p>
            ) : null}
            <strong className="publicDetailPrice">
              {formatListingPrice(locale, listing.price)}
            </strong>
            <dl className="publicDetailMeta">
              <div>
                <dt>
                  <AppIcon icon={MapPin} size={17} /> {text.city}
                </dt>
                <dd>{regionName}</dd>
              </div>
              <div>
                <dt>
                  <AppIcon icon={CalendarDays} size={17} /> {text.published}
                </dt>
                <dd>{formatListingDate(locale, listing.publishedAt)}</dd>
              </div>
              <div>
                <dt>
                  <AppIcon icon={Clock3} size={17} /> {text.expires}
                </dt>
                <dd>{formatListingDate(locale, listing.expiresAt)}</dd>
              </div>
            </dl>
            {attributes.length > 0 ? (
              <section className="publicDetailSection" aria-labelledby="listing-facts">
                <h2 id="listing-facts">{text.facts}</h2>
                <dl className="publicFacts">
                  {attributes.map((attribute) => (
                    <div key={attribute.label}>
                      <dt>{attribute.label}</dt>
                      <dd>
                        <bdi>{attribute.value}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            <section className="publicDetailSection" aria-labelledby="listing-description">
              <h2 id="listing-description">{text.body}</h2>
              <div className="publicDetailBody">
                <bdi>{listing.body}</bdi>
              </div>
            </section>
          </article>
          <aside className="publicDetailAside">
            <section className="card publicPublisherCard" aria-labelledby="listing-publisher">
              <span aria-hidden="true">
                <AppIcon icon={UserRound} size={24} />
              </span>
              <div>
                <h2 id="listing-publisher">{text.publisher}</h2>
                <strong>
                  <bdi>{listing.owner.displayName}</bdi>
                </strong>
              </div>
              {listing.organization?.verificationStatus === "VERIFIED" ? (
                <p>
                  <AppIcon icon={BadgeCheck} size={16} /> {text.verified}
                </p>
              ) : null}
            </section>
            <section className="card publicSafetyCard" aria-labelledby="listing-safety">
              <AppIcon icon={ShieldCheck} size={25} />
              <h2 id="listing-safety">{text.safety}</h2>
              <p>{text.safetyBody}</p>
            </section>
            <dl className="card publicDetailTechnical">
              <div>
                <dt>{text.locationPrecision}</dt>
                <dd>{precisionLabel(locale, listing.location.precision)}</dd>
              </div>
              <div>
                <dt>{text.listingLanguage}</dt>
                <dd>{listing.locale}</dd>
              </div>
              <div>
                <dt>{text.categoryLabel}</dt>
                <dd>{categoryName}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </main>
    </>
  );
}

export function PublicListingDetailUnavailable({
  locale,
  pathname,
  firstPage,
}: {
  locale: Locale;
  pathname: string;
  firstPage: string;
}) {
  const text = copy[locale];
  return (
    <>
      <PublicSiteHeader locale={locale} pathname={pathname} />
      <main className="publicDetailPage pageShell" id="main-content" tabIndex={-1}>
        <section className="publicState card" role="alert">
          <AppIcon icon={ShieldCheck} size={28} />
          <h1>{text.unavailableTitle}</h1>
          <p>{text.detailUnavailable}</p>
          <Link href={firstPage}>{text.backToFirst}</Link>
        </section>
      </main>
    </>
  );
}

export function isPublicVertical(value: string): value is PublicVertical {
  return value in PUBLIC_VERTICALS;
}

export function filtersArePresent(filters: PublicListingFilters): boolean {
  return Boolean(
    filters.q ||
    filters.categoryId ||
    filters.regionCode ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.sort !== "RELEVANCE",
  );
}
