"use client";

import Link from "next/link";
import { useMemo } from "react";
import { type AccountLocale, useAccountSession } from "./account-shell";

const copy = {
  "zh-Hans": {
    checking: "正在确认账号…",
    authTitle: "登录后进入账号中心",
    authBody: "账号资料、信息、通知和组织入口只对当前登录账号可见。",
    login: "登录",
    unavailable: "暂时无法确认登录状态，请稍后重试。",
    retry: "重试",
    breadcrumb: "面包屑",
    home: "首页",
    account: "账号中心",
    eyebrow: "您的账号",
    title: (name: string) => `${name}，您好`,
    body: "从这里进入当前账号可用的私有功能。入口由服务端能力决定，最终操作仍由 API 授权。",
    listings: "我的信息",
    listingsBody: "管理草稿、审核中、已发布和已归档信息。",
    notifications: "站内通知",
    notificationsBody: "查看信息状态和组织邀请，并处理未读通知。",
    create: "发布新信息",
    createBody: "创建五类信息草稿；提交后按风险规则进入发布或人工审核。",
    organizations: "所属组织",
    organizationBody: "这里只显示当前 Session 的最小组织摘要，不包含成员联系方式。",
    noOrganizations: "当前账号没有活动组织关系。",
    expires: "本次登录有效至",
    limited: "当前账号处于受限状态；资料、会话和只读入口仍可用，内容写入由服务端拒绝。",
    organizationTypes: {
      MERCHANT: "商家",
      SERVICE_PROVIDER: "服务商",
      SUPPLIER: "供应商",
      MEDIA: "媒体",
      INTERNAL: "平台内部",
    },
    organizationRoles: {
      OWNER: "所有者",
      ADMIN: "管理员",
      EDITOR: "编辑",
      BILLING: "账务",
      ANALYST: "分析员",
    },
  },
  "en-US": {
    checking: "Checking your account…",
    authTitle: "Sign in to open your account",
    authBody:
      "Profile, listings, notifications, and organization access are private to your account.",
    login: "Sign in",
    unavailable: "We could not verify your session. Please try again shortly.",
    retry: "Retry",
    breadcrumb: "Breadcrumb",
    home: "Home",
    account: "Account center",
    eyebrow: "Your account",
    title: (name: string) => `Welcome, ${name}`,
    body: "Open the private features currently available to this account. The server controls these capability hints and authorizes every final action.",
    listings: "My listings",
    listingsBody: "Manage draft, pending, published, and archived listings.",
    notifications: "Notifications",
    notificationsBody:
      "Review listing status and organization invitations, then clear unread items.",
    create: "Post a listing",
    createBody: "Create any of the five listing drafts; risk policy decides publishing or review.",
    organizations: "Organizations",
    organizationBody:
      "Only the current Session's minimal organization summaries appear here; member contacts are excluded.",
    noOrganizations: "This account has no active organization memberships.",
    expires: "This sign-in expires",
    limited:
      "This account is limited. Profile, session, and read-only access remain available; the server denies content mutations.",
    organizationTypes: {
      MERCHANT: "Merchant",
      SERVICE_PROVIDER: "Service provider",
      SUPPLIER: "Supplier",
      MEDIA: "Media",
      INTERNAL: "Platform internal",
    },
    organizationRoles: {
      OWNER: "Owner",
      ADMIN: "Administrator",
      EDITOR: "Editor",
      BILLING: "Billing",
      ANALYST: "Analyst",
    },
  },
} as const;

export function AccountOverview({ locale }: { locale: AccountLocale }) {
  const { refresh, session, status } = useAccountSession();
  const text = copy[locale];
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      }),
    [locale],
  );

  if (status === "loading") {
    return (
      <main className="accountOverview pageShell" id="main-content" tabIndex={-1}>
        <p aria-live="polite" className="accountOverviewStatus">
          {text.checking}
        </p>
      </main>
    );
  }
  if (status === "unauthenticated") {
    return (
      <main className="accountOverview pageShell" id="main-content" tabIndex={-1}>
        <section className="card accountOverviewGate">
          <h1>{text.authTitle}</h1>
          <p>{text.authBody}</p>
          <Link
            className="accountOverviewPrimary"
            href={`/${locale}/auth/login?returnTo=${encodeURIComponent(`/${locale}/account`)}`}
          >
            {text.login}
          </Link>
        </section>
      </main>
    );
  }
  if (status === "unavailable" || !session) {
    return (
      <main className="accountOverview pageShell" id="main-content" tabIndex={-1}>
        <div className="accountOverviewError" role="alert">
          <p>{text.unavailable}</p>
          <button onClick={() => void refresh()} type="button">
            {text.retry}
          </button>
        </div>
      </main>
    );
  }

  const permissions = new Set(session.permissions);
  const organizations = session.organizations ?? [];

  return (
    <main className="accountOverview pageShell" id="main-content" tabIndex={-1}>
      <nav aria-label={text.breadcrumb}>
        <Link href={`/${locale}`}>{text.home}</Link>
        <span aria-hidden="true">/</span>
        <span>{text.account}</span>
      </nav>
      <header className="accountOverviewHeader">
        <p>{text.eyebrow}</p>
        <h1>{text.title(session.user.displayName)}</h1>
        <span>{text.body}</span>
        {session.user.status === "LIMITED" ? <strong>{text.limited}</strong> : null}
        <small>
          {text.expires}{" "}
          <time dateTime={session.expiresAt}>{formatter.format(new Date(session.expiresAt))}</time>
        </small>
      </header>
      <section aria-label={text.account} className="accountOverviewGrid">
        {permissions.has("account:listings:read") ? (
          <Link className="card accountOverviewCard" href={`/${locale}/account/listings`}>
            <strong>{text.listings}</strong>
            <span>{text.listingsBody}</span>
          </Link>
        ) : null}
        {permissions.has("notification:read") ? (
          <Link className="card accountOverviewCard" href={`/${locale}/account/notifications`}>
            <strong>{text.notifications}</strong>
            <span>{text.notificationsBody}</span>
          </Link>
        ) : null}
        {permissions.has("listing:draft:create") ? (
          <Link className="card accountOverviewCard" href={`/${locale}/post/rental/new`}>
            <strong>{text.create}</strong>
            <span>{text.createBody}</span>
          </Link>
        ) : null}
      </section>
      <section className="card accountOrganizations">
        <h2>{text.organizations}</h2>
        <p>{text.organizationBody}</p>
        {organizations.length > 0 ? (
          <ul>
            {organizations.map((organization) => (
              <li key={organization.id}>
                <strong>{organization.displayName}</strong>
                <span>
                  {text.organizationTypes[organization.type]} ·{" "}
                  {text.organizationRoles[organization.role]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{text.noOrganizations}</p>
        )}
      </section>
    </main>
  );
}
