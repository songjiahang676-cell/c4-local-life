"use client";

import type {
  InAppNotification,
  NotificationCollection,
  NotificationResponse,
} from "@socal/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export type NotificationLocale = "zh-Hans" | "en-US";

type AuthState = "loading" | "authenticated" | "unauthenticated" | "unavailable";
type LoadState = "idle" | "loading" | "ready" | "failed";

const text = {
  "zh-Hans": {
    loadingAccount: "正在确认账号…",
    authTitle: "登录后查看通知",
    authBody: "通知只对当前账号可见，登录后可查看信息状态并标记为已读。",
    login: "登录",
    serviceUnavailable: "暂时无法确认登录状态，请稍后重试。",
    unreadOnly: "只看未读",
    unreadCount: (count: number) => `${count} 条未读`,
    loading: "正在加载通知…",
    loadFailed: "通知加载失败，请稍后重试。",
    retry: "重试",
    empty: "目前没有通知。",
    emptyUnread: "目前没有未读通知。",
    unread: "未读",
    read: "已读",
    markRead: "标记为已读",
    markingRead: "正在更新…",
    updateFailed: "无法更新通知状态，请重试。",
    loadMore: "加载更多",
    loadingMore: "正在加载…",
    listing: "信息",
  },
  "en-US": {
    loadingAccount: "Checking your account…",
    authTitle: "Sign in to view notifications",
    authBody:
      "Notifications are private to your account. Sign in to review listing status updates.",
    login: "Sign in",
    serviceUnavailable: "We could not verify your session. Please try again shortly.",
    unreadOnly: "Unread only",
    unreadCount: (count: number) => `${count} unread`,
    loading: "Loading notifications…",
    loadFailed: "Notifications could not be loaded. Please try again.",
    retry: "Retry",
    empty: "You do not have any notifications yet.",
    emptyUnread: "You do not have any unread notifications.",
    unread: "Unread",
    read: "Read",
    markRead: "Mark as read",
    markingRead: "Updating…",
    updateFailed: "The notification could not be updated. Please retry.",
    loadMore: "Load more",
    loadingMore: "Loading…",
    listing: "Listing",
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

function isNotification(value: unknown): value is InAppNotification {
  if (!isRecord(value) || !isRecord(value.resource)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.templateKey === "string" &&
    Number.isInteger(value.templateVersion) &&
    (value.locale === "zh-Hans" || value.locale === "en-US") &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    value.resource.type === "LISTING" &&
    typeof value.resource.id === "string" &&
    (value.status === "UNREAD" || value.status === "READ") &&
    isIsoInstant(value.createdAt) &&
    (value.readAt === null || isIsoInstant(value.readAt))
  );
}

export function parseNotificationCollection(value: unknown): NotificationCollection | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pageInfo)) return null;
  const nextCursor = value.pageInfo.nextCursor;
  if (
    !value.data.every(isNotification) ||
    typeof value.pageInfo.hasMore !== "boolean" ||
    (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length > 512)) ||
    !Number.isInteger(value.unreadCount) ||
    (typeof value.unreadCount === "number" && value.unreadCount < 0) ||
    !isIsoInstant(value.generatedAt)
  ) {
    return null;
  }
  return value as NotificationCollection;
}

