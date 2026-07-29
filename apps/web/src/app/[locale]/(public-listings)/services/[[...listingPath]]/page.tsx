import {
  publicVerticalMetadata,
  renderPublicVerticalRoute,
  type PublicVerticalRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicVerticalRouteProps) {
  return publicVerticalMetadata("SERVICE", props);
}

export default function ServicesPage(props: PublicVerticalRouteProps) {
  return renderPublicVerticalRoute("SERVICE", props);
}
