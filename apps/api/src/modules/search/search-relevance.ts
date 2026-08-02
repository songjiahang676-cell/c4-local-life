export const searchRelevanceLocales = ["zh-Hans", "en-US"] as const;

export type SearchRelevanceLocale = (typeof searchRelevanceLocales)[number];

export type SearchRelevanceThresholds = Readonly<{
  ndcgAt10: number;
  mrr: number;
  recallAt10: number;
  maximumZeroResultRate: number;
}>;

export type SearchRelevanceDocument = Readonly<{
  id: string;
  locale: SearchRelevanceLocale;
  type: "RENTAL" | "JOB" | "TRANSFER" | "SECONDHAND" | "SERVICE";
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: Readonly<{
    id: string;
    slug: string;
    nameZhHans: string;
    nameEn: string;
    aliases: readonly string[];
  }>;
  region: Readonly<{
    id: string;
    code: string;
    slug: string;
    nameZhHans: string;
    nameEn: string;
    aliases: readonly string[];
  }>;
  qualityScore: number;
  publishedAt: string;
}>;

export type SearchRelevanceQuery = Readonly<{
  id: string;
  locale: SearchRelevanceLocale;
  query: string;
  judgments: readonly Readonly<{
    documentId: string;
    grade: 1 | 2 | 3;
  }>[];
}>;

export type SearchRelevanceDataset = Readonly<{
  schemaVersion: 1;
  datasetId: string;
  classification: "SYNTHETIC";
  locales: readonly SearchRelevanceLocale[];
  cutoff: 10;
  thresholds: SearchRelevanceThresholds;
  documents: readonly SearchRelevanceDocument[];
  queries: readonly SearchRelevanceQuery[];
}>;

export type SearchRelevanceRun = Readonly<{
  queryId: string;
  documentIds: readonly string[];
}>;

export type SearchRelevanceMetrics = Readonly<{
  queryCount: number;
  ndcgAt10: number;
  mrr: number;
  recallAt10: number;
  zeroResultRate: number;
}>;

export type SearchRelevanceReport = Readonly<{
  datasetId: string;
  classification: "SYNTHETIC";
  cutoff: 10;
  thresholds: SearchRelevanceThresholds;
  overall: SearchRelevanceMetrics;
  byLocale: Readonly<Record<SearchRelevanceLocale, SearchRelevanceMetrics>>;
  passed: boolean;
}>;

export class SearchRelevanceDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchRelevanceDatasetError";
  }
}

type JsonRecord = Record<string, unknown>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierPattern = /^[a-z][a-z0-9-]{2,63}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const regionCodePattern = /^[A-Z0-9]+(?:-[A-Z0-9]+){2,5}$/;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const urlPattern = /(?:https?:\/\/|www\.)/iu;
const phonePattern = /(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10,}/u;
const listingTypes = new Set(["RENTAL", "JOB", "TRANSFER", "SECONDHAND", "SERVICE"]);

function fail(path: string, message: string): never {
  throw new SearchRelevanceDatasetError(`${path}: ${message}`);
}

function containsUnsafeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function exactRecord(value: unknown, path: string, keys: readonly string[]): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "must be an object");
  }
  const record = value as JsonRecord;
  const allowed = new Set(keys);
  const extras = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !(key in record));
  if (extras.length > 0) fail(path, `contains unknown fields: ${extras.join(", ")}`);
  if (missing.length > 0) fail(path, `is missing fields: ${missing.join(", ")}`);
  return record;
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string") return fail(path, "must be a string");
  if (value.trim() !== value) return fail(path, "must not contain leading or trailing whitespace");
  const normalized = value.normalize("NFKC");
  if (normalized.length < 1 || normalized.length > maximum) {
    return fail(path, `must be between 1 and ${maximum} characters`);
  }
  if (containsUnsafeText(normalized)) return fail(path, "contains unsafe control characters");
  return normalized;
}

function syntheticText(value: unknown, path: string, maximum: number): string {
  const text = boundedString(value, path, maximum);
  if (emailPattern.test(text) || urlPattern.test(text) || phonePattern.test(text)) {
    return fail(path, "must not contain contact information");
  }
  return text;
}

function identifier(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 64);
  if (parsed !== value) return fail(path, "must already use canonical ASCII form");
  if (!identifierPattern.test(parsed)) return fail(path, "must be a lowercase stable identifier");
  return parsed;
}

