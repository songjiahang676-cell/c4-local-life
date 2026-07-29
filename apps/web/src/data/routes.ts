export const ROUTES = {
  home: "/",
  news: "/news",
  jobs: "/jobs",
  jobPost: "/post/job/new",
  resumes: "/resumes",
  housingRent: "/housing/rent",
  rentalPost: "/post/rental/new",
  housingWanted: "/housing/wanted",
  commercial: "/commercial",
  businessTransfer: "/business-transfer",
  marketplace: "/marketplace",
  services: "/services",
  professionals: "/professionals",
  businesses: "/businesses",
  food: "/food",
  forum: "/forum",
  questions: "/questions",
  events: "/events",
  deals: "/deals",
  classified: "/classified",
  messages: "/messages",
  favorites: "/favorites",
  points: "/points",
  advertising: "/advertising",
  login: "/login",
  register: "/register",
  userCenter: "/account",
  merchantPortal: "/portal/merchant",
  professionalPortal: "/portal/professional",
  supplierPortal: "/portal/supplier",
  moderationPortal: "/portal/moderation",
  customerPortal: "/portal/customers",
  pointsPortal: "/portal/points",
  fulfillmentPortal: "/portal/fulfillment",
  adsPortal: "/portal/ads",
  help: "/help",
  about: "/about",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
  sitemap: "/sitemap",
} as const;

export function localizedPath(locale: string, path: string): string {
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export function loginRedirect(locale: string, destination: string): string {
  const returnTo = localizedPath(locale, destination);
  return `${localizedPath(locale, ROUTES.login)}?returnTo=${encodeURIComponent(returnTo)}`;
}
