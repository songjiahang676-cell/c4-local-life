import type { Locale } from "@socal/contracts";
import { formatNumber } from "../lib/i18n";

export type CountMessage = Readonly<{ one: string; other: string }>;

export type MessageCatalog = Readonly<{
  common: Readonly<{
    skipToMainContent: string;
    switchToChinese: string;
    switchToEnglish: string;
  }>;
  search: Readonly<{ suggestionCount: CountMessage }>;
  listings: Readonly<{ resultCount: CountMessage }>;
}>;

export const messageCatalogs = {
  "zh-Hans": {
    common: {
      skipToMainContent: "跳到主要内容",
      switchToChinese: "切换到中文",
      switchToEnglish: "切换到英文",
    },
    search: {
      suggestionCount: { one: "{count} 条搜索建议可用", other: "{count} 条搜索建议可用" },
    },
    listings: { resultCount: { one: "{count} 条信息", other: "{count} 条信息" } },
  },
  "en-US": {
    common: {
      skipToMainContent: "Skip to main content",
      switchToChinese: "Switch to Chinese",
      switchToEnglish: "Switch to English",
    },
    search: {
      suggestionCount: {
        one: "{count} search suggestion available",
        other: "{count} search suggestions available",
      },
    },
    listings: { resultCount: { one: "{count} listing", other: "{count} listings" } },
  },
} as const satisfies Readonly<Record<Locale, MessageCatalog>>;

export function formatCountMessage(locale: Locale, message: CountMessage, count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Count must be non-negative");
  const category = new Intl.PluralRules(locale).select(count);
  const template = category === "one" ? message.one : message.other;
  return template.replace("{count}", formatNumber(locale, count));
}
