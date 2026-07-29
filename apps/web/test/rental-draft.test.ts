import { describe, expect, it } from "vitest";
import type { CategoryFormSchema, ListingOwnerView } from "@socal/contracts";
import {
  emptyRentalDraft,
  parseStoredRentalDraft,
  rentalDraftStorageKey,
  toCreateListingInput,
  validateRentalDraft,
  valuesFromOwnerListing,
  type StoredRentalDraft,
} from "../src/lib/rental-draft";

const categoryId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const definition: CategoryFormSchema = {
  categoryId,
  version: 1,
  fields: [
    {
      key: "bedrooms",
      type: "NUMBER",
      label: { "zh-Hans": "卧室数", "en-US": "Bedrooms" },
      required: true,
      filterable: true,
      searchable: false,
      visibility: "PUBLIC",
      sortOrder: 10,
      validation: { min: 0, max: 20 },
    },
  ],
};

describe("rental draft model", () => {
  it("validates base and versioned dynamic fields before server autosave", () => {
    const values = emptyRentalDraft();
    expect(validateRentalDraft(values, definition, "zh-Hans")).toMatchObject({
      categoryId: "请选择房屋类型。",
      regionCode: "请选择城市。",
      title: "标题至少需要 5 个字符。",
      body: "详情至少需要 20 个字符。",
      "attribute.bedrooms": "此项为必填项。",
    });

    const valid = {
      ...values,
      categoryId,
      regionCode: "US-CA-IRVINE",
      title: "测试出租房源",
      body: "这是用于自动保存边界测试的虚构房源详情，绝不作为真实生产数据。",
      priceAmount: "2450.00",
      attributes: { bedrooms: 2 },
      mediaIds: [mediaId],
    };
    expect(validateRentalDraft(valid, definition, "zh-Hans")).toEqual({});
    expect(toCreateListingInput(valid, "zh-Hans")).toMatchObject({
      type: "RENTAL",
      categoryId,
      regionCode: "US-CA-IRVINE",
      price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
      attributes: { bedrooms: 2 },
      mediaIds: [mediaId],
    });

    const dateDefinition: CategoryFormSchema = {
      ...definition,
      fields: [
        ...definition.fields,
        {
          key: "available_on",
          type: "DATE",
          label: { "zh-Hans": "可入住日期", "en-US": "Available on" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 20,
        },
      ],
    };
    expect(
      validateRentalDraft(
        { ...valid, attributes: { bedrooms: 2, available_on: "2026-02-30" } },
        dateDefinition,
        "en-US",
      ),
    ).toHaveProperty("attribute.available_on");
    expect(
      validateRentalDraft(
        { ...valid, attributes: { bedrooms: 2, available_on: "2026-02-28" } },
        dateDefinition,
        "en-US",
      ),
    ).toEqual({});
  });

  it("isolates and bounds browser recovery by user and locale", () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    const stored: StoredRentalDraft = {
      version: 1,
      listingType: "RENTAL",
      userId,
      locale: "en-US",
      idempotencyKey: "listing-draft:test-0001",
      listingId: null,
      etag: null,
      savedAt: "2026-07-29T01:00:00.000Z",
      values: emptyRentalDraft(),
    };
    const serialized = JSON.stringify(stored);

    expect(rentalDraftStorageKey(userId, "en-US")).toContain(`${userId}:en-US`);
    expect(parseStoredRentalDraft(serialized, userId, "en-US")).toEqual(stored);
    expect(
      parseStoredRentalDraft(serialized, "44444444-4444-4444-8444-444444444444", "en-US"),
    ).toBeNull();
    expect(parseStoredRentalDraft(serialized, userId, "zh-Hans")).toBeNull();
    expect(parseStoredRentalDraft("{not-json", userId, "en-US")).toBeNull();
  });

  it("validates Job wage periods and requires an affirmative employment policy", () => {
    const jobDefinition: CategoryFormSchema = {
      categoryId,
      version: 1,
      fields: [
        {
          key: "wageMax",
          type: "MONEY",
          label: { "zh-Hans": "最高薪资", "en-US": "Maximum wage" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 10,
          validation: { min: 0.01, max: 99999999.99 },
        },
        {
          key: "employmentPolicyAcknowledged",
          type: "BOOLEAN",
          label: { "zh-Hans": "就业政策", "en-US": "Employment policy" },
          required: true,
          filterable: false,
          searchable: false,
          visibility: "OWNER_ONLY",
          sortOrder: 20,
        },
      ],
    };
    const values = {
      ...emptyRentalDraft("JOB"),
      categoryId,
      regionCode: "US-CA-IRVINE",
      title: "测试招聘岗位",
      body: "这是用于招聘发布表单边界测试的虚构内容，不是真实生产职位信息。",
      priceAmount: "24.00",
      attributes: {
        wageMax: "31.50",
        employmentPolicyAcknowledged: false,
      },
    };

    expect(validateRentalDraft(values, jobDefinition, "zh-Hans", "JOB")).toHaveProperty(
      "attribute.employmentPolicyAcknowledged",
    );
    const valid = {
      ...values,
      attributes: { ...values.attributes, employmentPolicyAcknowledged: true },
    };
    expect(validateRentalDraft(valid, jobDefinition, "zh-Hans", "JOB")).toEqual({});
    expect(toCreateListingInput(valid, "zh-Hans", "JOB")).toMatchObject({
      type: "JOB",
      price: { amount: "24.00", currency: "USD", unit: "HOURLY" },
      attributes: {
        wageMax: "31.50",
        employmentPolicyAcknowledged: true,
      },
    });
    expect(rentalDraftStorageKey("job-owner", "en-US", "JOB")).toBe(
      "socal:job-draft:v1:job-owner:en-US",
    );
  });

  it("isolates Transfer, Secondhand, and Service drafts with vertical price and policy rules", () => {
    const cases = [
      {
        type: "TRANSFER" as const,
        unit: "FIXED" as const,
        amount: "125000.00",
        policyKey: "financialDisclaimerAcknowledged",
      },
      {
        type: "SECONDHAND" as const,
        unit: "FREE" as const,
        amount: "",
        policyKey: "marketplacePolicyAcknowledged",
      },
      {
        type: "SERVICE" as const,
        unit: "HOURLY" as const,
        amount: "95.00",
        policyKey: "servicePolicyAcknowledged",
      },
    ];

    for (const item of cases) {
      const verticalDefinition: CategoryFormSchema = {
        categoryId,
        version: 1,
        fields: [
          {
            key: item.policyKey,
            type: "BOOLEAN",
            label: { "zh-Hans": "政策确认", "en-US": "Policy acknowledgement" },
            required: true,
            filterable: false,
            searchable: false,
            visibility: "OWNER_ONLY",
            sortOrder: 100,
          },
        ],
      };
      const values = {
        ...emptyRentalDraft(item.type),
        categoryId,
        regionCode: "US-CA-IRVINE",
        title: `Synthetic ${item.type.toLowerCase()} listing`,
        body: "This is a deliberately fictional draft used only for a deterministic unit test.",
        priceAmount: item.amount,
        priceUnit: item.unit,
        attributes: { [item.policyKey]: true },
      };

      expect(validateRentalDraft(values, verticalDefinition, "en-US", item.type)).toEqual({});
      expect(toCreateListingInput(values, "en-US", item.type)).toMatchObject({
        type: item.type,
        price: {
          amount: item.unit === "FREE" ? null : item.amount,
          unit: item.unit,
        },
      });
      expect(rentalDraftStorageKey("vertical-owner", "en-US", item.type)).toBe(
        `socal:${item.type.toLowerCase()}-draft:v1:vertical-owner:en-US`,
      );
      expect(
        validateRentalDraft(
          { ...values, attributes: { [item.policyKey]: false } },
          verticalDefinition,
          "en-US",
          item.type,
        ),
      ).toHaveProperty(`attribute.${item.policyKey}`);
    }
  });

  it("restores only the owner-safe projection and READY media identifiers", () => {
    const listing = {
      id: "55555555-5555-4555-8555-555555555555",
      type: "RENTAL",
      ownerId: "33333333-3333-4333-8333-333333333333",
      organizationId: null,
      formSchemaVersion: 1,
      status: "DRAFT",
      moderationStatus: "NOT_REVIEWED",
      locale: "en-US",
      title: "Synthetic rental draft",
      slug: "synthetic-rental",
      summary: null,
      body: "Synthetic body used only in a unit test.",
      price: { amount: "1000.00", currency: "USD", unit: "MONTHLY" },
      region: {
        id: "66666666-6666-4666-8666-666666666666",
        type: "CITY",
        code: "US-CA-IRVINE",
        slug: "irvine",
        nameZhHans: "尔湾",
        nameEn: "Irvine",
        timezone: "America/Los_Angeles",
      },
      category: {
        id: categoryId,
        vertical: "RENTAL",
        slug: "apartment",
        nameZhHans: "公寓",
        nameEn: "Apartment",
      },
      owner: {
        id: "33333333-3333-4333-8333-333333333333",
        displayName: "Synthetic Owner",
        avatarUrl: null,
      },
      organization: null,
      location: { precision: "CITY" },
      contactMode: "IN_APP",
      attributes: { bedrooms: 1 },
      mediaIds: [mediaId],
      isFeatured: false,
      featuredUntil: null,
      publishedAt: null,
      expiresAt: null,
      createdAt: "2026-07-29T01:00:00.000Z",
      updatedAt: "2026-07-29T01:00:00.000Z",
      version: 1,
    } satisfies ListingOwnerView;

    expect(valuesFromOwnerListing(listing)).toMatchObject({
      categoryId,
      regionCode: "US-CA-IRVINE",
      title: "Synthetic rental draft",
      mediaIds: [mediaId],
      attributes: { bedrooms: 1 },
    });
  });
});