function parseNotificationResponse(value: unknown): NotificationResponse | null {
  if (!isRecord(value) || !isNotification(value.data)) return null;
  return value as NotificationResponse;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

async function fetchNotificationPage(
  unreadOnly: boolean,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<NotificationCollection> {
  const query = new URLSearchParams({
    limit: "20",
    unreadOnly: String(unreadOnly),
  });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/v1/notifications?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const parsed = response.ok ? parseNotificationCollection(await readJson(response)) : null;
  if (!parsed) throw new Error("Invalid notification response");
  return parsed;
}

export function NotificationCenter({ locale }: { locale: NotificationLocale }) {
  const copy = text[locale];
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [notifications, setNotifications] = useState<readonly InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

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
    void (async () => {
      try {
        const response = await fetch("/v1/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.status === 401) {
          setAuthState("unauthenticated");
          return;
        }
        setAuthState(response.ok ? "authenticated" : "unavailable");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuthState("unavailable");
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const applyPage = useCallback((page: NotificationCollection, append: boolean) => {
    setNotifications((current) => (append ? [...current, ...page.data] : page.data));
    setUnreadCount(page.unreadCount);
    setNextCursor(page.pageInfo.nextCursor ?? null);
    setLoadState("ready");
  }, []);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoadState("loading");
      setActionError(false);
      try {
        applyPage(await fetchNotificationPage(unreadOnly, cursor), append);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadState("failed");
        }
      }
    },
    [applyPage, unreadOnly],
  );

  useEffect(() => {
    if (authState !== "authenticated") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const page = await fetchNotificationPage(unreadOnly, null, controller.signal);
        setActionError(false);
        applyPage(page, false);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadState("failed");
        }
      }
    })();
    return () => controller.abort();
  }, [applyPage, authState, unreadOnly]);

  const markRead = async (notification: InAppNotification) => {
    setUpdatingId(notification.id);
    setActionError(false);
    try {
      const response = await fetch(`/v1/notifications/${notification.id}/read`, {
        method: "PUT",
        credentials: "same-origin",
      });
      const parsed = response.ok ? parseNotificationResponse(await readJson(response)) : null;
      if (!parsed) throw new Error("Invalid notification response");
      setNotifications((current) =>
        unreadOnly
          ? current.filter((item) => item.id !== notification.id)
          : current.map((item) => (item.id === notification.id ? parsed.data : item)),
      );
      if (notification.status === "UNREAD") {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
    } catch {
      setActionError(true);
    } finally {
      setUpdatingId(null);
    }
  };

  if (authState === "loading") {
    return (
      <p aria-live="polite" className="notificationStatus">
        {copy.loadingAccount}
      </p>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <section className="card notificationGate">
        <h2>{copy.authTitle}</h2>
        <p>{copy.authBody}</p>
        <Link
          className="notificationPrimaryButton"
          href={`/${locale}/auth/login?returnTo=${encodeURIComponent(`/${locale}/account/notifications`)}`}
        >
          {copy.login}
        </Link>
      </section>
    );
  }

  if (authState === "unavailable") {
    return (
      <p className="notificationError" role="alert">
        {copy.serviceUnavailable}
      </p>
    );
  }

  const emptyText = unreadOnly ? copy.emptyUnread : copy.empty;

  return (
    <section aria-busy={loadState === "loading"} className="notificationCenter">
      <div className="card notificationToolbar">
        <strong aria-live="polite">{copy.unreadCount(unreadCount)}</strong>
        <label>
          <input
            checked={unreadOnly}
            onChange={(event) => {
              setNotifications([]);
              setNextCursor(null);
              setLoadState("idle");
              setUnreadOnly(event.target.checked);
            }}
            type="checkbox"
          />
          <span>{copy.unreadOnly}</span>
        </label>
      </div>

      {(loadState === "idle" || loadState === "loading") && notifications.length === 0 ? (
        <p aria-live="polite" className="notificationStatus">
          {copy.loading}
        </p>
      ) : null}
      {loadState === "failed" && notifications.length === 0 ? (
        <div className="notificationError" role="alert">
          <p>{copy.loadFailed}</p>
          <button onClick={() => void load(null, false)} type="button">
            {copy.retry}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="notificationError" role="alert">
          {copy.updateFailed}
        </p>
      ) : null}
      {loadState === "ready" && notifications.length === 0 ? (
        <p className="card notificationEmpty">{emptyText}</p>
      ) : null}

      {notifications.length > 0 ? (
        <ol className="notificationList">
          {notifications.map((notification) => (
            <li
              className={`card notificationItem ${
                notification.status === "UNREAD" ? "isUnread" : ""
              }`}
              key={notification.id}
            >
              <div className="notificationItemHeader">
                <span className="notificationBadge">
                  {notification.status === "UNREAD" ? copy.unread : copy.read}
                </span>
                <time dateTime={notification.createdAt}>
                  {dateFormatter.format(new Date(notification.createdAt))}
                </time>
              </div>
              <h2>{notification.title}</h2>
              <p>{notification.body}</p>
              <div className="notificationItemFooter">
                <span>
                  {copy.listing} · {notification.resource.id.slice(0, 8)}
                </span>
                {notification.status === "UNREAD" ? (
                  <button
                    disabled={updatingId === notification.id}
                    onClick={() => void markRead(notification)}
                    type="button"
                  >
                    {updatingId === notification.id ? copy.markingRead : copy.markRead}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {nextCursor ? (
        <button
          className="notificationLoadMore"
          disabled={loadState === "loading"}
          onClick={() => void load(nextCursor, true)}
          type="button"
        >
          {loadState === "loading" ? copy.loadingMore : copy.loadMore}
        </button>
      ) : null}
    </section>
  );
}
