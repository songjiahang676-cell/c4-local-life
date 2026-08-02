import { NextResponse, type NextRequest } from "next/server";
import {
  canonicalLocaleAliasPathname,
  DEFAULT_LOCALE,
  localeFromPathname,
  ROUTE_LOCALE_HEADER,
} from "./lib/i18n";

export function proxy(request: NextRequest): NextResponse {
  const canonicalAlias = canonicalLocaleAliasPathname(request.nextUrl.pathname);
  if (canonicalAlias !== null) {
    const destination = request.nextUrl.clone();
    destination.pathname = canonicalAlias;
    return NextResponse.redirect(destination, 308);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    ROUTE_LOCALE_HEADER,
    localeFromPathname(request.nextUrl.pathname) ?? DEFAULT_LOCALE,
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