function uuid(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 36);
  if (parsed !== value) return fail(path, "must already use canonical ASCII form");
  if (!uuidPattern.test(parsed)) return fail(path, "must be a UUID");
  return parsed;
}

function locale(value: unknown, path: string): SearchRelevanceLocale {
  if (value === "zh-Hans" || value === "en-US") return value;
  return fail(path, "must be zh-Hans or en-US");
}

function score(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail(path, "must be a finite number from 0 through 1");
  }
  return value;
}

function stringList(value: unknown, path: string, maximumItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return fail(path, `must be an array with at most ${maximumItems} items`);
  }
  const parsed = value.map((entry, index) => syntheticText(entry, `${path}[${index}]`, 120));
  if (new Set(parsed).size !== parsed.length) return fail(path, "must not contain duplicates");
  return parsed;
}

function parseCategory(value: unknown, path: string): SearchRelevanceDocument["category"] {
  const input = exactRecord(value, path, ["id", "slug", "nameZhHans", "nameEn", "aliases"]);
  const slug = boundedString(input.slug, `${path}.slug`, 80);
  if (slug !== input.slug) fail(`${path}.slug`, "must already use canonical ASCII form");
  if (!slugPattern.test(slug)) fail(`${path}.slug`, "must be a lowercase slug");
  return {
    id: uuid(input.id, `${path}.id`),
    slug,
    nameZhHans: syntheticText(input.nameZhHans, `${path}.nameZhHans`, 120),
    nameEn: syntheticText(input.nameEn, `${path}.nameEn`, 120),
    aliases: stringList(input.aliases, `${path}.aliases`, 12),
  };
}

function parseRegion(value: unknown, path: string): SearchRelevanceDocument["region"] {
  const input = exactRecord(value, path, ["id", "code", "slug", "nameZhHans", "nameEn", "aliases"]);
  const code = boundedString(input.code, `${path}.code`, 80);
  const slug = boundedString(input.slug, `${path}.slug`, 80);
  if (code !== input.code) fail(`${path}.code`, "must already use canonical ASCII form");
  if (slug !== input.slug) fail(`${path}.slug`, "must already use canonical ASCII form");
  if (!regionCodePattern.test(code)) fail(`${path}.code`, "must be a bounded region code");
  if (!slugPattern.test(slug)) fail(`${path}.slug`, "must be a lowercase slug");
  return {
    id: uuid(input.id, `${path}.id`),
    code,
    slug,
    nameZhHans: syntheticText(input.nameZhHans, `${path}.nameZhHans`, 120),
    nameEn: syntheticText(input.nameEn, `${path}.nameEn`, 120),
    aliases: stringList(input.aliases, `${path}.aliases`, 12),
  };
}

function parseDocument(value: unknown, index: number): SearchRelevanceDocument {
  const path = `documents[${index}]`;
  const input = exactRecord(value, path, [
    "id",
    "locale",
    "type",
    "slug",
    "title",
    "summary",
    "body",
    "category",
    "region",
    "qualityScore",
    "publishedAt",
  ]);
  if (typeof input.type !== "string" || !listingTypes.has(input.type)) {
    fail(`${path}.type`, "must be a supported Listing type");
  }
  const slug = boundedString(input.slug, `${path}.slug`, 120);
  if (slug !== input.slug) fail(`${path}.slug`, "must already use canonical ASCII form");
  if (!slugPattern.test(slug)) fail(`${path}.slug`, "must be a lowercase slug");
  const publishedAt = boundedString(input.publishedAt, `${path}.publishedAt`, 40);
  if (publishedAt !== input.publishedAt) {
    fail(`${path}.publishedAt`, "must already use canonical ASCII form");
  }
  const instant = new Date(publishedAt);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== publishedAt) {
    fail(`${path}.publishedAt`, "must be a canonical UTC instant");
  }
  return {
    id: uuid(input.id, `${path}.id`),
    locale: locale(input.locale, `${path}.locale`),
    type: input.type as SearchRelevanceDocument["type"],
    slug,
    title: syntheticText(input.title, `${path}.title`, 160),
    summary: syntheticText(input.summary, `${path}.summary`, 500),
    body: syntheticText(input.body, `${path}.body`, 2_000),
    category: parseCategory(input.category, `${path}.category`),
    region: parseRegion(input.region, `${path}.region`),
    qualityScore: score(input.qualityScore, `${path}.qualityScore`),
    publishedAt,
  };
}

