import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { AppIcon } from "@/components/icons/app-icon";

const PAGE_TITLES: Record<string, string> = {
  news: "新闻资讯",
  jobs: "招聘招工",
  resumes: "求职简历",
  housing: "房屋信息",
  commercial: "商铺出租",
  "business-transfer": "店铺转让",
  marketplace: "二手物品",
  services: "本地服务",
  professionals: "本地师傅",
  businesses: "商家黄页",
  food: "美食分享",
  forum: "本地论坛",
  questions: "本地问答",
  events: "本地活动",
  deals: "商家优惠",
  classified: "分类信息",
  messages: "站内消息",
  favorites: "我的收藏",
  points: "积分与增值服务",
  advertising: "广告推广",
  login: "登录",
  register: "注册",
  account: "用户中心",
  portal: "平台后台",
  help: "帮助中心",
  about: "关于我们",
  contact: "联系我们",
  privacy: "隐私政策",
  terms: "用户协议",
  sitemap: "网站地图",
};

export default async function LandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug?: string[] }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { locale, slug = [] } = await params;
  const { returnTo } = await searchParams;
  const section = slug[0] ?? "classified";
  const title = PAGE_TITLES[section] ?? "南加生活服务";
  const isLogin = section === "login";

  return (
    <main className="landingPage pageShell">
      <Link className="landingBack" href={`/${locale}`}>
        <AppIcon icon={ArrowLeft} size={17} /> 返回首页
      </Link>
      <section className="card landingHero">
        <span className="landingIcon">
          <AppIcon icon={Search} size={24} />
        </span>
        <div>
          <h1>{title}</h1>
          <p>
            {isLogin
              ? "登录功能将在身份系统接入后开放。完成登录后会安全返回你原本要访问的页面。"
              : "该入口已建立可访问的页面骨架，真实列表和筛选将在对应业务 API 接入后显示。"}
          </p>
          {isLogin && returnTo ? <small>登录后返回：{returnTo}</small> : null}
        </div>
      </section>
      <section className="card landingList" aria-label={`${title}列表`}>
        <div className="landingToolbar">
          <strong>{title}列表</strong>
          <span>数据接口待接入</span>
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
