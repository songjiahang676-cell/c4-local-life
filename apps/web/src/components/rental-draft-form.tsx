"use client";

import {
  categoryFormSchemaSchema,
  mediaStatusResponseSchema,
  type Category,
  type CategoryFormSchema,
  type FormField,
  type ListingOwnerResponse,
  type Region,
  type SessionResponse,
} from "@socal/contracts";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  emptyRentalDraft,
  parseStoredRentalDraft,
  rentalDraftStorageKey,
  toCreateListingInput,
  toUpdateListingInput,
  validateRentalDraft,
  valuesFromOwnerListing,
  type DraftFieldErrors,
  type RentalDraftValues,
  type StoredRentalDraft,
  type SupportedLocale,
} from "@/lib/rental-draft";

type SaveState = "idle" | "local" | "saving" | "saved" | "offline" | "conflict" | "invalid";
type UploadState = {
  key: string;
  file: File;
  mediaId: string | null;
  phase: "hashing" | "uploading" | "scanning" | "ready" | "rejected" | "failed";
  progress: number;
  message: string | null;
};

const copy = {
  "zh-Hans": {
    title: "发布出租房源",
    intro: "内容会先保存为私有草稿，不会直接公开。完成后可在后续步骤预览并提交审核。",
    loading: "正在确认登录状态和加载发布字段…",
    authTitle: "请先登录后发布",
    authBody: "草稿按账号隔离保存。登录后会返回本页面，不会把本机草稿交给其他账号。",
    login: "前往登录",
    basics: "基本信息",
    category: "房屋类型",
    region: "城市",
    titleLabel: "标题",
    summary: "简短说明（可选）",
    body: "详细说明",
    price: "租金",
    priceUnit: "计价方式",
    dynamic: "房屋详情",
    contact: "联系与隐私",
    contactHelp: "站内联系最安全；公开电话或邮箱仍受服务端策略控制。",
    media: "房源图片",
    mediaHelp:
      "支持 JPG、PNG、WebP，单张不超过 20 MB，最多 20 张。只有扫描通过的图片才能绑定草稿。",
    upload: "选择图片",
    save: "立即保存",
    discard: "清除本机草稿",
    errorSummary: "请修正以下内容后再保存：",
    restored: "已恢复此账号在本机保存的内容。",
    conflict: "草稿已在其他窗口或设备更新。请重新载入服务器版本，避免覆盖他人的修改。",
    reload: "载入服务器版本",
    saved: "已保存到服务器",
    saving: "正在保存…",
    local: "已保存在本机，内容有效后会自动同步",
    offline: "网络不可用，内容已保存在本机，恢复联网后会重试",
    invalid: "请先完成必填内容；当前内容已保存在本机",
    idle: "等待输入",
    uploadHashing: "正在校验文件",
    uploadUploading: "正在上传",
    uploadScanning: "安全扫描中",
    uploadReady: "已通过扫描",
    uploadRejected: "文件未通过安全检查",
    uploadFailed: "上传失败，请重试",
    retry: "重试",
    remove: "移除",
    noSchema: "动态字段暂时不可用，请稍后重试。",
    serverError: "保存失败，内容仍保留在本机。",
  },
  "en-US": {
    title: "Post a rental",
    intro:
      "Your work is saved as a private draft and is never published immediately. Preview and moderation submission follow in a later step.",
    loading: "Checking your session and loading the publishing fields…",
    authTitle: "Sign in to post",
    authBody:
      "Draft recovery is isolated by account. After sign-in, you will return here and local work is never handed to another account.",
    login: "Go to sign in",
    basics: "Basics",
    category: "Housing type",
    region: "City",
    titleLabel: "Title",
    summary: "Short summary (optional)",
    body: "Description",
    price: "Rent",
    priceUnit: "Price period",
    dynamic: "Property details",
    contact: "Contact and privacy",
    contactHelp:
      "In-app contact is safest. Phone and email reveal remain controlled by server policy.",
    media: "Property photos",
    mediaHelp:
      "JPG, PNG or WebP; 20 MB per image and 20 images maximum. Only scanned READY images can be attached.",
    upload: "Choose images",
    save: "Save now",
    discard: "Clear local draft",
    errorSummary: "Fix these items before saving:",
    restored: "Recovered work saved on this device for this account.",
    conflict:
      "This draft changed in another window or device. Reload the server version to avoid overwriting someone else's changes.",
    reload: "Load server version",
    saved: "Saved to server",
    saving: "Saving…",
    local: "Saved on this device; valid content will sync automatically",
    offline: "Offline. Work is safe on this device and will retry when the network returns",
    invalid: "Complete the required fields. Current work is saved on this device",
    idle: "Waiting for input",
    uploadHashing: "Checking file",
    uploadUploading: "Uploading",
    uploadScanning: "Security scan in progress",
    uploadReady: "Scan passed",
    uploadRejected: "File did not pass the security scan",
    uploadFailed: "Upload failed. Try again",
    retry: "Retry",
    remove: "Remove",
    noSchema: "Dynamic fields are temporarily unavailable. Try again later.",
    serverError: "Save failed. Your work remains on this device.",
  },
} as const;

