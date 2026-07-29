import type { opensearchtypes } from "@opensearch-project/opensearch";

export const listingIndexSchemaVersion = 1;

export type ListingIndexNames = Readonly<{
  physical: string;
  readAlias: string;
  writeAlias: string;
}>;

export type ListingSearchAttribute = Readonly<{
  key: string;
  keywordValue?: string;
  textValue?: string;
  numberValue?: number;
  booleanValue?: boolean;
}>;

export type ListingSearchDocument = Readonly<{
  schemaVersion: typeof listingIndexSchemaVersion;
  id: string;
  type: "RENTAL" | "JOB" | "TRANSFER" | "SECONDHAND" | "SERVICE";
  status: "PUBLISHED";
  locale: "zh-Hans" | "en-US";
  slug: string;
  title: string;
  summary?: string | null;
  body: string;
  category: Readonly<{
    id: string;
    slug: string;
    path: readonly string[];
    nameZhHans: string;
    nameEn: string;
    aliases: readonly string[];
  }>;
  region: Readonly<{
    id: string;
    code: string;
    slug: string;
    path: readonly string[];
    nameZhHans: string;
    nameEn: string;
    aliases: readonly string[];
  }>;
  price: Readonly<{
    amountMinor?: number | null;
    currency: "USD";
    unit:
      | "FIXED"
      | "HOURLY"
      | "DAILY"
      | "WEEKLY"
      | "MONTHLY"
      | "YEARLY"
      | "SQFT"
      | "NEGOTIABLE"
      | "FREE";
  }>;
  location: Readonly<{
    precision: "CITY" | "NEIGHBORHOOD" | "APPROXIMATE";
    point?: Readonly<{ lat: number; lon: number }>;
  }>;
  attributes: readonly ListingSearchAttribute[];
  publisher: Readonly<{
    ownerId: string;
    displayName: string;
    avatarUrl?: string | null;
    organizationId?: string | null;
    organizationSlug?: string | null;
    organizationVerification?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";
  }>;
  qualityScore: number;
  isSponsored: boolean;
  promotion?: Readonly<{
    campaignId: string;
    placementId: string;
  }> | null;
  publishedAt: string;
  expiresAt: string;
  updatedAt: string;
  contentVersion: number;
  indexedAt: string;
}>;

export type ListingIndexDefinition = NonNullable<opensearchtypes.IndicesCreateRequest["body"]>;

const indexPrefixPattern = /^[a-z][a-z0-9_]{1,39}$/;

export function listingIndexNames(prefix: string): ListingIndexNames {
  if (!indexPrefixPattern.test(prefix)) {
    throw new Error(
      "OpenSearch index prefix must be 2-40 lowercase letters, digits, or underscores",
    );
  }
  const stem = `${prefix}_listings`;
  return {
    physical: `${stem}_v${listingIndexSchemaVersion}`,
    readAlias: `${stem}_read`,
    writeAlias: `${stem}_write`,
  };
}

const bilingualText = {
  type: "text",
  analyzer: "socal_bilingual_index",
  search_analyzer: "socal_bilingual_search",
  fields: {
    zh: {
      type: "text",
      analyzer: "socal_zh_index",
      search_analyzer: "socal_zh_search",
    },
    en: {
      type: "text",
      analyzer: "socal_en_index",
      search_analyzer: "socal_en_search",
    },
    prefix: {
      type: "text",
      analyzer: "socal_prefix_index",
      search_analyzer: "socal_prefix_search",
    },
    keyword: {
      type: "keyword",
      normalizer: "socal_keyword",
      ignore_above: 256,
    },
  },
} as const;

