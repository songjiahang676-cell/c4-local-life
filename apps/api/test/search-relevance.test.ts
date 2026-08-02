import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  evaluateSearchRelevance,
  parseSearchRelevanceDataset,
  SearchRelevanceDatasetError,
  type SearchRelevanceRun,
} from "../src/modules/search/search-relevance";

const datasetPath = new URL("../../../datasets/search-relevance/v1.json", import.meta.url);
const schemaPath = new URL("../../../schemas/search-relevance.schema.json", import.meta.url);
const rawDataset = JSON.parse(readFileSync(datasetPath, "utf8")) as Record<string, unknown>;
const dataset = parseSearchRelevanceDataset(rawDataset);

function idealRuns(): SearchRelevanceRun[] {
  return dataset.queries.map((query) => ({
    queryId: query.id,
    documentIds: [...query.judgments]
      .sort((left, right) => right.grade - left.grade)
      .map((judgment) => judgment.documentId),
  }));
}

describe("synthetic bilingual search relevance evaluation", () => {
  it("validates the checked-in query set against JSON Schema and strict runtime boundaries", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const validate = addFormats(new Ajv2020({ allErrors: true, strict: true })).compile(schema);

    expect(validate(rawDataset), JSON.stringify(validate.errors)).toBe(true);
    expect(dataset.classification).toBe("SYNTHETIC");
    expect(dataset.documents).toHaveLength(8);
    expect(dataset.queries.filter((query) => query.locale === "zh-Hans")).toHaveLength(8);
    expect(dataset.queries.filter((query) => query.locale === "en-US")).toHaveLength(8);
  });

  it("computes NDCG@10, MRR, Recall@10, and zero-result rate by locale and overall", () => {
    const report = evaluateSearchRelevance(dataset, idealRuns());

    expect(report).toMatchObject({
      classification: "SYNTHETIC",
      cutoff: 10,
      passed: true,
      overall: {
        queryCount: 16,
        ndcgAt10: 1,
        mrr: 1,
        recallAt10: 1,
        zeroResultRate: 0,
      },
      byLocale: {
        "zh-Hans": { queryCount: 8 },
        "en-US": { queryCount: 8 },
      },
    });
  });

  it("uses graded gain rather than treating every relevant result as equal", () => {
    const runs = idealRuns();
    const first = runs[0];
    if (!first) throw new Error("The checked-in dataset must have a first query");
    runs[0] = { ...first, documentIds: [...first.documentIds].reverse() };

    const report = evaluateSearchRelevance(dataset, runs);
    const reversedNdcg = (3 + 7 / Math.log2(3)) / (7 + 3 / Math.log2(3));
    expect(report.byLocale["zh-Hans"].ndcgAt10).toBeCloseTo((7 + reversedNdcg) / 8, 5);
    expect(report.byLocale["zh-Hans"].recallAt10).toBe(1);
    expect(report.byLocale["zh-Hans"].mrr).toBe(1);
  });

  it("fails thresholds on empty rankings and rejects incomplete, duplicate, or unknown runs", () => {
    const emptyRuns = dataset.queries.map((query) => ({ queryId: query.id, documentIds: [] }));
    const report = evaluateSearchRelevance(dataset, emptyRuns);
    expect(report.passed).toBe(false);
    expect(report.overall).toMatchObject({
      ndcgAt10: 0,
      mrr: 0,
      recallAt10: 0,
      zeroResultRate: 1,
    });

    expect(() => evaluateSearchRelevance(dataset, emptyRuns.slice(1))).toThrow(
      SearchRelevanceDatasetError,
    );
    expect(() =>
      evaluateSearchRelevance(dataset, [emptyRuns[0]!, ...emptyRuns.slice(0, -1)]),
    ).toThrow(/duplicated/u);
    expect(() =>
      evaluateSearchRelevance(dataset, [
        { queryId: "not-in-dataset", documentIds: [] },
        ...emptyRuns.slice(1),
      ]),
    ).toThrow(/not in the dataset/u);
  });

  it("rejects contact-like query content and unknown dataset fields", () => {
    expect(() =>
      parseSearchRelevanceDataset({ ...rawDataset, sourceQueries: ["private"] }),
    ).toThrow(/unknown fields/u);

    const tampered = structuredClone(rawDataset);
    const queries = tampered.queries;
    if (!Array.isArray(queries) || !queries[0] || typeof queries[0] !== "object") {
      throw new Error("The checked-in dataset query structure changed unexpectedly");
    }
    queries[0] = { ...(queries[0] as Record<string, unknown>), query: "call 949-555-0100" };
    expect(() => parseSearchRelevanceDataset(tampered)).toThrow(/contact information/u);
  });
});
