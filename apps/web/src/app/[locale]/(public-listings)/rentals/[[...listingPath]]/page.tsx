import {
  publicVerticalMetadata,
  renderPublicVerticalRoute,
  type PublicVerticalRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicVerticalRouteProps) {
  return publicVerticalMetadata("RENTAL", props);
}

export default function RentalsPage(props: PublicVerticalRouteProps) {
  return renderPublicVerticalRoute("RENTAL", props);
}
