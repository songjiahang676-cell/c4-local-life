import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import type { Locale } from "@socal/contracts";
import { AppIcon } from "@/components/icons/app-icon";
import { isSupportedLocale, privatePageMetadata } from "@/lib/seo";

const PAGE_TITLES: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  news: { "zh-Hans": "新闻资讯", "en-US": "Local News" },
  jobs: { "zh-Hans": "招聘招工", "en-US": "Jobs" },
  resumes: { "zh-Hans": "求职简历", "en-US": "Resumes" },
  housing: { "zh-Hans": "房屋信息", "en-US": "Housing" },
  commercial: { "zh-Hans": "商铺出租", "en-US": "Commercial Rentals" },
  "business-transfer": { "zh-Hans": "店铺转让", "en-US": "Business Transfers" },
  marketplace: { "zh-Hans": "二手物品", "en-US": "Marketplace" },
  services: { "zh-Hans": "本地服务", "en-US": "Local Services" },
  professionals: { "zh-Hans": "本地师傅", "en-US": "Local Professionals" },
  businesses: { "zh-Hans": "商家黄页", "en-US": "Business Directory" },
  food: { "zh-Hans": "美食分享", "en-US": "Food" },
  forum: { "zh-Hans": "本地论坛", "en-US": "Local Forum" },
  questions: { "zh-Hans": "本地问答", "en-US": "Local Questions" },
  events: { "zh-Hans": "本地活动", "en-US": "Local Events" },
  deals: { "zh-Hans": "商家优惠", "en-US": "Local Deals" },
  classified: { "zh-Hans": "分类信息", "en-US": "Classifieds" },
  messages: { "zh-Hans": "站内消息", "en-US": "Messages" },
  favorites: { "zh-Hans": "我的收藏", "en-US": "Favorites" },
  points: { "zh-Hans": "积分与增值服务", "en-US": "Points and Add-ons" },
  advertising: { "zh-Hans": "广告推广", "en-US": "Advertising" },
  login: { "zh-Hans": "登录", "en-US": "Sign In" },
  register: { "zh-Hans": "注册", "en-US": "Register" },
  account: { "zh-Hans": "用户中心", "en-US": "Account" },
  portal: { "zh-Hans": "平台后台", "en-US": "Platform Portal" },
  help: { "zh-Hans": "帮助中心", "en-US": "Help Center" },
  about: { "zh-Hans": "关于我们", "en-US": "About" },
  contact: { "zh-Hans": "联系我们", "en-US": "Contact" },
  privacy: { "zh-Hans": "隐私政策", "en-US": "Privacy Policy" },
  terms: { "zh-Hans": "用户协议", "en-US": "Terms of Use" },
  sitemap: { "zh-Hans": "网站地图", "en-US": "Site Map" },
};

function landingTitle(locale: Locale, section: string): string {
  return (
    PAGE_TITLES[section]?.[locale] ??
    (locale === "zh-Hans" ? "南加生活服务" : "Southern California Local Services")
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug = [] } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const section = slug[0] ?? "classified";
  const pathname = `/${locale}/${slug.map((segment) => encodeURIComponent(segment)).join("/")}`;
  return privatePageMetadata(
    locale,
    landingTitle(locale, section),
    pathname,
    locale === "zh-Hans"
      ? "该页面尚未接入经过验证的公开数据，因此不会被搜索引擎索引。"
      : "This page is not indexed until its verified public data source is connected.",
  );
}

export default async function LandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug?: string[] }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { locale: rawLocale, slug = [] } = await params;
  const { returnTo } = await searchParams;
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const section = slug[0] ?? "classified";
  const title = landingTitle(locale, section);
  const isLogin = section === "login";
  const english = locale === "en-US";

  return (
    <main className="landingPage pageShell" id="main-content" tabIndex={-1}>
      <Link className="landingBack" href={`/${locale}`}>
        <AppIcon icon={ArrowLeft} size={17} /> {english ? "Back to home" : "返回首页"}
      </Link>
      <section className="card landingHero">
        <span className="landingIcon">
          <AppIcon icon={Search} size={24} />
        </span>
        <div>
          <h1>{title}</h1>
          <p>
            {isLogin
              ? english
                ? "Sign-in will open after the identity flow is connected. You will return safely to the requested page."
                : "登录功能将在身份系统接入后开放。完成登录后会安全返回你原本要访问的页面。"
              : english
                ? "This accessible route is a skeleton. Real results will appear only after the corresponding API is connected."
                : "该入口已建立可访问的页面骨架，真实列表和筛选将在对应业务 API 接入后显示。"}
          </p>
          {isLogin && returnTo ? (
            <small>
              {english ? `Return after sign-in: ${returnTo}` : `登录后返回：${returnTo}`}
            </small>
          ) : null}
        </div>
      </section>
      <section className="card landingList" aria-label={english ? `${title} list` : `${title}列表`}>
        <div className="landingToolbar">
          <strong>{english ? `${title} list` : `${title}列表`}</strong>
          <span>{english ? "Data API pending" : "数据接口待接入"}</span>
        </div>
        {[1, 2, 3].map((item) => (
          <div className="landingSkeleton" key={item}>
            <span />
            <div>
              <b />
              <small />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
