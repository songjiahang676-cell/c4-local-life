"use client";

import type { Session, SessionResponse } from "@socal/contracts";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type AccountLocale = "zh-Hans" | "en-US";
export type AccountSessionStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

type AccountSessionContextValue = {
  status: AccountSessionStatus;
  session: Session | null;
  refresh: () => Promise<void>;
};

const sessionRefreshIntervalMs = 15_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissionPattern = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const platformRoles = new Set([
  "SUPPORT",
  "MODERATOR",
  "SENIOR_MODERATOR",
  "AD_OPS",
  "FINANCE",
  "TAXONOMY_ADMIN",
  "PLATFORM_ADMIN",
  "READ_ONLY_AUDITOR",
]);
const organizationTypes = new Set([
  "MERCHANT",
  "SERVICE_PROVIDER",
  "SUPPLIER",
  "MEDIA",
  "INTERNAL",
]);
const membershipRoles = new Set(["OWNER", "ADMIN", "EDITOR", "BILLING", "ANALYST"]);
const AccountSessionContext = createContext<AccountSessionContextValue | null>(null);

const copy = {
  "zh-Hans": {
    label: "账号中心",
    signedInAs: "已登录",
    limited: "受限账号",
    organizations: (count: number) => `${count} 个组织`,
    navigation: "账号中心导航",
    overview: "总览",
    listings: "我的信息",
    notifications: "通知",
    create: "发布信息",
  },
  "en-US": {
    label: "Account center",
    signedInAs: "Signed in",
    limited: "Limited account",
    organizations: (count: number) => `${count} organizations`,
    navigation: "Account center navigation",
    overview: "Overview",
    listings: "My listings",
    notifications: "Notifications",
    create: "Post a listing",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isUniqueStringArray(
  value: unknown,
  maximum: number,
  predicate: (item: string) => boolean,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && predicate(item)) &&
    new Set(value).size === value.length
  );
}

function isUserSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    uuidPattern.test(value.id) &&
    isBoundedString(value.displayName, 120) &&
    (value.avatarUrl === undefined ||
      value.avatarUrl === null ||
      isBoundedString(value.avatarUrl, 2_048)) &&
    (value.locale === "zh-Hans" || value.locale === "en-US") &&
    (value.status === "ACTIVE" || value.status === "LIMITED" || value.status === "SUSPENDED") &&
    (value.verificationBadges === undefined ||
      isUniqueStringArray(value.verificationBadges, 20, (badge) => badge.length <= 80))
  );
}

function isOrganizationSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    uuidPattern.test(value.id) &&
    typeof value.type === "string" &&
    organizationTypes.has(value.type) &&
    isBoundedString(value.displayName, 120) &&
    isBoundedString(value.slug, 80) &&
    slugPattern.test(value.slug) &&
    typeof value.role === "string" &&
    membershipRoles.has(value.role)
  );
}

export function parseAccountSessionResponse(value: unknown): SessionResponse | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const session = value.data;
  if (
    !isUserSummary(session.user) ||
    !isIsoInstant(session.expiresAt) ||
    !isUniqueStringArray(
      session.permissions,
      64,
      (permission) => permission.length <= 80 && permissionPattern.test(permission),
    ) ||
    !isUniqueStringArray(session.platformRoles, 8, (role) => platformRoles.has(role)) ||
    (session.organizations !== undefined &&
      (!Array.isArray(session.organizations) ||
        session.organizations.length > 50 ||
        !session.organizations.every(isOrganizationSummary) ||
        new Set(
          session.organizations.map((organization) =>
            isRecord(organization) ? organization.id : null,
          ),
        ).size !== session.organizations.length))
  ) {
    return null;
  }
  return value as SessionResponse;
}

export function useAccountSession(): AccountSessionContextValue {
  const value = useContext(AccountSessionContext);
  if (!value) throw new Error("Account components must be rendered inside AccountSessionProvider");
  return value;
}

export function AccountSessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [status, setStatus] = useState<AccountSessionStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const nextController = new AbortController();
    controller.current?.abort();
    controller.current = nextController;
    const request = (async () => {
      try {
        const response = await fetch("/v1/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal: nextController.signal,
        });
        if (!mounted.current) return;
        if (response.status === 401) {
          setSession(null);
          setStatus("unauthenticated");
          return;
        }
        const parsed = response.ok
          ? parseAccountSessionResponse((await response.json()) as unknown)
          : null;
        if (!parsed) {
          setSession(null);
          setStatus("unavailable");
          return;
        }
        if (new Date(parsed.data.expiresAt).getTime() <= Date.now()) {
          setSession(null);
          setStatus("unauthenticated");
          return;
        }
        setSession(parsed.data);
        setStatus("authenticated");
      } catch (error) {
        if (mounted.current && !(error instanceof DOMException && error.name === "AbortError")) {
          setSession(null);
          setStatus("unavailable");
        }
      }
    })().finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const revalidate = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidate();
    }, sessionRefreshIntervalMs);
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      void refresh();
      return;
    }
    const timeout = window.setTimeout(() => void refresh(), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [refresh, session]);

  const value = useMemo(() => ({ status, session, refresh }), [refresh, session, status]);
  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function AccountShell({
  children,
  locale,
}: Readonly<{ children: React.ReactNode; locale: AccountLocale }>) {
  const { session, status } = useAccountSession();
  const text = copy[locale];
  const permissions = useMemo(() => new Set(session?.permissions ?? []), [session]);
  const organizations = session?.organizations ?? [];

  return (
    <div className="accountShell">
      {status === "authenticated" && session ? (
        <header className="accountShellHeader">
          <div className="accountShellIdentity">
            <span>{text.label}</span>
            <strong>{session.user.displayName}</strong>
            <small>
              {text.signedInAs}
              {session.user.status === "LIMITED" ? ` · ${text.limited}` : ""}
              {organizations.length > 0 ? ` · ${text.organizations(organizations.length)}` : ""}
            </small>
          </div>
          <nav aria-label={text.navigation} className="accountShellNav">
            <Link href={`/${locale}/account`}>{text.overview}</Link>
            {permissions.has("account:listings:read") ? (
              <Link href={`/${locale}/account/listings`}>{text.listings}</Link>
            ) : null}
            {permissions.has("notification:read") ? (
              <Link href={`/${locale}/account/notifications`}>{text.notifications}</Link>
            ) : null}
            {permissions.has("listing:draft:create") ? (
              <Link className="isPrimary" href={`/${locale}/post/rental/new`}>
                {text.create}
              </Link>
            ) : null}
          </nav>
        </header>
      ) : null}
      {children}
    </div>
  );
}
