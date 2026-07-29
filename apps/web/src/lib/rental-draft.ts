import type {
  CategoryFormSchema,
  CreateListingInput,
  FormField,
  ListingOwnerView,
  UpdateListingInput,
} from "@socal/contracts";

export type SupportedLocale = "zh-Hans" | "en-US";
export type DraftListingType = "RENTAL" | "JOB";
export type DraftFieldErrors = Record<string, string>;

export type RentalDraftValues = {
  categoryId: string;
  regionCode: string;
  title: string;
  summary: string;
  body: string;
  priceAmount: string;
  priceUnit: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "NEGOTIABLE" | "FREE";
  attributes: Record<string, unknown>;
  mediaIds: string[];
  contactMode: "IN_APP" | "PHONE_REVEAL" | "EMAIL_REVEAL";
};

export type StoredRentalDraft = {
  version: 1;
  listingType: DraftListingType;
  userId: string;
  locale: SupportedLocale;
  idempotencyKey: string;
  listingId: string | null;
  etag: string | null;
  savedAt: string;
  values: RentalDraftValues;
};

const messages = {
  "zh-Hans": {
    category: "请选择房屋类型。",
    jobCategory: "请选择招聘类别。",
    region: "请选择城市。",
    title: "标题至少需要 5 个字符。",
    body: "详情至少需要 20 个字符。",
    price: "请输入大于 0、最多两位小数的金额。",
    required: "此项为必填项。",
    invalid: "请按字段要求填写。",
  },
  "en-US": {
    category: "Choose a housing category.",
    jobCategory: "Choose a job category.",
    region: "Choose a city.",
    title: "Title must contain at least 5 characters.",
    body: "Description must contain at least 20 characters.",
    price: "Enter a positive amount with at most two decimal places.",
    required: "This field is required.",
    invalid: "Check the field requirements.",
  },
} as const;

