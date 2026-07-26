import Link from "next/link";
import {
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  CircleHelp,
  Heart,
  Languages,
  MapPin,
  Megaphone,
  Package,
  Pin,
  Search,
  Star,
  Store,
  User,
  UserPlus,
  Warehouse,
  Zap,
} from "lucide-react";
import { AppIcon } from "@/components/icons/app-icon";
import { AvatarWithFallback } from "@/components/icons/avatar-with-fallback";
import { CategoryShortcut } from "@/components/icons/category-shortcut";
import { IconButton } from "@/components/icons/icon-button";
import { QuickPublishItem } from "@/components/icons/quick-publish-item";
import { ServiceEntry } from "@/components/icons/service-entry";
import {
  categoryShortcuts,
  cities,
  latestJobs,
  latestRentals,
  latestSecondhand,
  latestTransfers,
  merchants,
  portalEntries,
  primaryNav,
  providers,
  quickPublish,
  trustEntries,
  valueServices,
  type ListingRow,
} from "@/data/homepage";
import { localizedPath, loginRedirect, ROUTES } from "@/data/routes";

function SectionTitle({
  title,
  action = "更多",
  href,
}: {
  title: string;
  action?: string;
  href: string;
}) {
  return (
    <div className="sectionTitle">
      <h2>{title}</h2>
      <Link className="textButton" href={href}>
        {action}
      </Link>
    </div>
  );
}

