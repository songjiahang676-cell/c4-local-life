import {
  publicVerticalMetadata,
  renderPublicVerticalRoute,
  type PublicVerticalRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicVerticalRouteProps) {
  return publicVerticalMetadata("TRANSFER", props);
}

export default function TransfersPage(props: PublicVerticalRouteProps) {
  return renderPublicVerticalRoute("TRANSFER", props);
}