export function emptyRentalDraft(listingType: DraftListingType = "RENTAL"): RentalDraftValues {
  return {
    categoryId: "",
    regionCode: "",
    title: "",
    summary: "",
    body: "",
    priceAmount: "",
    priceUnit: listingType === "JOB" ? "HOURLY" : "MONTHLY",
    attributes: {},
    mediaIds: [],
    contactMode: "IN_APP",
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

function validFieldValue(field: FormField, value: unknown): boolean {
  if (isEmptyValue(value)) return !field.required;
  const optionValues = new Set((field.options ?? []).map((option) => option.value));
  let typeValid = false;
  switch (field.type) {
    case "TEXT":
    case "TEXTAREA":
      typeValid = typeof value === "string";
      break;
    case "PHONE":
      typeValid = typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
      break;
    case "EMAIL":
      typeValid =
        typeof value === "string" &&
        value.length <= 320 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      break;
    case "DATE":
      typeValid = typeof value === "string" && isCalendarDate(value);
      break;
    case "SELECT":
      typeValid = typeof value === "string" && optionValues.has(value);
      break;
    case "MONEY":
      typeValid = typeof value === "string" && /^\d{1,12}(?:\.\d{1,2})?$/.test(value);
      break;
    case "NUMBER":
      typeValid = typeof value === "number" && Number.isFinite(value);
      break;
    case "BOOLEAN":
      typeValid = typeof value === "boolean";
      break;
    case "MULTISELECT":
      typeValid =
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((item) => typeof item === "string" && optionValues.has(item));
      break;
    case "LOCATION":
      typeValid =
        isPlainRecord(value) &&
        typeof value.latitude === "number" &&
        value.latitude >= -90 &&
        value.latitude <= 90 &&
        typeof value.longitude === "number" &&
        value.longitude >= -180 &&
        value.longitude <= 180;
      break;
  }
  if (!typeValid) return false;
  const validation = field.validation;
  if (!validation) return true;
  const comparable =
    typeof value === "number"
      ? value
      : field.type === "MONEY" && typeof value === "string"
        ? Number(value)
        : null;
  if (
    comparable !== null &&
    ((validation.min !== undefined && comparable < validation.min) ||
      (validation.max !== undefined && comparable > validation.max))
  ) {
    return false;
  }
  const length = typeof value === "string" || Array.isArray(value) ? value.length : null;
  if (
    length !== null &&
    ((validation.minLength !== undefined && length < validation.minLength) ||
      (validation.maxLength !== undefined && length > validation.maxLength))
  ) {
    return false;
  }
  return !(
    validation.pattern !== undefined &&
    typeof value === "string" &&
    !new RegExp(validation.pattern, "u").test(value)
  );
}

export function validateRentalDraft(
  values: RentalDraftValues,
  definition: CategoryFormSchema | null,
  locale: SupportedLocale,
  listingType: DraftListingType = "RENTAL",
): DraftFieldErrors {
  const copy = messages[locale];
  const errors: DraftFieldErrors = {};
  if (!values.categoryId) {
    errors.categoryId = listingType === "JOB" ? copy.jobCategory : copy.category;
  }
  if (!values.regionCode) errors.regionCode = copy.region;
  if (values.title.trim().length < 5) errors.title = copy.title;
  if (values.body.trim().length < 20) errors.body = copy.body;
  if (
    values.priceUnit !== "FREE" &&
    values.priceUnit !== "NEGOTIABLE" &&
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(values.priceAmount)
  ) {
    errors.priceAmount = copy.price;
  } else if (
    values.priceUnit !== "FREE" &&
    values.priceUnit !== "NEGOTIABLE" &&
    Number(values.priceAmount) <= 0
  ) {
    errors.priceAmount = copy.price;
  }
  if (
    listingType === "JOB" &&
    !["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(values.priceUnit)
  ) {
    errors.priceAmount = copy.invalid;
  }
  for (const field of definition?.fields ?? []) {
    const value = values.attributes[field.key];
    if (field.key === "employmentPolicyAcknowledged" && value !== true) {
      errors[`attribute.${field.key}`] = copy.required;
    } else if (field.required && isEmptyValue(value)) {
      errors[`attribute.${field.key}`] = copy.required;
    } else if (!validFieldValue(field, value)) {
      errors[`attribute.${field.key}`] = copy.invalid;
    }
  }
  return errors;
}

function price(values: RentalDraftValues): CreateListingInput["price"] {
  return {
    amount:
      values.priceUnit === "FREE" || values.priceUnit === "NEGOTIABLE" ? null : values.priceAmount,
    currency: "USD",
    unit: values.priceUnit,
  };
}

export function toCreateListingInput(
  values: RentalDraftValues,
  locale: SupportedLocale,
  listingType: DraftListingType = "RENTAL",
): CreateListingInput {
  return {
    type: listingType,
    locale,
    categoryId: values.categoryId,
    regionCode: values.regionCode,
    title: values.title.trim(),
    ...(values.summary.trim() ? { summary: values.summary.trim() } : {}),
    body: values.body.trim(),
    price: price(values),
    location: { precision: "CITY" },
    attributes: structuredClone(values.attributes),
    mediaIds: [...values.mediaIds],
    contactMode: values.contactMode,
  };
}

export function toUpdateListingInput(
  values: RentalDraftValues,
  locale: SupportedLocale,
): UpdateListingInput {
  return {
    locale,
    categoryId: values.categoryId,
    regionCode: values.regionCode,
    title: values.title.trim(),
    summary: values.summary.trim() || null,
    body: values.body.trim(),
    price: price(values),
    location: { precision: "CITY" },
    attributes: structuredClone(values.attributes),
    mediaIds: [...values.mediaIds],
    contactMode: values.contactMode,
  };
}

export function valuesFromOwnerListing(listing: ListingOwnerView): RentalDraftValues {
  return {
    categoryId: listing.category.id,
    regionCode: listing.region.code,
    title: listing.title,
    summary: listing.summary ?? "",
    body: listing.body,
    priceAmount: listing.price?.amount ?? "",
    priceUnit:
      listing.price?.unit === "WEEKLY" ||
      listing.price?.unit === "DAILY" ||
      listing.price?.unit === "HOURLY" ||
      listing.price?.unit === "YEARLY" ||
      listing.price?.unit === "NEGOTIABLE" ||
      listing.price?.unit === "FREE"
        ? listing.price.unit
        : "MONTHLY",
    attributes: structuredClone(listing.attributes),
    mediaIds: [...listing.mediaIds],
    contactMode: listing.contactMode,
  };
}

export function rentalDraftStorageKey(
  userId: string,
  locale: SupportedLocale,
  listingType: DraftListingType = "RENTAL",
): string {
  const vertical = listingType === "JOB" ? "job" : "rental";
  return `socal:${vertical}-draft:v1:${userId}:${locale}`;
}

export function parseStoredRentalDraft(
  value: string | null,
  userId: string,
  locale: SupportedLocale,
  listingType: DraftListingType = "RENTAL",
): StoredRentalDraft | null {
  if (!value || value.length > 250_000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isPlainRecord(parsed) ||
      parsed.version !== 1 ||
      (parsed.listingType !== undefined && parsed.listingType !== listingType) ||
      parsed.userId !== userId ||
      parsed.locale !== locale ||
      typeof parsed.idempotencyKey !== "string" ||
      parsed.idempotencyKey.length < 16 ||
      (parsed.listingId !== null && typeof parsed.listingId !== "string") ||
      (parsed.etag !== null && typeof parsed.etag !== "string") ||
      typeof parsed.savedAt !== "string" ||
      !isPlainRecord(parsed.values)
    ) {
      return null;
    }
    const values = parsed.values;
    if (
      typeof values.categoryId !== "string" ||
      typeof values.regionCode !== "string" ||
      typeof values.title !== "string" ||
      values.title.length > 120 ||
      typeof values.summary !== "string" ||
      values.summary.length > 240 ||
      typeof values.body !== "string" ||
      values.body.length > 10_000 ||
      typeof values.priceAmount !== "string" ||
      !["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY", "NEGOTIABLE", "FREE"].includes(
        String(values.priceUnit),
      ) ||
      !isPlainRecord(values.attributes) ||
      !Array.isArray(values.mediaIds) ||
      values.mediaIds.length > 20 ||
      !values.mediaIds.every((id) => typeof id === "string") ||
      !["IN_APP", "PHONE_REVEAL", "EMAIL_REVEAL"].includes(String(values.contactMode))
    ) {
      return null;
    }
    return { ...(parsed as Omit<StoredRentalDraft, "listingType">), listingType };
  } catch {
    return null;
  }
}
