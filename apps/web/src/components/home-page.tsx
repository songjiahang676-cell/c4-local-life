import Link from "next/link";
import { CircleHelp, MapPin, Search, Zap } from "lucide-react";
import type {
  HomepageCitiesModule,
  HomepageHeroModule,
  HomepageHotSearchesModule,
  HomepageListingFeedModule,
  HomepageModule,
  ListingType,
  Locale,
  PublicListingSummaryView,
} from "@socal/contracts";
import { AppIcon } from "./icons/app-icon";
import { CategoryShortcut } from "./icons/category-shortcut";
import { GlobalSiteHeader } from "./global-site-header";
import { QuickPublishItem } from "./icons/quick-publish-item";
import { categoryEntries, quickPublishEntries } from "../data/homepage";
import { localizedPath, ROUTES } from "../data/routes";
import type { HomepageModel } from "../lib/homepage";
import { StructuredData, websiteStructuredData } from "../lib/structured-data";
import {
  formatListingPrice,
  publicListingPath,
  publicVerticalPath,
  verticalLabel,
} from "../lib/public-listings";

type Copy = Readonly<{
  search: string;
  quickPublish: string;
  allPublish: string;
  directories: string;
  trending: string;
  cities: string;
  more: string;
  sponsored: string;
  unavailableTitle: string;
  unavailableBody: string;
  partialNotice: string;
  about: string;
  privacy: string;
  terms: string;
  help: string;
}>;

const copy: Readonly<Record<Locale, Copy>> = {
  "zh-Hans": {
    search: "搜索",
    quickPublish: "快速发布",
    allPublish: "查看全部发布类型",
    directories: "信息分类",
    trending: "热门搜索",
    cities: "服务城市",
    more: "查看更多",
    sponsored: "推广",
    unavailableTitle: "首页内容暂时不可用",
    unavailableBody: "请稍后刷新，或直接浏览各分类信息。",
    partialNotice: "部分首页模块暂时不可用，其余内容仍可正常浏览。",
    about: "关于我们",
    privacy: "隐私政策",
    terms: "用户协议",
    help: "帮助中心",
  },
  "en-US": {
    search: "Search",
    quickPublish: "Post information",
    allPublish: "View all posting options",
    directories: "Browse categories",
    trending: "Trending searches",
    cities: "Cities served",
    more: "View more",
    sponsored: "Sponsored",
    unavailableTitle: "Homepage content is temporarily unavailable",
    unavailableBody: "Refresh shortly, or browse a listing category directly.",
    partialNotice: "Some homepage modules are temporarily unavailable. Other content is current.",
    about: "About",
    privacy: "Privacy",
    terms: "Terms",
    help: "Help",
  },
};

function modulesOfKind<K extends HomepageModule["kind"]>(
  model: HomepageModel,
  kind: K,
): readonly Extract<HomepageModule, { kind: K }>[] {
  if (model.kind !== "ready") return [];
  return model.response.modules.filter(
    (module): module is Extract<HomepageModule, { kind: K }> => module.kind === kind,
  );
}

function QuickPublish({ locale }: { locale: Locale }) {
  const labels = copy[locale];
  return (
    <aside className="card quickPublish" aria-label={labels.quickPublish}>
      <h2>
        <AppIcon icon={Zap} size={18} /> {labels.quickPublish}
      </h2>
      {quickPublishEntries(locale).map((entry) => (
        <QuickPublishItem
          item={{ ...entry, href: localizedPath(locale, entry.href) }}
          key={entry.key}
        />
      ))}
      <Link className="morePublish" href={localizedPath(locale, ROUTES.classified)}>
        {labels.allPublish}
      </Link>
    </aside>
  );
}

function Hero({ module, locale }: { module: HomepageHeroModule; locale: Locale }) {
  return (
    <section className="heroCard" data-module-key={module.key}>
      <div className="heroContent">
        <h1>{module.data.title}</h1>
        <p>{module.data.subtitle}</p>
        <form
          action={localizedPath(locale, ROUTES.classified)}
          className="homepageHeroSearch"
          role="search"
        >
          <input
            aria-label={module.data.searchPlaceholder}
            name="q"
            placeholder={module.data.searchPlaceholder}
          />
          <button type="submit">
            <AppIcon icon={Search} size={17} /> {copy[locale].search}
          </button>
        </form>
      </div>
    </section>
  );
}

