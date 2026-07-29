"use client";

import type {
  BatchListingActionResponse,
  ListingType,
  MyListingCollection,
  MyListingSummaryView,
  OwnerListingBucket,
} from "@socal/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export type AccountListingsLocale = "zh-Hans" | "en-US";

type AuthState = "loading" | "authenticated" | "unauthenticated" | "unavailable";
type LoadState = "idle" | "loading" | "ready" | "failed";
type TypeFilter = ListingType | "ALL";

const buckets = ["DRAFT", "PENDING", "PUBLISHED", "ARCHIVED"] as const;
const listingTypes = ["RENTAL", "JOB", "TRANSFER", "SECONDHAND", "SERVICE"] as const;
const contentStatuses = [
  "DRAFT",
  "SUBMITTED",
  "PUBLISHED",
  "EXPIRED",
  "ARCHIVED",
  "SUSPENDED",
] as const;
const moderationStatuses = [
  "NOT_REVIEWED",
  "AUTO_APPROVED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ESCALATED",
] as const;
const availableActions = ["EDIT", "SUBMIT", "ARCHIVE", "DELETE", "VIEW_REVISIONS"] as const;

const copy = {
  "zh-Hans": {
    checking: "正在确认账号…",
    authTitle: "登录后管理信息",
    authBody: "草稿、审核中、已发布和已归档信息只对当前账号及有权限的组织成员可见。",
    login: "登录",
    unavailable: "暂时无法确认登录状态，请稍后重试。",
    loading: "正在加载您的信息…",
    failed: "信息列表加载失败，请稍后重试。",
    retry: "重试",
    empty: "这个分类下还没有信息。",
    typeLabel: "信息类型",
    allTypes: "全部类型",
    buckets: {
      DRAFT: "草稿",
      PENDING: "审核中",
      PUBLISHED: "已发布",
      ARCHIVED: "已归档",
    },
    types: {
      RENTAL: "租房",
      JOB: "招聘",
      TRANSFER: "生意转让",
      SECONDHAND: "二手",
      SERVICE: "本地服务",
    },
    status: {
      DRAFT: "草稿",
      SUBMITTED: "已提交",
      PUBLISHED: "已发布",
      EXPIRED: "已过期",
      ARCHIVED: "已归档",
      SUSPENDED: "已下架",
      DELETED: "已删除",
    },
    moderation: {
      NOT_REVIEWED: "未审核",
      AUTO_APPROVED: "自动通过",
      PENDING_REVIEW: "等待审核",
      APPROVED: "审核通过",
      REJECTED: "需要处理",
      ESCALATED: "升级审核",
    },
    personal: "个人发布",
    updated: "更新于",
    expires: "到期",
    edit: "继续编辑",
    create: "发布新信息",
    selected: (count: number) => `已选择 ${count}/20`,
    select: "选择",
    selectAll: "选择本页可操作信息",
    archive: "批量归档",
    remove: "批量删除",
    working: "正在处理…",
    confirmDelete: "确认删除所选信息？删除后不会再显示，且不能在用户中心恢复。",
    actionFailed: "部分信息未处理，请刷新版本后重试。",
    actionComplete: (count: number) => `已处理 ${count} 条信息。`,
    loadMore: "加载更多",
    loadingMore: "正在加载…",
    revision: "最近修订",
    reason: "原因",
  },
  "en-US": {
    checking: "Checking your account…",
    authTitle: "Sign in to manage listings",
    authBody:
      "Draft, pending, published, and archived listings are private to your account and authorized organization members.",
    login: "Sign in",
    unavailable: "We could not verify your session. Please try again shortly.",
    loading: "Loading your listings…",
    failed: "Your listings could not be loaded. Please try again.",
    retry: "Retry",
    empty: "There are no listings in this section yet.",
    typeLabel: "Listing type",
    allTypes: "All types",
    buckets: {
      DRAFT: "Drafts",
      PENDING: "Pending",
      PUBLISHED: "Published",
      ARCHIVED: "Archived",
    },
    types: {
      RENTAL: "Rentals",
      JOB: "Jobs",
      TRANSFER: "Business transfers",
      SECONDHAND: "Secondhand",
      SERVICE: "Local services",
    },
    status: {
      DRAFT: "Draft",
      SUBMITTED: "Submitted",
      PUBLISHED: "Published",
      EXPIRED: "Expired",
      ARCHIVED: "Archived",
      SUSPENDED: "Removed",
      DELETED: "Deleted",
    },
    moderation: {
      NOT_REVIEWED: "Not reviewed",
      AUTO_APPROVED: "Auto-approved",
      PENDING_REVIEW: "Awaiting review",
      APPROVED: "Approved",
      REJECTED: "Needs attention",
      ESCALATED: "Escalated review",
    },
    personal: "Personal listing",
    updated: "Updated",
    expires: "Expires",
    edit: "Continue editing",
    create: "Post a new listing",
    selected: (count: number) => `${count}/20 selected`,
    select: "Select",
    selectAll: "Select actionable listings on this page",
    archive: "Archive selected",
    remove: "Delete selected",
    working: "Working…",
    confirmDelete:
      "Delete the selected listings? They will no longer appear and cannot be restored in the account center.",
    actionFailed: "Some listings were not changed. Refresh their versions and try again.",
    actionComplete: (count: number) => `${count} listings updated.`,
    loadMore: "Load more",
    loadingMore: "Loading…",
    revision: "Latest revision",
    reason: "Reason",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isMyListing(value: unknown): value is MyListingSummaryView {
  if (!isRecord(value) || !isRecord(value.region) || !isRecord(value.category)) return false;
  if (
    typeof value.id !== "string" ||
    !isOneOf(value.type, listingTypes) ||
    !isOneOf(value.bucket, buckets) ||
    !isOneOf(value.status, contentStatuses) ||
    !isOneOf(value.moderationStatus, moderationStatuses) ||
    (value.locale !== "zh-Hans" && value.locale !== "en-US") ||
    typeof value.title !== "string" ||
    value.title.length > 120 ||
    (value.summary !== null && typeof value.summary !== "string") ||
    typeof value.isFeatured !== "boolean" ||
    (value.publishedAt !== null && !isIsoInstant(value.publishedAt)) ||
    (value.expiresAt !== null && !isIsoInstant(value.expiresAt)) ||
    !isIsoInstant(value.createdAt) ||
    !isIsoInstant(value.updatedAt) ||
    !Number.isInteger(value.version) ||
    typeof value.region.id !== "string" ||
    typeof value.region.code !== "string" ||
    typeof value.category.id !== "string" ||
    !Array.isArray(value.availableActions) ||
    value.availableActions.length > 5 ||
    !value.availableActions.every((action) => isOneOf(action, availableActions))
  ) {
    return false;
  }
  if (
    value.organization !== null &&
    (!isRecord(value.organization) ||
      typeof value.organization.id !== "string" ||
      typeof value.organization.displayName !== "string")
  ) {
    return false;
  }
  if (value.latestRevision !== null) {
    if (
      !isRecord(value.latestRevision) ||
      !Number.isInteger(value.latestRevision.revisionNumber) ||
      !Array.isArray(value.latestRevision.reasonCodes) ||
      value.latestRevision.reasonCodes.length > 20 ||
      !value.latestRevision.reasonCodes.every((reason) => typeof reason === "string") ||
      !isIsoInstant(value.latestRevision.createdAt)
    ) {
      return false;
    }
  }
  return true;
}

export function parseMyListingCollection(value: unknown): MyListingCollection | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    value.data.length > 50 ||
    !value.data.every(isMyListing) ||
    !isRecord(value.page) ||
    !isRecord(value.counts) ||
    typeof value.page.hasMore !== "boolean" ||
    (value.page.nextCursor !== null &&
      (typeof value.page.nextCursor !== "string" || value.page.nextCursor.length > 512)) ||
    !isIsoInstant(value.generatedAt)
  ) {
    return null;
  }
  for (const key of ["draft", "pending", "published", "archived"]) {
    const count = value.counts[key];
    if (!Number.isInteger(count) || (count as number) < 0) return null;
  }
  return value as MyListingCollection;
}

