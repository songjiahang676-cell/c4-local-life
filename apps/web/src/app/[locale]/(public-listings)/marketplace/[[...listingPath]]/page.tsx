import {
  publicVerticalMetadata,
  renderPublicVerticalRoute,
  type PublicVerticalRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicVerticalRouteProps) {
  return publicVerticalMetadata("SECONDHAND", props);
}

export default function MarketplacePage(props: PublicVerticalRouteProps) {
  return renderPublicVerticalRoute("SECONDHAND", props);
}
