import {
  publicVerticalMetadata,
  renderPublicVerticalRoute,
  type PublicVerticalRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicVerticalRouteProps) {
  return publicVerticalMetadata("JOB", props);
}

export default function JobsPage(props: PublicVerticalRouteProps) {
  return renderPublicVerticalRoute("JOB", props);
}
