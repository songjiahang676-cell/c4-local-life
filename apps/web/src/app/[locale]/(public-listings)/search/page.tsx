import {
  publicSearchMetadata,
  renderPublicSearchRoute,
  type PublicSearchRouteProps,
} from "@/lib/public-listing-routes";

export const dynamic = "force-dynamic";

export function generateMetadata(props: PublicSearchRouteProps) {
  return publicSearchMetadata(props);
}

export default function SearchPage(props: PublicSearchRouteProps) {
  return renderPublicSearchRoute(props);
}