export function buildListingIndexDefinition(names: ListingIndexNames): ListingIndexDefinition {
  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 1,
      refresh_interval: "5s",
      "index.mapping.total_fields.limit": 200,
      analysis: {
        normalizer: {
          socal_keyword: {
            type: "custom",
            filter: ["lowercase", "asciifolding"],
          },
        },
        filter: {
          socal_en_possessive: {
            type: "stemmer",
            language: "possessive_english",
          },
          socal_en_stop: {
            type: "stop",
            stopwords: "_english_",
          },
          socal_en_stemmer: {
            type: "stemmer",
            language: "english",
          },
          socal_prefix_grams: {
            type: "edge_ngram",
            min_gram: 2,
            max_gram: 20,
          },
        },
        analyzer: {
          socal_bilingual_index: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "asciifolding", "cjk_bigram"],
          },
          socal_bilingual_search: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "asciifolding", "cjk_bigram"],
          },
          socal_zh_index: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "cjk_bigram"],
          },
          socal_zh_search: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "cjk_bigram"],
          },
          socal_en_index: {
            type: "custom",
            tokenizer: "standard",
            filter: [
              "socal_en_possessive",
              "lowercase",
              "socal_en_stop",
              "socal_en_stemmer",
              "asciifolding",
            ],
          },
          socal_en_search: {
            type: "custom",
            tokenizer: "standard",
            filter: [
              "socal_en_possessive",
              "lowercase",
              "socal_en_stop",
              "socal_en_stemmer",
              "asciifolding",
            ],
          },
          socal_prefix_index: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "asciifolding", "socal_prefix_grams"],
          },
          socal_prefix_search: {
            type: "custom",
            tokenizer: "standard",
            filter: ["cjk_width", "lowercase", "asciifolding"],
          },
        },
      },
    },
    mappings: {
      dynamic: "strict",
      _meta: {
        schemaVersion: listingIndexSchemaVersion,
        projection: "public-listing",
        canonicalSource: "postgresql",
        pii: "excluded",
      },
      properties: {
        schemaVersion: { type: "integer" },
        id: { type: "keyword" },
        type: { type: "keyword" },
        status: { type: "keyword" },
        locale: { type: "keyword" },
        slug: { type: "keyword", normalizer: "socal_keyword" },
        title: bilingualText,
        summary: bilingualText,
        body: {
          type: "text",
          analyzer: "socal_bilingual_index",
          search_analyzer: "socal_bilingual_search",
          fields: {
            zh: {
              type: "text",
              analyzer: "socal_zh_index",
              search_analyzer: "socal_zh_search",
            },
            en: {
              type: "text",
              analyzer: "socal_en_index",
              search_analyzer: "socal_en_search",
            },
          },
        },
        category: {
          type: "object",
          dynamic: "strict",
          properties: {
            id: { type: "keyword" },
            slug: { type: "keyword", normalizer: "socal_keyword" },
            path: { type: "keyword", normalizer: "socal_keyword" },
            nameZhHans: bilingualText,
            nameEn: bilingualText,
            aliases: bilingualText,
          },
        },
        region: {
          type: "object",
          dynamic: "strict",
          properties: {
            id: { type: "keyword" },
            code: { type: "keyword", normalizer: "socal_keyword" },
            slug: { type: "keyword", normalizer: "socal_keyword" },
            path: { type: "keyword", normalizer: "socal_keyword" },
            nameZhHans: bilingualText,
            nameEn: bilingualText,
            aliases: bilingualText,
          },
        },
        price: {
          type: "object",
          dynamic: "strict",
          properties: {
            amountMinor: { type: "long" },
            currency: { type: "keyword" },
            unit: { type: "keyword" },
          },
        },
        location: {
          type: "object",
          dynamic: "strict",
          properties: {
            precision: { type: "keyword" },
            point: { type: "geo_point", ignore_malformed: false },
          },
        },
        attributes: {
          type: "nested",
          dynamic: "strict",
          properties: {
            key: { type: "keyword", normalizer: "socal_keyword" },
            keywordValue: { type: "keyword", normalizer: "socal_keyword", ignore_above: 256 },
            textValue: bilingualText,
            numberValue: { type: "double" },
            booleanValue: { type: "boolean" },
          },
        },
        publisher: {
          type: "object",
          dynamic: "strict",
          properties: {
            ownerId: { type: "keyword" },
            displayName: bilingualText,
            avatarUrl: { type: "keyword", index: false, doc_values: false },
            organizationId: { type: "keyword" },
            organizationSlug: { type: "keyword", normalizer: "socal_keyword" },
            organizationVerification: { type: "keyword" },
          },
        },
        qualityScore: { type: "scaled_float", scaling_factor: 1_000 },
        isSponsored: { type: "boolean" },
        promotion: {
          type: "object",
          dynamic: "strict",
          properties: {
            campaignId: { type: "keyword" },
            placementId: { type: "keyword" },
          },
        },
        publishedAt: { type: "date", format: "strict_date_time" },
        expiresAt: { type: "date", format: "strict_date_time" },
        updatedAt: { type: "date", format: "strict_date_time" },
        contentVersion: { type: "long" },
        indexedAt: { type: "date", format: "strict_date_time" },
      },
    },
    aliases: {
      [names.readAlias]: {},
      [names.writeAlias]: { is_write_index: true },
    },
  };
}
