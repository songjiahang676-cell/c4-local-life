import { Briefcase, House, Search, ShoppingBag, Store, Wrench } from "lucide-react";
import type { Locale } from "@socal/contracts";
import type { IconEntry } from "../components/icons/icon-types";
import { ROUTES } from "./routes";

type LocalizedText = Readonly<Record<Locale, string>>;

function text(value: LocalizedText, locale: Locale): string {
  return value[locale];
}

export function primaryNavigation(locale: Locale): readonly (readonly [string, string])[] {
  return [
    [text({ "zh-Hans": "首页", "en-US": "Home" }, locale), ROUTES.home],
    [text({ "zh-Hans": "招聘", "en-US": "Jobs" }, locale), ROUTES.jobs],
    [text({ "zh-Hans": "租房", "en-US": "Rentals" }, locale), ROUTES.housingRent],
    [text({ "zh-Hans": "转让", "en-US": "Transfers" }, locale), ROUTES.businessTransfer],
    [text({ "zh-Hans": "二手", "en-US": "Marketplace" }, locale), ROUTES.marketplace],
    [text({ "zh-Hans": "本地服务", "en-US": "Services" }, locale), ROUTES.services],
  ];
}

export function quickPublishEntries(locale: Locale): readonly IconEntry[] {
  return [
    {
      key: "job-post",
      label: text({ "zh-Hans": "发布招聘", "en-US": "Post a job" }, locale),
      href: ROUTES.jobPost,
      icon: Briefcase,
      theme: "orange",
      description: text({ "zh-Hans": "招聘或求职信息", "en-US": "Hiring information" }, locale),
    },
    {
      key: "rental-post",
      label: text({ "zh-Hans": "发布房源", "en-US": "Post a rental" }, locale),
      href: ROUTES.rentalPost,
      icon: House,
      theme: "red",
      description: text({ "zh-Hans": "出租或求租信息", "en-US": "Rental information" }, locale),
    },
    {
      key: "transfer-post",
      label: text({ "zh-Hans": "发布转让", "en-US": "Post a transfer" }, locale),
      href: ROUTES.transferPost,
      icon: Store,
      theme: "blue",
      description: text({ "zh-Hans": "店铺或生意转让", "en-US": "Business transfers" }, locale),
    },
    {
      key: "market-post",
      label: text({ "zh-Hans": "发布二手", "en-US": "Post an item" }, locale),
      href: ROUTES.secondhandPost,
      icon: ShoppingBag,
      theme: "purple",
      description: text({ "zh-Hans": "本地闲置物品", "en-US": "Local marketplace" }, locale),
    },
    {
      key: "service-post",
      label: text({ "zh-Hans": "发布服务", "en-US": "Post a service" }, locale),
      href: ROUTES.servicePost,
      icon: Wrench,
      theme: "green",
      description: text({ "zh-Hans": "提供本地服务", "en-US": "Local services" }, locale),
    },
  ];
}

export function categoryEntries(locale: Locale): readonly IconEntry[] {
  return [
    {
      key: "search",
      label: text({ "zh-Hans": "全部信息", "en-US": "All listings" }, locale),
      href: ROUTES.classified,
      icon: Search,
      theme: "blue",
    },
    ...quickPublishEntries(locale).map((entry) => ({
      ...entry,
      href:
        entry.key === "job-post"
          ? ROUTES.jobs
          : entry.key === "rental-post"
            ? ROUTES.housingRent
            : entry.key === "transfer-post"
              ? ROUTES.businessTransfer
              : entry.key === "market-post"
                ? ROUTES.marketplace
                : ROUTES.services,
      description: undefined,
    })),
  ];
}