function parseQuery(
  value: unknown,
  index: number,
  documentIds: ReadonlySet<string>,
): SearchRelevanceQuery {
  const path = `queries[${index}]`;
  const input = exactRecord(value, path, ["id", "locale", "query", "judgments"]);
  if (
    !Array.isArray(input.judgments) ||
    input.judgments.length < 1 ||
    input.judgments.length > 20
  ) {
    return fail(`${path}.judgments`, "must contain between 1 and 20 judgments");
  }
  const judgments = input.judgments.map((rawJudgment, judgmentIndex) => {
    const judgmentPath = `${path}.judgments[${judgmentIndex}]`;
    const judgment = exactRecord(rawJudgment, judgmentPath, ["documentId", "grade"]);
    const documentId = uuid(judgment.documentId, `${judgmentPath}.documentId`);
    if (!documentIds.has(documentId)) fail(`${judgmentPath}.documentId`, "is not in the corpus");
    if (judgment.grade !== 1 && judgment.grade !== 2 && judgment.grade !== 3) {
      fail(`${judgmentPath}.grade`, "must be 1, 2, or 3");
    }
    return { documentId, grade: judgment.grade } as const;
  });
  if (new Set(judgments.map((entry) => entry.documentId)).size !== judgments.length) {
    fail(`${path}.judgments`, "must not judge the same document twice");
  }
  return {
    id: identifier(input.id, `${path}.id`),
    locale: locale(input.locale, `${path}.locale`),
    query: syntheticText(input.query, `${path}.query`, 120),
    judgments,
  };
}

export function parseSearchRelevanceDataset(value: unknown): SearchRelevanceDataset {
  const input = exactRecord(value, "dataset", [
    "schemaVersion",
    "datasetId",
    "classification",
    "locales",
    "cutoff",
    "thresholds",
    "documents",
    "queries",
  ]);
  if (input.schemaVersion !== 1) fail("dataset.schemaVersion", "must equal 1");
  if (input.classification !== "SYNTHETIC") {
    fail("dataset.classification", "must explicitly equal SYNTHETIC");
  }
  if (input.cutoff !== 10) fail("dataset.cutoff", "must equal 10");
  if (
    !Array.isArray(input.locales) ||
    input.locales.length !== 2 ||
    input.locales[0] !== "zh-Hans" ||
    input.locales[1] !== "en-US"
  ) {
    fail("dataset.locales", "must be the ordered pair zh-Hans, en-US");
  }
  const thresholdInput = exactRecord(input.thresholds, "dataset.thresholds", [
    "ndcgAt10",
    "mrr",
    "recallAt10",
    "maximumZeroResultRate",
  ]);
  const thresholds = {
    ndcgAt10: score(thresholdInput.ndcgAt10, "dataset.thresholds.ndcgAt10"),
    mrr: score(thresholdInput.mrr, "dataset.thresholds.mrr"),
    recallAt10: score(thresholdInput.recallAt10, "dataset.thresholds.recallAt10"),
    maximumZeroResultRate: score(
      thresholdInput.maximumZeroResultRate,
      "dataset.thresholds.maximumZeroResultRate",
    ),
  };
  if (
    !Array.isArray(input.documents) ||
    input.documents.length < 8 ||
    input.documents.length > 100
  ) {
    fail("dataset.documents", "must contain between 8 and 100 synthetic documents");
  }
  const documents = input.documents.map(parseDocument);
  const documentIds = new Set(documents.map((document) => document.id));
  if (documentIds.size !== documents.length) fail("dataset.documents", "must have unique IDs");
  if (!Array.isArray(input.queries) || input.queries.length < 8 || input.queries.length > 500) {
    fail("dataset.queries", "must contain between 8 and 500 queries");
  }
  const queries = input.queries.map((query, index) => parseQuery(query, index, documentIds));
  if (new Set(queries.map((query) => query.id)).size !== queries.length) {
    fail("dataset.queries", "must have unique IDs");
  }
  for (const requiredLocale of searchRelevanceLocales) {
    if (queries.filter((query) => query.locale === requiredLocale).length < 4) {
      fail("dataset.queries", `must contain at least four ${requiredLocale} queries`);
    }
  }
  return {
    schemaVersion: 1,
    datasetId: identifier(input.datasetId, "dataset.datasetId"),
    classification: "SYNTHETIC",
    locales: searchRelevanceLocales,
    cutoff: 10,
    thresholds,
    documents,
    queries,
  };
}