function flattenCategories(nodes: readonly Category[]): Category[] {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children ?? [])]);
}

function flattenRegions(nodes: readonly Region[]): Region[] {
  return nodes.flatMap((node) => [node, ...flattenRegions(node.children ?? [])]);
}

function phaseLabel(locale: SupportedLocale, phase: UploadState["phase"]): string {
  const text = copy[locale];
  return {
    hashing: text.uploadHashing,
    uploading: text.uploadUploading,
    scanning: text.uploadScanning,
    ready: text.uploadReady,
    rejected: text.uploadRejected,
    failed: text.uploadFailed,
  }[phase];
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadFile(
  url: string,
  headers: Readonly<Record<string, string>>,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== "content-length") request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("Upload target rejected the file"));
    });
    request.addEventListener("error", () => reject(new Error("Upload transport failed")));
    request.send(file);
  });
}

function fieldControl(
  field: FormField,
  locale: SupportedLocale,
  value: unknown,
  update: (value: unknown) => void,
  describedBy: string | undefined,
) {
  const id = `attribute-${field.key}`;
  const common = {
    id,
    name: field.key,
    "aria-describedby": describedBy,
    "aria-invalid": Boolean(describedBy),
  } as const;
  if (field.type === "BOOLEAN") {
    return (
      <input
        {...common}
        checked={value === true}
        onChange={(event) => update(event.target.checked)}
        type="checkbox"
      />
    );
  }
  if (field.type === "SELECT") {
    return (
      <select
        {...common}
        onChange={(event) => update(event.target.value)}
        value={String(value ?? "")}
      >
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label[locale]}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "MULTISELECT") {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <fieldset {...(describedBy ? { "aria-describedby": describedBy } : {})} className="choiceSet">
        <legend className="srOnly">{field.label[locale]}</legend>
        {(field.options ?? []).map((option) => (
          <label key={option.value}>
            <input
              checked={selected.has(option.value)}
              onChange={(event) => {
                if (event.target.checked) selected.add(option.value);
                else selected.delete(option.value);
                update([...selected]);
              }}
              type="checkbox"
            />
            {option.label[locale]}
          </label>
        ))}
      </fieldset>
    );
  }
  if (field.type === "TEXTAREA") {
    return (
      <textarea
        {...common}
        maxLength={field.validation?.maxLength ?? 10_000}
        onChange={(event) => update(event.target.value)}
        rows={4}
        value={String(value ?? "")}
      />
    );
  }
  if (field.type === "LOCATION") {
    const point =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { latitude?: unknown; longitude?: unknown })
        : {};
    return (
      <span className="coordinateFields">
        <input
          aria-label={`${field.label[locale]} latitude`}
          max={90}
          min={-90}
          onChange={(event) =>
            update({
              latitude: Number(event.target.value),
              longitude: Number(point.longitude ?? 0),
            })
          }
          step="any"
          type="number"
          value={typeof point.latitude === "number" ? point.latitude : ""}
        />
        <input
          aria-label={`${field.label[locale]} longitude`}
          max={180}
          min={-180}
          onChange={(event) =>
            update({
              latitude: Number(point.latitude ?? 0),
              longitude: Number(event.target.value),
            })
          }
          step="any"
          type="number"
          value={typeof point.longitude === "number" ? point.longitude : ""}
        />
      </span>
    );
  }
  const inputType =
    {
      DATE: "date",
      EMAIL: "email",
      MONEY: "text",
      NUMBER: "number",
      PHONE: "tel",
      TEXT: "text",
    }[field.type] ?? "text";
  return (
    <input
      {...common}
      {...(field.type === "NUMBER"
        ? {
            max: field.validation?.max,
            min: field.validation?.min,
            step: "any",
          }
        : {})}
      maxLength={field.validation?.maxLength}
      onChange={(event) =>
        update(
          field.type === "NUMBER" && event.target.value !== ""
            ? Number(event.target.value)
            : event.target.value,
        )
      }
      type={inputType}
      value={typeof value === "number" || typeof value === "string" ? value : ""}
    />
  );
}