function Trending({ module, locale }: { module: HomepageHotSearchesModule; locale: Locale }) {
  return (
    <section className="card hotRank" data-module-key={module.key}>
      <h2>{copy[locale].trending}</h2>
      <ol>
        {module.data.items.map((item) => (
          <li key={item.query}>
            <span className={item.rank <= 3 ? "rank hot" : "rank"}>{item.rank}</span>
            <Link
              href={`${localizedPath(locale, ROUTES.classified)}?q=${encodeURIComponent(item.query)}`}
            >
              {item.query}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CityModule({ module, locale }: { module: HomepageCitiesModule; locale: Locale }) {
  return (
    <section className="card cityCard" data-module-key={module.key}>
      <h2>{copy[locale].cities}</h2>
      <div className="cityGrid">
        {module.data.items.map((city) => (
          <Link
            href={`${localizedPath(locale, ROUTES.classified)}?regionCode=${encodeURIComponent(city.code)}`}
            key={city.id}
          >
            {city.name}
          </Link>
        ))}
      </div>
    </section>
  );
}

function listingModuleTitle(locale: Locale, type: ListingType): string {
  return locale === "zh-Hans"
    ? `最新${verticalLabel(locale, type)}`
    : `Latest ${verticalLabel(locale, type)}`;
}

function ListingRow({ listing, locale }: { listing: PublicListingSummaryView; locale: Locale }) {
  return (
    <Link className="listingRow homepageListingRow" href={publicListingPath(locale, listing)}>
      <span className="listingName" title={listing.title}>
        {listing.title}
      </span>
      {listing.featured ? (
        <span className="homepageSponsored">{copy[locale].sponsored}</span>
      ) : null}
      <strong className="priceText">{formatListingPrice(locale, listing.price)}</strong>
    </Link>
  );
}

function ListingModule({ module, locale }: { module: HomepageListingFeedModule; locale: Locale }) {
  return (
    <section className="card listingCard" data-module-key={module.key}>
      <div className="sectionTitle">
        <h2>{listingModuleTitle(locale, module.data.listingType)}</h2>
        <Link className="textButton" href={publicVerticalPath(locale, module.data.listingType)}>
          {copy[locale].more}
        </Link>
      </div>
      <div className="listingRows">
        {module.data.items.map((listing) => (
          <ListingRow key={listing.id} listing={listing} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function Directory({ locale }: { locale: Locale }) {
  return (
    <section className="card iconDirectory" aria-label={copy[locale].directories}>
      {categoryEntries(locale).map((entry) => (
        <CategoryShortcut
          item={{ ...entry, href: localizedPath(locale, entry.href) }}
          key={entry.key}
        />
      ))}
    </section>
  );
}

function Footer({ locale }: { locale: Locale }) {
  const labels = copy[locale];
  const links = [
    [labels.about, ROUTES.about],
    [labels.privacy, ROUTES.privacy],
    [labels.terms, ROUTES.terms],
    [labels.help, ROUTES.help],
  ] as const;
  return (
    <footer className="siteFooter pageShell card">
      <div className="footerBrand">
        <span>
          <AppIcon icon={MapPin} size={22} />
        </span>
        <strong>{locale === "zh-Hans" ? "南加生活网" : "SoCal Life"}</strong>
      </div>
      <nav aria-label={labels.help}>
        {links.map(([label, href]) => (
          <Link href={localizedPath(locale, href)} key={href}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="footerLegal">© 2026 SoCal Life</div>
      <Link className="footerHelp" href={localizedPath(locale, ROUTES.help)}>
        <AppIcon icon={CircleHelp} size={24} />
        <span>{labels.help}</span>
      </Link>
    </footer>
  );
}

export function HomePage({
  locale,
  model,
  includeStructuredData = false,
}: {
  locale: Locale;
  model: HomepageModel;
  includeStructuredData?: boolean;
}) {
  const heroes = modulesOfKind(model, "HERO");
  const trending = modulesOfKind(model, "HOT_SEARCHES");
  const cities = modulesOfKind(model, "CITY_CHIPS");
  const listings = modulesOfKind(model, "LISTING_FEED");
  return (
    <>
      {includeStructuredData ? <StructuredData nodes={websiteStructuredData(locale)} /> : null}
      <GlobalSiteHeader locale={locale} pathname={`/${locale}`} />
      <main className="pageShell homeLayout homepageRealData" id="main-content" tabIndex={-1}>
        <QuickPublish locale={locale} />
        <div className="centerColumn">
          {model.kind === "unavailable" || heroes.length === 0 ? (
            <section className="card homepageUnavailable">
              <h1>{copy[locale].unavailableTitle}</h1>
              <p>{copy[locale].unavailableBody}</p>
            </section>
          ) : (
            <div className="heroRow">
              <Hero locale={locale} module={heroes[0] as HomepageHeroModule} />
              {trending[0] ? <Trending locale={locale} module={trending[0]} /> : null}
            </div>
          )}
          {model.kind === "ready" && model.response.partial ? (
            <p className="homepagePartialNotice" role="status">
              {copy[locale].partialNotice}
            </p>
          ) : null}
          <Directory locale={locale} />
          {listings.length > 0 ? (
            <div className="fourCards homepageListingGrid">
              {listings.map((module) => (
                <ListingModule key={module.key} locale={locale} module={module} />
              ))}
            </div>
          ) : null}
        </div>
        <aside className="rightColumn homepageRightRail">
          {cities.map((module) => (
            <CityModule key={module.key} locale={locale} module={module} />
          ))}
        </aside>
      </main>
      <Footer locale={locale} />
    </>
  );
}