function discountedCumulativeGain(grades: readonly number[]): number {
  return grades.reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function aggregateMetrics(
  dataset: SearchRelevanceDataset,
  runs: ReadonlyMap<string, readonly string[]>,
  selectedQueries: readonly SearchRelevanceQuery[],
): SearchRelevanceMetrics {
  let ndcg = 0;
  let reciprocalRank = 0;
  let recall = 0;
  let zeroResults = 0;
  for (const query of selectedQueries) {
    const ranking = runs.get(query.id) ?? [];
    if (ranking.length === 0) zeroResults += 1;
    const grades = new Map(
      query.judgments.map((judgment) => [judgment.documentId, judgment.grade]),
    );
    const rankedGrades = ranking
      .slice(0, dataset.cutoff)
      .map((documentId) => grades.get(documentId) ?? 0);
    const idealGrades = query.judgments
      .map((judgment) => judgment.grade)
      .sort((left, right) => right - left)
      .slice(0, dataset.cutoff);
    const ideal = discountedCumulativeGain(idealGrades);
    ndcg += ideal === 0 ? 0 : discountedCumulativeGain(rankedGrades) / ideal;
    const firstRelevant = ranking.findIndex((documentId) => grades.has(documentId));
    reciprocalRank += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1);
    const relevantAtCutoff = new Set(
      ranking.slice(0, dataset.cutoff).filter((documentId) => grades.has(documentId)),
    );
    recall += relevantAtCutoff.size / query.judgments.length;
  }
  const count = selectedQueries.length;
  return {
    queryCount: count,
    ndcgAt10: rounded(ndcg / count),
    mrr: rounded(reciprocalRank / count),
    recallAt10: rounded(recall / count),
    zeroResultRate: rounded(zeroResults / count),
  };
}

function meetsThresholds(
  metrics: SearchRelevanceMetrics,
  thresholds: SearchRelevanceThresholds,
): boolean {
  return (
    metrics.ndcgAt10 >= thresholds.ndcgAt10 &&
    metrics.mrr >= thresholds.mrr &&
    metrics.recallAt10 >= thresholds.recallAt10 &&
    metrics.zeroResultRate <= thresholds.maximumZeroResultRate
  );
}

export function evaluateSearchRelevance(
  dataset: SearchRelevanceDataset,
  rawRuns: readonly SearchRelevanceRun[],
): SearchRelevanceReport {
  if (rawRuns.length !== dataset.queries.length) {
    fail("runs", `must contain exactly ${dataset.queries.length} query runs`);
  }
  const corpusIds = new Set(dataset.documents.map((document) => document.id));
  const queryIds = new Set(dataset.queries.map((query) => query.id));
  const runs = new Map<string, readonly string[]>();
  rawRuns.forEach((run, index) => {
    if (!queryIds.has(run.queryId)) fail(`runs[${index}].queryId`, "is not in the dataset");
    if (runs.has(run.queryId)) fail(`runs[${index}].queryId`, "is duplicated");
    if (run.documentIds.length > 50) {
      fail(`runs[${index}].documentIds`, "must contain at most 50 IDs");
    }
    if (new Set(run.documentIds).size !== run.documentIds.length) {
      fail(`runs[${index}].documentIds`, "must not contain duplicates");
    }
    run.documentIds.forEach((documentId, documentIndex) => {
      if (typeof documentId !== "string" || !corpusIds.has(documentId)) {
        fail(`runs[${index}].documentIds[${documentIndex}]`, "is not in the evaluation corpus");
      }
    });
    runs.set(run.queryId, run.documentIds);
  });
  const overall = aggregateMetrics(dataset, runs, dataset.queries);
  const byLocale = {
    "zh-Hans": aggregateMetrics(
      dataset,
      runs,
      dataset.queries.filter((query) => query.locale === "zh-Hans"),
    ),
    "en-US": aggregateMetrics(
      dataset,
      runs,
      dataset.queries.filter((query) => query.locale === "en-US"),
    ),
  };
  return {
    datasetId: dataset.datasetId,
    classification: dataset.classification,
    cutoff: dataset.cutoff,
    thresholds: dataset.thresholds,
    overall,
    byLocale,
    passed:
      meetsThresholds(overall, dataset.thresholds) &&
      searchRelevanceLocales.every((entry) => meetsThresholds(byLocale[entry], dataset.thresholds)),
  };
}