function parseBatchResponse(value: unknown): BatchListingActionResponse | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    value.data.length < 1 ||
    value.data.length > 20 ||
    !Number.isInteger(value.appliedCount) ||
    !isIsoInstant(value.generatedAt)
  ) {
    return null;
  }
  for (const result of value.data) {
    if (
      !isRecord(result) ||
      typeof result.listingId !== "string" ||
      !isOneOf(result.outcome, [
        "APPLIED",
        "NOT_FOUND",
        "VERSION_CONFLICT",
        "STATE_CONFLICT",
      ] as const) ||
      (result.currentVersion !== null && !Number.isInteger(result.currentVersion)) ||
      (result.currentBucket !== null && !isOneOf(result.currentBucket, buckets))
    ) {
      return null;
    }
  }
  return value as BatchListingActionResponse;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

async function fetchListingPage(
  bucket: OwnerListingBucket,
  type: TypeFilter,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<MyListingCollection> {
  const query = new URLSearchParams({ bucket, limit: "20" });
  if (type !== "ALL") query.set("type", type);
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/v1/me/listings?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const parsed = response.ok ? parseMyListingCollection(await readJson(response)) : null;
  if (!parsed) throw new Error("Invalid account Listing response");
  return parsed;
}

function editHref(locale: AccountListingsLocale, listing: MyListingSummaryView): string {
  return `/${locale}/account/listings/${listing.id}/edit?type=${listing.type}`;
}

export function AccountListings({ locale }: { locale: AccountListingsLocale }) {
  const text = copy[locale];
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [bucket, setBucket] = useState<OwnerListingBucket>("DRAFT");
  const [type, setType] = useState<TypeFilter>("ALL");
  const [listings, setListings] = useState<readonly MyListingSummaryView[]>([]);
  const [counts, setCounts] = useState<MyListingCollection["counts"]>({
    draft: 0,
    pending: 0,
    published: 0,
    archived: 0,
  });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<"success" | "failed" | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      }),
    [locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/v1/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        const nextAuthState =
          response.status === 401
            ? "unauthenticated"
            : response.ok
              ? "authenticated"
              : "unavailable";
        if (nextAuthState === "authenticated") setLoadState("loading");
        setAuthState(nextAuthState);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuthState("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const applyPage = useCallback((page: MyListingCollection, append: boolean) => {
    setListings((current) => (append ? [...current, ...page.data] : page.data));
    setCounts(page.counts);
    setNextCursor(page.page.nextCursor ?? null);
    setLoadState("ready");
  }, []);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoadState("loading");
      try {
        applyPage(await fetchListingPage(bucket, type, cursor), append);
      } catch {
        setLoadState("failed");
      }
    },
    [applyPage, bucket, type],
  );

  useEffect(() => {
    if (authState !== "authenticated") return;
    const controller = new AbortController();
    void fetchListingPage(bucket, type, null, controller.signal)
      .then((page) => applyPage(page, false))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadState("failed");
        }
      });
    return () => controller.abort();
  }, [applyPage, authState, bucket, type]);

  const resetForFilterChange = () => {
    setListings([]);
    setSelected(new Set());
    setNextCursor(null);
    setActionMessage(null);
    setLoadState("loading");
  };

  const changeBucket = (nextBucket: OwnerListingBucket) => {
    if (nextBucket === bucket) return;
    resetForFilterChange();
    setBucket(nextBucket);
  };

  const changeType = (nextType: TypeFilter) => {
    if (nextType === type) return;
    resetForFilterChange();
    setType(nextType);
  };

  const batchAction = bucket === "PUBLISHED" ? "ARCHIVE" : "DELETE";
  const selectable = listings.filter((listing) => listing.availableActions.includes(batchAction));

  const applyBatch = async () => {
    const items = listings
      .filter((listing) => selected.has(listing.id))
      .slice(0, 20)
      .map((listing) => ({ listingId: listing.id, version: listing.version }));
    if (items.length === 0) return;
    if (batchAction === "DELETE" && !window.confirm(text.confirmDelete)) return;
    setActionPending(true);
    setActionMessage(null);
    try {
      const response = await fetch("/v1/me/listings/actions", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: batchAction, items }),
      });
      const parsed = response.ok ? parseBatchResponse(await readJson(response)) : null;
      if (!parsed) throw new Error("Invalid batch Listing response");
      setAppliedCount(parsed.appliedCount);
      setActionMessage(
        parsed.data.every((result) => result.outcome === "APPLIED") ? "success" : "failed",
      );
      setSelected(new Set());
      applyPage(await fetchListingPage(bucket, type, null), false);
    } catch {
      setActionMessage("failed");
    } finally {
      setActionPending(false);
    }
  };

  if (authState === "loading") {
    return (
      <p aria-live="polite" className="accountListingsStatus">
        {text.checking}
      </p>
    );
  }
  if (authState === "unauthenticated") {
    return (
      <section className="card accountListingsGate">
        <h2>{text.authTitle}</h2>
        <p>{text.authBody}</p>
        <Link
          className="accountListingsPrimary"
          href={`/${locale}/auth/login?returnTo=${encodeURIComponent(`/${locale}/account/listings`)}`}
        >
          {text.login}
        </Link>
      </section>
    );
  }
  if (authState === "unavailable") {
    return (
      <p className="accountListingsError" role="alert">
        {text.unavailable}
      </p>
    );
  }

  const bucketCount = (candidate: OwnerListingBucket) =>
    counts[candidate.toLowerCase() as keyof MyListingCollection["counts"]];

  return (
    <section aria-busy={loadState === "loading"} className="accountListings">
      <div className="card accountListingsToolbar">
        <div aria-label={locale === "zh-Hans" ? "信息状态" : "Listing status"} role="group">
          {buckets.map((candidate) => (
            <button
              aria-pressed={bucket === candidate}
              key={candidate}
              onClick={() => changeBucket(candidate)}
              type="button"
            >
              <span>{text.buckets[candidate]}</span>
              <strong>{bucketCount(candidate)}</strong>
            </button>
          ))}
        </div>
        <label>
          <span>{text.typeLabel}</span>
          <select value={type} onChange={(event) => changeType(event.target.value as TypeFilter)}>
            <option value="ALL">{text.allTypes}</option>
            {listingTypes.map((candidate) => (
              <option key={candidate} value={candidate}>
                {text.types[candidate]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectable.length > 0 ? (
        <div className="card accountListingsBatch">
          <label>
            <input
              checked={selectable.length > 0 && selectable.every((item) => selected.has(item.id))}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? new Set(selectable.slice(0, 20).map((item) => item.id))
                    : new Set(),
                )
              }
              type="checkbox"
            />
            <span>{text.selectAll}</span>
          </label>
          <span aria-live="polite">{text.selected(selected.size)}</span>
          <button
            className={batchAction === "DELETE" ? "isDanger" : ""}
            disabled={selected.size === 0 || actionPending}
            onClick={() => void applyBatch()}
            type="button"
          >
            {actionPending ? text.working : batchAction === "ARCHIVE" ? text.archive : text.remove}
          </button>
        </div>
      ) : null}

      {actionMessage ? (
        <p
          className={actionMessage === "failed" ? "accountListingsError" : "accountListingsNotice"}
          role={actionMessage === "failed" ? "alert" : "status"}
        >
          {actionMessage === "failed" ? text.actionFailed : text.actionComplete(appliedCount)}
        </p>
      ) : null}

      {loadState === "loading" && listings.length === 0 ? (
        <p aria-live="polite" className="accountListingsStatus">
          {text.loading}
        </p>
      ) : null}
      {loadState === "failed" && listings.length === 0 ? (
        <div className="accountListingsError" role="alert">
          <p>{text.failed}</p>
          <button onClick={() => void load(null, false)} type="button">
            {text.retry}
          </button>
        </div>
      ) : null}
      {loadState === "ready" && listings.length === 0 ? (
        <p className="card accountListingsEmpty">{text.empty}</p>
      ) : null}

      {listings.length > 0 ? (
        <ol className="accountListingsList">
          {listings.map((listing) => {
            const canSelect = listing.availableActions.includes(batchAction);
            return (
              <li className="card accountListingItem" key={listing.id}>
                <div className="accountListingHeading">
                  <div>
                    <span className="accountListingType">{text.types[listing.type]}</span>
                    <span>{text.status[listing.status]}</span>
                    <span>{text.moderation[listing.moderationStatus]}</span>
                  </div>
                  {canSelect ? (
                    <label>
                      <input
                        aria-label={`${text.select}: ${listing.title}`}
                        checked={selected.has(listing.id)}
                        disabled={!selected.has(listing.id) && selected.size >= 20}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(listing.id);
                            else next.delete(listing.id);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                      <span>{text.select}</span>
                    </label>
                  ) : null}
                </div>
                <h2>{listing.title}</h2>
                {listing.summary ? <p>{listing.summary}</p> : null}
                <dl className="accountListingMeta">
                  <div>
                    <dt>{text.personal}</dt>
                    <dd>{listing.organization?.displayName ?? text.personal}</dd>
                  </div>
                  <div>
                    <dt>{text.updated}</dt>
                    <dd>
                      <time dateTime={listing.updatedAt}>
                        {dateFormatter.format(new Date(listing.updatedAt))}
                      </time>
                    </dd>
                  </div>
                  {listing.expiresAt ? (
                    <div>
                      <dt>{text.expires}</dt>
                      <dd>
                        <time dateTime={listing.expiresAt}>
                          {dateFormatter.format(new Date(listing.expiresAt))}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {listing.latestRevision ? (
                  <p className="accountListingRevision">
                    <strong>
                      {text.revision} #{listing.latestRevision.revisionNumber}
                    </strong>
                    <span>
                      {text.reason}: {listing.latestRevision.reasonCodes.join(", ")}
                    </span>
                  </p>
                ) : null}
                {listing.availableActions.includes("EDIT") ? (
                  <div className="accountListingActions">
                    <Link href={editHref(locale, listing)}>{text.edit}</Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {nextCursor ? (
        <button
          className="accountListingsLoadMore"
          disabled={loadState === "loading"}
          onClick={() => void load(nextCursor, true)}
          type="button"
        >
          {loadState === "loading" ? text.loadingMore : text.loadMore}
        </button>
      ) : null}
    </section>
  );
}