function ListingCard({ title, rows, href }: { title: string; rows: ListingRow[]; href: string }) {
  return (
    <section className="card listingCard">
      <SectionTitle href={href} title={title} />
      <div className="listingRows">
        {rows.map((row) => (
          <Link className="listingRow" href={href} key={`${title}-${row.title}`}>
            <span className="listingName" title={row.title}>
              {row.title}
            </span>
            {row.meta ? <span className="mutedMeta">{row.meta}</span> : null}
            {row.price ? <strong className="priceText">{row.price}</strong> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Header({ locale }: { locale: string }) {
  const path = (route: string) => localizedPath(locale, route);

  return (
    <header className="siteHeader">
      <div className="headerTop pageShell">
        <Link className="brand" href={path(ROUTES.home)} aria-label="南加生活网首页">
          <span className="brandMark">
            <AppIcon icon={MapPin} size={25} />
          </span>
          <span>
            <strong>南加生活网</strong>
            <small>SoCalCHINESE.com</small>
          </span>
        </Link>
        <Link className="locationButton" href={`${path(ROUTES.home)}?region=los-angeles`}>
          <AppIcon icon={MapPin} size={21} />
          <span>
            <strong>洛杉矶 / 南加州</strong>
            <small>Los Angeles / SoCal</small>
          </span>
          <AppIcon icon={ChevronDown} size={15} />
        </Link>
        <form action={path(ROUTES.classified)} className="searchBar" role="search">
          <input
            aria-label="搜索"
            name="q"
            placeholder="找工作、租房、转让、二手、师傅、商家、优惠…"
          />
          <button type="submit">
            <AppIcon icon={Search} size={17} /> 搜索
          </button>
        </form>
        <div className="headerActions" aria-label="账户操作">
          <Link className="languageAction" href={locale === "en-US" ? "/zh-Hans" : "/en-US"}>
            <AppIcon icon={Languages} size={16} /> 中文 / English
          </Link>
          <IconButton href={path(ROUTES.messages)} icon={Bell} label="消息" />
          <IconButton href={path(ROUTES.favorites)} icon={Heart} label="收藏" />
          <IconButton href={path(ROUTES.login)} icon={User} label="登录" />
          <Link className="registerButton" href={path(ROUTES.register)}>
            <AppIcon icon={UserPlus} size={16} /> 注册
          </Link>
        </div>
      </div>
      <nav className="primaryNav pageShell" aria-label="主导航">
        {primaryNav.map(([label, href], index) => (
          <Link className={index === 0 ? "active" : ""} href={path(href)} key={label}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function QuickPublish({ locale }: { locale: string }) {
  return (
    <aside className="card quickPublish" aria-label="快速发布">
      <h2>
        <AppIcon icon={Zap} size={18} /> 快速发布
      </h2>
      {quickPublish.map((item) => (
        <QuickPublishItem
          item={{ ...item, href: localizedPath(locale, item.href) }}
          key={item.key}
        />
      ))}
      <Link className="morePublish" href={localizedPath(locale, ROUTES.classified)}>
        更多发布类型
      </Link>
    </aside>
  );
}

function Hero({ locale }: { locale: string }) {
  const stats = [
    ["今日更新", "2,318"],
    ["本周新增", "15,842"],
    ["总信息数", "256,893"],
    ["注册用户", "78,650"],
    ["商家入驻", "5,632"],
    ["师傅入驻", "4,187"],
  ];
  return (
    <section className="heroCard">
      <div className="heroBackdrop" aria-hidden="true">
        <span className="sunDisc" />
        <span className="skyline skylineA" />
        <span className="skyline skylineB" />
      </div>
      <div className="heroContent">
        <h1>洛杉矶华人生活 一站式服务平台</h1>
        <p>连接南加华人，让生活更简单！</p>
        <div className="hotSearches">
          <span>热门搜索：</span>
          {["尔湾租房", "工作招聘", "店铺转让", "二手家具", "美甲师", "装修师傅", "仓库出租"].map(
            (item) => (
              <Link
                href={`${localizedPath(locale, ROUTES.classified)}?q=${encodeURIComponent(item)}`}
                key={item}
              >
                {item}
              </Link>
            ),
          )}
        </div>
        <div className="heroStats">
          {stats.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HotRank({ locale }: { locale: string }) {
  return (
    <section className="card hotRank">
      <SectionTitle
        action="查看全部"
        href={localizedPath(locale, ROUTES.classified)}
        title="热门搜索排行榜"
      />
      <ol>
        {[
          "尔湾租房 Irvine",
          "招聘服务员 / 厨师",
          "美甲师 / 美睫师",
          "店铺转让 / 奶茶店",
          "装修 / 水电工",
        ].map((item, index) => (
          <li key={item}>
            <span className={index < 3 ? "rank hot" : "rank"}>{index + 1}</span>
            <Link
              href={`${localizedPath(locale, ROUTES.classified)}?q=${encodeURIComponent(item)}`}
            >
              {item}
            </Link>
            <small>{["12,680", "9,842", "7,621", "6,352", "5,988"][index]}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CityAndPinned({ locale }: { locale: string }) {
  return (
    <div className="rightTopStack">
      <section className="card cityCard">
        <SectionTitle href={localizedPath(locale, ROUTES.classified)} title="热门城市" />
        <div className="cityGrid">
          {cities.map((city) => (
            <Link
              href={`${localizedPath(locale, ROUTES.classified)}?city=${encodeURIComponent(city)}`}
              key={city}
            >
              {city}
            </Link>
          ))}
        </div>
      </section>
      <section className="card pinnedCard">
        <SectionTitle href={localizedPath(locale, ROUTES.classified)} title="置顶信息" />
        {[
          ["尔湾餐馆转让", "客流稳定", "$120,000"],
          ["工业市仓库出租", "2000尺起", "$2,500/月"],
          ["招聘全职美甲师", "高薪", "面议"],
        ].map(([title, note, price]) => (
          <Link className="pinnedRow" href={localizedPath(locale, ROUTES.classified)} key={title}>
            <span>
              <AppIcon icon={Pin} size={12} />
            </span>
            <strong>{title}</strong>
            <small>{note}</small>
            <b>{price}</b>
          </Link>
        ))}
      </section>
    </div>
  );
}

function IconDirectory({ locale }: { locale: string }) {
  return (
    <section className="card iconDirectory" aria-label="功能入口">
      {categoryShortcuts.map((item) => (
        <CategoryShortcut
          item={{ ...item, href: localizedPath(locale, item.href) }}
          key={item.key}
        />
      ))}
    </section>
  );
}

function SupportingContent({ locale }: { locale: string }) {
  const path = (route: string) => localizedPath(locale, route);
  return (
    <div className="lowerGrid">
      <section className="card demandCard">
        <SectionTitle href={path(ROUTES.services)} title="需求大厅 / 报价需求" />
        {[
          ["找装修师傅", "翻新2房1卫", "2分钟前"],
          ["找招聘安装", "亚克力发光字", "15分钟前"],
          ["找会计", "月结记账报税", "32分钟前"],
          ["找店铺", "求租核桃市店面", "1小时前"],
        ].map(([title, detail, time]) => (
          <Link className="demandRow" href={path(ROUTES.services)} key={title}>
            <span>
              <AppIcon icon={Search} size={11} />
            </span>
            <strong>{title}</strong>
            <small>{detail}</small>
            <time>{time}</time>
          </Link>
        ))}
      </section>
      <section className="card priceCenter">
        <SectionTitle href={path(ROUTES.classified)} title="价格参考 / 行情中心" />
        <div className="metricGrid">
          {[
            ["租房价格", "$1,850", "尔湾一房平均租金/月"],
            ["工资行情", "$22.45", "餐厅服务员平均时薪"],
            ["装修报价", "$120", "厨房翻新/平方英尺"],
            ["招聘价格", "$25/平方", "发光字安装参考价"],
            ["商铺租金", "$3.20/尺", "圣盖博商铺平均租金"],
          ].map(([label, value, note]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
              <b>近期更新</b>
            </article>
          ))}
        </div>
      </section>
      <section className="card industryZones">
        <SectionTitle href={path(ROUTES.businesses)} title="老板专区 / 行业专区" />
        <div className="zoneGrid">
          {[
            ["批发货源区", Boxes],
            ["餐饮加盟专区", Store],
            ["仓库物流专区", Warehouse],
            ["开店服务中心", Building2],
            ["商业设备专区", Package],
          ].map(([label, icon], index) => (
            <Link
              className={`zone zone${index + 1}`}
              href={path(ROUTES.businesses)}
              key={label as string}
            >
              <AppIcon icon={icon as typeof Store} size={21} />
              <strong>{label as string}</strong>
            </Link>
          ))}
        </div>
      </section>
      <section className="card crossBorder">
        <SectionTitle href={path(ROUTES.marketplace)} title="国内端口 / 跨境货源" />
        <div className="productGrid">
          {["休闲零食", "奶茶原料", "一次性餐具"].map((name) => (
            <Link href={path(ROUTES.marketplace)} key={name}>
              <div>
                <AppIcon icon={Package} size={28} />
              </div>
              <strong>{name}</strong>
              <span>查看合规货源</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function RightRail({ locale }: { locale: string }) {
  const path = (route: string) => localizedPath(locale, route);
  return (
    <aside className="rightRail">
      <section className="adCard">
        <span className="adBadge">AD</span>
        <h2>首页广告位合作</h2>
        <p>曝光精准 · 流量稳定 · 数据透明</p>
        <Link href={path(ROUTES.advertising)}>了解广告方案</Link>
        <AppIcon className="megaphone" icon={Megaphone} size={55} />
      </section>
      <section className="card merchantCard">
        <SectionTitle href={path(ROUTES.businesses)} title="优质商家" />
        <div className="merchantGrid">
          {merchants.map((name) => (
            <Link href={path(ROUTES.businesses)} key={name}>
              <AvatarWithFallback name={name} size={42} />
              <strong>{name}</strong>
              <small>
                <AppIcon icon={Star} size={10} /> 评分待接入
              </small>
            </Link>
          ))}
        </div>
      </section>
      <section className="card providersCard">
        <SectionTitle href={path(ROUTES.professionals)} title="推荐师傅" />
        <div className="providerProfiles">
          {providers.map(([name, service, rating]) => (
            <Link href={path(ROUTES.professionals)} key={name}>
              <AvatarWithFallback name={name} size={48} />
              <strong>{name}</strong>
              <span>{service}</span>
              <small>
                <AppIcon icon={Star} size={10} /> {rating}
              </small>
            </Link>
          ))}
        </div>
      </section>
      <section className="card walletCard">
        <SectionTitle href={path(ROUTES.points)} title="积分充值 / 增值服务" />
        <div className="walletGrid">
          {valueServices.map((item) => (
            <ServiceEntry item={{ ...item, href: path(item.href) }} key={item.key} />
          ))}
        </div>
      </section>
    </aside>
  );
}

function TrustAndPortals({ locale }: { locale: string }) {
  return (
    <>
      <section className="trustRow pageShell card">
        <div className="trustIntro">
          <h2>平台保障 · 安心使用</h2>
        </div>
        {trustEntries.map((item) => (
          <ServiceEntry item={{ ...item, href: localizedPath(locale, item.href) }} key={item.key} />
        ))}
      </section>
      <section className="portalRow pageShell card">
        <h2>
          平台后台入口 <small>（登录后使用）</small>
        </h2>
        {portalEntries.map((item) => (
          <ServiceEntry
            item={{
              ...item,
              href: item.requiresAuth
                ? loginRedirect(locale, item.href)
                : localizedPath(locale, item.href),
            }}
            key={item.key}
          />
        ))}
      </section>
    </>
  );
}

function Footer({ locale }: { locale: string }) {
  const links = [
    ["关于我们", ROUTES.about],
    ["联系我们", ROUTES.contact],
    ["隐私政策", ROUTES.privacy],
    ["用户协议", ROUTES.terms],
    ["帮助中心", ROUTES.help],
    ["网站地图", ROUTES.sitemap],
    ["商家入驻", ROUTES.businesses],
    ["师傅入驻", ROUTES.professionals],
    ["广告合作", ROUTES.advertising],
  ] as const;
  return (
    <footer className="siteFooter pageShell card">
      <div className="footerBrand">
        <span>
          <AppIcon icon={MapPin} size={22} />
        </span>
        <strong>
          南加生活网<small>SoCalCHINESE.com</small>
        </strong>
      </div>
      <nav>
        {links.map(([label, href]) => (
          <Link href={localizedPath(locale, href)} key={label}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="footerLegal">© 2026 南加生活网 · 架构原型</div>
      <Link className="footerHelp" href={localizedPath(locale, ROUTES.help)}>
        <AppIcon icon={CircleHelp} size={24} />
        <span>
          帮助中心
          <br />
          获取更多信息
        </span>
      </Link>
    </footer>
  );
}

export function HomePage({ locale = "zh-Hans" }: { locale?: string }) {
  const path = (route: string) => localizedPath(locale, route);
  return (
    <>
      <Header locale={locale} />
      <main className="pageShell homeLayout">
        <QuickPublish locale={locale} />
        <div className="centerColumn">
          <div className="heroRow">
            <Hero locale={locale} />
            <HotRank locale={locale} />
          </div>
          <IconDirectory locale={locale} />
          <div className="fourCards">
            <ListingCard href={path(ROUTES.jobs)} rows={latestJobs} title="最新招聘" />
            <ListingCard href={path(ROUTES.housingRent)} rows={latestRentals} title="最新房源" />
            <ListingCard
              href={path(ROUTES.businessTransfer)}
              rows={latestTransfers}
              title="最新转让"
            />
            <ListingCard href={path(ROUTES.marketplace)} rows={latestSecondhand} title="最新二手" />
          </div>
          <SupportingContent locale={locale} />
        </div>
        <div className="rightColumn">
          <CityAndPinned locale={locale} />
          <RightRail locale={locale} />
        </div>
      </main>
      <TrustAndPortals locale={locale} />
      <Footer locale={locale} />
    </>
  );
}