export function RentalDraftForm({ locale }: { locale: SupportedLocale }) {
  const text = copy[locale];
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "guest" | "error">(
    "loading",
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [values, setValues] = useState<RentalDraftValues>(emptyRentalDraft);
  const [categories, setCategories] = useState<Category[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [definition, setDefinition] = useState<CategoryFormSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<DraftFieldErrors>({});
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [conflict, setConflict] = useState(false);
  const listingIdRef = useRef<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string>("");
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<RentalDraftValues | null>(null);
  const latestValuesRef = useRef(values);
  const saveSnapshotRef = useRef<(snapshot: RentalDraftValues) => Promise<void>>(
    async () => undefined,
  );

  const persistLocal = useCallback(
    (snapshot: RentalDraftValues) => {
      if (!userId || !idempotencyKeyRef.current) return;
      const stored: StoredRentalDraft = {
        version: 1,
        userId,
        locale,
        idempotencyKey: idempotencyKeyRef.current,
        listingId: listingIdRef.current,
        etag: etagRef.current,
        savedAt: new Date().toISOString(),
        values: snapshot,
      };
      try {
        localStorage.setItem(rentalDraftStorageKey(userId, locale), JSON.stringify(stored));
      } catch {
        // Storage can be disabled or full; server autosave remains the canonical recovery path.
      }
    },
    [locale, userId],
  );

  const applyServerErrors = useCallback(
    (body: unknown) => {
      const mapped: DraftFieldErrors = {};
      if (body && typeof body === "object" && "errors" in body) {
        const serverErrors = (body as { errors?: unknown }).errors;
        if (serverErrors && typeof serverErrors === "object" && !Array.isArray(serverErrors)) {
          for (const key of Object.keys(serverErrors)) {
            mapped[key === "mediaIds" ? "mediaIds" : `attribute.${key}`] =
              locale === "zh-Hans"
                ? "服务端未接受此字段，请检查后重试。"
                : "The server rejected this field. Check it and retry.";
          }
        }
      }
      setErrors(mapped);
      setSaveState("invalid");
    },
    [locale],
  );

  const saveSnapshot = useCallback(
    async (snapshot: RentalDraftValues): Promise<void> => {
      if (!userId || !definition || conflict) return;
      persistLocal(snapshot);
      const validation = validateRentalDraft(snapshot, definition, locale);
      if (Object.keys(validation).length > 0) {
        setErrors(validation);
        setSaveState("invalid");
        return;
      }
      if (savingRef.current) {
        pendingSaveRef.current = snapshot;
        return;
      }
      savingRef.current = true;
      setSaveState("saving");
      setErrors({});
      try {
        const listingId = listingIdRef.current;
        const response = await fetch(listingId ? `/v1/listings/${listingId}` : "/v1/listings", {
          method: listingId ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: {
            "content-type": listingId ? "application/merge-patch+json" : "application/json",
            ...(listingId
              ? { "if-match": etagRef.current ?? "" }
              : { "idempotency-key": idempotencyKeyRef.current }),
          },
          body: JSON.stringify(
            listingId
              ? toUpdateListingInput(snapshot, locale)
              : toCreateListingInput(snapshot, locale),
          ),
        });
        if (response.status === 401) {
          setAuthState("guest");
          return;
        }
        if (response.status === 409) {
          const currentEtag = response.headers.get("etag");
          if (currentEtag) etagRef.current = currentEtag;
          setConflict(true);
          setSaveState("conflict");
          return;
        }
        if (response.status === 422 || response.status === 400) {
          applyServerErrors(await response.json().catch(() => null));
          return;
        }
        if (!response.ok) throw new Error("Draft save failed");
        const body = (await response.json()) as ListingOwnerResponse;
        listingIdRef.current = body.data.id;
        etagRef.current = response.headers.get("etag");
        setSaveState("saved");
        persistLocal(snapshot);
      } catch {
        setSaveState(navigator.onLine ? "local" : "offline");
      } finally {
        savingRef.current = false;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (pending && !conflict) {
          queueMicrotask(() => void saveSnapshotRef.current(pending));
        }
      }
    },
    [applyServerErrors, conflict, definition, locale, persistLocal, userId],
  );

  const reloadServer = useCallback(async () => {
    const listingId = listingIdRef.current;
    if (!listingId) return;
    try {
      const response = await fetch(`/v1/listings/${listingId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Draft unavailable");
      const body = (await response.json()) as ListingOwnerResponse;
      etagRef.current = response.headers.get("etag");
      const restoredValues = valuesFromOwnerListing(body.data);
      setValues(restoredValues);
      setErrors({});
      setConflict(false);
      setSaveState("saved");
      persistLocal(restoredValues);
    } catch {
      setSaveState("offline");
    }
  }, [persistLocal]);

  useEffect(() => {
    latestValuesRef.current = values;
  }, [values]);

  useEffect(() => {
    saveSnapshotRef.current = saveSnapshot;
  }, [saveSnapshot]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/v1/auth/session", { credentials: "same-origin", cache: "no-store" }),
      fetch("/v1/categories?vertical=RENTAL", { cache: "no-store" }),
      fetch("/v1/regions?type=CITY", { cache: "no-store" }),
    ])
      .then(async ([sessionResponse, categoryResponse, regionResponse]) => {
        if (cancelled) return;
        if (categoryResponse.ok) {
          const body = (await categoryResponse.json()) as { data: Category[] };
          setCategories(
            flattenCategories(body.data).filter((category) => category.parentId !== null),
          );
        }
        if (regionResponse.ok) {
          const body = (await regionResponse.json()) as { data: Region[] };
          setRegions(flattenRegions(body.data).filter((region) => region.type === "CITY"));
        }
        if (sessionResponse.status === 401) {
          setAuthState("guest");
          setHydrated(true);
          return;
        }
        if (!sessionResponse.ok) {
          setAuthState("error");
          setHydrated(true);
          return;
        }
        const session = (await sessionResponse.json()) as SessionResponse;
        const currentUserId = session.data.user.id;
        setUserId(currentUserId);
        setAuthState("authenticated");
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(rentalDraftStorageKey(currentUserId, locale));
        } catch {
          // Continue without device recovery when browser storage is unavailable.
        }
        const recovered = parseStoredRentalDraft(stored, currentUserId, locale);
        idempotencyKeyRef.current =
          recovered?.idempotencyKey ?? `listing-draft:${crypto.randomUUID()}`;
        if (recovered) {
          listingIdRef.current = recovered.listingId;
          etagRef.current = recovered.etag;
          setValues(recovered.values);
          setRestored(true);
          setSaveState("local");
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthState("error");
          setHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (!values.categoryId) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSchemaLoading(true);
    });
    void fetch(`/v1/categories/${values.categoryId}/form-schema`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Schema unavailable");
        const body = categoryFormSchemaSchema.parse(await response.json());
        if (!cancelled) setDefinition(body);
      })
      .catch(() => {
        if (!cancelled) setDefinition(null);
      })
      .finally(() => {
        if (!cancelled) setSchemaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [values.categoryId]);

  useEffect(() => {
    if (!hydrated || authState !== "authenticated" || !userId) return;
    persistLocal(values);
    const localTimer = window.setTimeout(
      () => setSaveState((current) => (current === "conflict" ? current : "local")),
      0,
    );
    const saveTimer =
      definition && !conflict ? window.setTimeout(() => void saveSnapshot(values), 900) : undefined;
    return () => {
      window.clearTimeout(localTimer);
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    };
  }, [authState, conflict, definition, hydrated, persistLocal, saveSnapshot, userId, values]);

  useEffect(() => {
    const retry = () => {
      if (!conflict) void saveSnapshot(latestValuesRef.current);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [conflict, saveSnapshot]);

  const updateUpload = useCallback((key: string, patch: Partial<UploadState>) => {
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...patch } : upload)),
    );
  }, []);

  const pollMedia = useCallback(
    async (key: string, mediaId: string): Promise<void> => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await fetch(`/v1/media/${mediaId}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Media status unavailable");
        const body = mediaStatusResponseSchema.parse(await response.json());
        if (body.data.status === "READY") {
          updateUpload(key, { phase: "ready", progress: 100 });
          setValues((current) =>
            current.mediaIds.includes(mediaId)
              ? current
              : { ...current, mediaIds: [...current.mediaIds, mediaId] },
          );
          return;
        }
        if (body.data.status === "REJECTED") {
          updateUpload(key, { phase: "rejected", message: body.data.rejectionCode });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      throw new Error("Media scan timed out");
    },
    [updateUpload],
  );

  const startUpload = useCallback(
    async (upload: UploadState): Promise<void> => {
      updateUpload(upload.key, {
        phase: "hashing",
        progress: 0,
        mediaId: null,
        message: null,
      });
      try {
        const digest = await sha256(upload.file);
        const intentResponse = await fetch("/v1/media/uploads", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `listing-media:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            filename: upload.file.name,
            mimeType: upload.file.type,
            byteSize: upload.file.size,
            sha256: digest,
            purpose: "LISTING_MEDIA",
          }),
        });
        if (!intentResponse.ok) throw new Error("Upload intent failed");
        const intent = (await intentResponse.json()) as {
          data: {
            mediaId: string;
            uploadUrl: string;
            headers: Record<string, string>;
          };
        };
        updateUpload(upload.key, {
          phase: "uploading",
          mediaId: intent.data.mediaId,
          progress: 1,
        });
        await uploadFile(intent.data.uploadUrl, intent.data.headers, upload.file, (progress) =>
          updateUpload(upload.key, { progress }),
        );
        const complete = await fetch(`/v1/media/${intent.data.mediaId}/complete`, {
          method: "POST",
          credentials: "same-origin",
        });
        if (!complete.ok) throw new Error("Upload completion failed");
        const processing = (await complete.json()) as {
          data: { mediaId: string; status: "SCANNING" | "READY" };
        };
        if (processing.data.status === "READY") {
          updateUpload(upload.key, { phase: "ready", progress: 100 });
          setValues((current) => ({
            ...current,
            mediaIds: current.mediaIds.includes(processing.data.mediaId)
              ? current.mediaIds
              : [...current.mediaIds, processing.data.mediaId],
          }));
        } else {
          updateUpload(upload.key, { phase: "scanning", progress: 100 });
          await pollMedia(upload.key, processing.data.mediaId);
        }
      } catch (error) {
        updateUpload(upload.key, {
          phase: "failed",
          message: error instanceof Error ? error.message : null,
        });
      }
    },
    [pollMedia, updateUpload],
  );

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const available = Math.max(0, 20 - uploads.length);
    const files = [...(event.target.files ?? [])]
      .filter(
        (file) =>
          ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
          file.size > 0 &&
          file.size <= 20_971_520,
      )
      .slice(0, available);
    const added = files.map<UploadState>((file) => ({
      key: crypto.randomUUID(),
      file,
      mediaId: null,
      phase: "hashing",
      progress: 0,
      message: null,
    }));
    setUploads((current) => [...current, ...added]);
    for (const upload of added) void startUpload(upload);
    event.target.value = "";
  };

  const removeUpload = (upload: UploadState) => {
    setUploads((current) => current.filter((candidate) => candidate.key !== upload.key));
    if (upload.mediaId) {
      setValues((current) => ({
        ...current,
        mediaIds: current.mediaIds.filter((id) => id !== upload.mediaId),
      }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateRentalDraft(values, definition, locale);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      setSaveState("invalid");
      window.setTimeout(() => {
        const first = document.querySelector<HTMLElement>("[aria-invalid='true']");
        first?.focus();
      });
      return;
    }
    void saveSnapshot(values);
  };

  const discard = () => {
    if (userId) {
      try {
        localStorage.removeItem(rentalDraftStorageKey(userId, locale));
      } catch {
        // Clearing the in-memory draft must still work when browser storage is unavailable.
      }
    }
    listingIdRef.current = null;
    etagRef.current = null;
    idempotencyKeyRef.current = `listing-draft:${crypto.randomUUID()}`;
    setValues(emptyRentalDraft());
    setDefinition(null);
    setUploads([]);
    setErrors({});
    setConflict(false);
    setRestored(false);
    setSaveState("idle");
  };

  if (!hydrated || authState === "loading") {
    return <p className="draftLoading">{text.loading}</p>;
  }

  if (authState !== "authenticated") {
    return (
      <section className="card draftAuthGate">
        <h2>{text.authTitle}</h2>
        <p>{text.authBody}</p>
        <Link
          className="draftPrimaryButton"
          href={`/${locale}/login?returnTo=${encodeURIComponent(`/${locale}/post/rental/new`)}`}
        >
          {text.login}
        </Link>
      </section>
    );
  }

  const statusText = {
    idle: text.idle,
    local: text.local,
    saving: text.saving,
    saved: text.saved,
    offline: text.offline,
    conflict: text.conflict,
    invalid: text.invalid,
  }[saveState];

  return (
    <form className="rentalDraftForm" noValidate onSubmit={submit}>
      <div aria-atomic="true" aria-live="polite" className={`draftSaveStatus state-${saveState}`}>
        <strong>{statusText}</strong>
        {restored ? <span>{text.restored}</span> : null}
      </div>
      {conflict ? (
        <div className="draftConflict" role="alert">
          <p>{text.conflict}</p>
          <button onClick={() => void reloadServer()} type="button">
            {text.reload}
          </button>
        </div>
      ) : null}
      {Object.keys(errors).length > 0 ? (
        <div className="draftErrorSummary" role="alert">
          <strong>{text.errorSummary}</strong>
          <ul>
            {Object.entries(errors).map(([field, message]) => (
              <li key={field}>
                <a href={`#${field.replace("attribute.", "attribute-")}`}>{message}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card draftSection">
        <h2>{text.basics}</h2>
        <div className="draftGrid">
          <label>
            <span>{text.category}</span>
            <select
              aria-describedby={errors.categoryId ? "categoryId-error" : undefined}
              aria-invalid={Boolean(errors.categoryId)}
              id="categoryId"
              onChange={(event) => {
                setDefinition(null);
                setValues((current) => ({
                  ...current,
                  categoryId: event.target.value,
                  attributes: {},
                }));
              }}
              value={values.categoryId}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name[locale]}
                </option>
              ))}
            </select>
            {errors.categoryId ? (
              <small className="fieldError" id="categoryId-error">
                {errors.categoryId}
              </small>
            ) : null}
          </label>
          <label>
            <span>{text.region}</span>
            <select
              aria-describedby={errors.regionCode ? "regionCode-error" : undefined}
              aria-invalid={Boolean(errors.regionCode)}
              id="regionCode"
              onChange={(event) =>
                setValues((current) => ({ ...current, regionCode: event.target.value }))
              }
              value={values.regionCode}
            >
              <option value="">—</option>
              {regions.map((region) => (
                <option key={region.id} value={region.code}>
                  {region.name[locale]}
                </option>
              ))}
            </select>
            {errors.regionCode ? (
              <small className="fieldError" id="regionCode-error">
                {errors.regionCode}
              </small>
            ) : null}
          </label>
        </div>
        <label>
          <span>{text.titleLabel}</span>
          <input
            aria-describedby={errors.title ? "title-error" : undefined}
            aria-invalid={Boolean(errors.title)}
            id="title"
            maxLength={120}
            onChange={(event) =>
              setValues((current) => ({ ...current, title: event.target.value }))
            }
            value={values.title}
          />
          {errors.title ? (
            <small className="fieldError" id="title-error">
              {errors.title}
            </small>
          ) : null}
        </label>
        <label>
          <span>{text.summary}</span>
          <input
            maxLength={240}
            onChange={(event) =>
              setValues((current) => ({ ...current, summary: event.target.value }))
            }
            value={values.summary}
          />
        </label>
        <label>
          <span>{text.body}</span>
          <textarea
            aria-describedby={errors.body ? "body-error" : undefined}
            aria-invalid={Boolean(errors.body)}
            id="body"
            maxLength={10_000}
            onChange={(event) => setValues((current) => ({ ...current, body: event.target.value }))}
            rows={8}
            value={values.body}
          />
          {errors.body ? (
            <small className="fieldError" id="body-error">
              {errors.body}
            </small>
          ) : null}
        </label>
        <div className="draftGrid">
          <label>
            <span>{text.price}</span>
            <input
              aria-describedby={errors.priceAmount ? "priceAmount-error" : undefined}
              aria-invalid={Boolean(errors.priceAmount)}
              disabled={values.priceUnit === "FREE" || values.priceUnit === "NEGOTIABLE"}
              id="priceAmount"
              inputMode="decimal"
              onChange={(event) =>
                setValues((current) => ({ ...current, priceAmount: event.target.value }))
              }
              placeholder="0.00"
              value={values.priceAmount}
            />
            {errors.priceAmount ? (
              <small className="fieldError" id="priceAmount-error">
                {errors.priceAmount}
              </small>
            ) : null}
          </label>
          <label>
            <span>{text.priceUnit}</span>
            <select
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  priceUnit: event.target.value as RentalDraftValues["priceUnit"],
                }))
              }
              value={values.priceUnit}
            >
              <option value="MONTHLY">{locale === "zh-Hans" ? "每月" : "Monthly"}</option>
              <option value="WEEKLY">{locale === "zh-Hans" ? "每周" : "Weekly"}</option>
              <option value="DAILY">{locale === "zh-Hans" ? "每天" : "Daily"}</option>
              <option value="NEGOTIABLE">{locale === "zh-Hans" ? "面议" : "Negotiable"}</option>
              <option value="FREE">{locale === "zh-Hans" ? "免费" : "Free"}</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card draftSection">
        <h2>{text.dynamic}</h2>
        {schemaLoading ? <p>{text.loading}</p> : null}
        {!schemaLoading && values.categoryId && !definition ? <p>{text.noSchema}</p> : null}
        <div className="dynamicFieldGrid">
          {(definition?.fields ?? []).map((field) => {
            const error = errors[`attribute.${field.key}`];
            const errorId = error ? `attribute-${field.key}-error` : undefined;
            return (
              <label className={field.type === "TEXTAREA" ? "spanTwo" : ""} key={field.key}>
                <span>
                  {field.label[locale]}
                  {field.required ? " *" : ""}
                </span>
                {fieldControl(
                  field,
                  locale,
                  values.attributes[field.key],
                  (value) =>
                    setValues((current) => ({
                      ...current,
                      attributes: { ...current.attributes, [field.key]: value },
                    })),
                  errorId,
                )}
                {field.helpText ? <small>{field.helpText[locale]}</small> : null}
                {error ? (
                  <small className="fieldError" id={errorId}>
                    {error}
                  </small>
                ) : null}
              </label>
            );
          })}
        </div>
      </section>

      <section className="card draftSection">
        <h2>{text.media}</h2>
        <p>{text.mediaHelp}</p>
        <label className="draftUploadButton">
          {text.upload}
          <input
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={selectFiles}
            type="file"
          />
        </label>
        <ul className="draftUploadList">
          {uploads.map((upload) => (
            <li key={upload.key}>
              <div>
                <strong>{upload.file.name}</strong>
                <span>{phaseLabel(locale, upload.phase)}</span>
              </div>
              <progress max={100} value={upload.progress}>
                {upload.progress}%
              </progress>
              {upload.message ? <small>{upload.message}</small> : null}
              <span className="uploadActions">
                {upload.phase === "failed" || upload.phase === "rejected" ? (
                  <button onClick={() => void startUpload(upload)} type="button">
                    {text.retry}
                  </button>
                ) : null}
                <button onClick={() => removeUpload(upload)} type="button">
                  {text.remove}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card draftSection">
        <h2>{text.contact}</h2>
        <p>{text.contactHelp}</p>
        <div className="choiceSet">
          {(["IN_APP", "PHONE_REVEAL", "EMAIL_REVEAL"] as const).map((mode) => (
            <label key={mode}>
              <input
                checked={values.contactMode === mode}
                name="contactMode"
                onChange={() => setValues((current) => ({ ...current, contactMode: mode }))}
                type="radio"
              />
              {
                {
                  IN_APP: locale === "zh-Hans" ? "仅站内联系" : "In-app only",
                  PHONE_REVEAL: locale === "zh-Hans" ? "按策略显示电话" : "Policy-controlled phone",
                  EMAIL_REVEAL: locale === "zh-Hans" ? "按策略显示邮箱" : "Policy-controlled email",
                }[mode]
              }
            </label>
          ))}
        </div>
      </section>

      <div className="draftActions">
        <button className="draftPrimaryButton" disabled={saveState === "saving"} type="submit">
          {text.save}
        </button>
        <button onClick={discard} type="button">
          {text.discard}
        </button>
      </div>
    </form>
  );
}
