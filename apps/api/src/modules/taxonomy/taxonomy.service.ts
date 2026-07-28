import { Inject, Injectable } from "@nestjs/common";
import type {
  Category,
  CategoryCollectionResponse,
  ListCategoriesQuery,
  ListRegionsQuery,
  Region,
  RegionCollectionResponse,
} from "@socal/contracts";
import {
  TAXONOMY_STORE,
  type CategoryTaxonomyRecord,
  type RegionTaxonomyRecord,
  type TaxonomyStore,
} from "./taxonomy.store";

function mapRegion(record: RegionTaxonomyRecord, children: readonly Region[] = []): Region {
  return {
    id: record.id,
    parentId: record.parentId,
    code: record.code,
    type: record.type,
    slug: record.slug,
    name: {
      "zh-Hans": record.nameZhHans,
      "en-US": record.nameEn,
    },
    timezone: record.timezone,
    centroid:
      record.latitude === null || record.longitude === null
        ? null
        : { latitude: record.latitude, longitude: record.longitude },
    active: record.isActive,
    aliases: record.aliases,
    children,
  };
}

function mapCategory(record: CategoryTaxonomyRecord, children: readonly Category[] = []): Category {
  return {
    id: record.id,
    parentId: record.parentId,
    vertical: record.vertical,
    slug: record.slug,
    name: {
      "zh-Hans": record.nameZhHans,
      "en-US": record.nameEn,
    },
    iconKey: record.iconKey,
    formSchemaVersion: record.formSchemaVersion,
    active: record.isActive,
    aliases: record.aliases,
    children,
  };
}

function regionTree(records: readonly RegionTaxonomyRecord[]): Region[] {
  const childrenByParent = new Map<string | null, RegionTaxonomyRecord[]>();
  for (const record of records) {
    const children = childrenByParent.get(record.parentId) ?? [];
    children.push(record);
    childrenByParent.set(record.parentId, children);
  }
  const build = (record: RegionTaxonomyRecord, ancestors: ReadonlySet<string>): Region => {
    if (ancestors.has(record.id)) return mapRegion(record);
    const lineage = new Set(ancestors);
    lineage.add(record.id);
    return mapRegion(
      record,
      (childrenByParent.get(record.id) ?? []).map((child) => build(child, lineage)),
    );
  };
  return (childrenByParent.get(null) ?? []).map((record) => build(record, new Set()));
}

function categoryTree(records: readonly CategoryTaxonomyRecord[]): Category[] {
  const childrenByParent = new Map<string | null, CategoryTaxonomyRecord[]>();
  for (const record of records) {
    const children = childrenByParent.get(record.parentId) ?? [];
    children.push(record);
    childrenByParent.set(record.parentId, children);
  }
  const build = (record: CategoryTaxonomyRecord, ancestors: ReadonlySet<string>): Category => {
    if (ancestors.has(record.id)) return mapCategory(record);
    const lineage = new Set(ancestors);
    lineage.add(record.id);
    return mapCategory(
      record,
      (childrenByParent.get(record.id) ?? []).map((child) => build(child, lineage)),
    );
  };
  return (childrenByParent.get(null) ?? []).map((record) => build(record, new Set()));
}

@Injectable()
export class TaxonomyService {
  constructor(@Inject(TAXONOMY_STORE) private readonly store: TaxonomyStore) {}

  async listRegions(query: ListRegionsQuery): Promise<RegionCollectionResponse> {
    const records = await this.store.listRegions({
      activeOnly: query.activeOnly ?? true,
      ...(query.parentCode ? { parentCode: query.parentCode } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.q ? { query: query.q } : {}),
    });
    const isTreeQuery = !query.parentCode && !query.type && !query.q;
    return {
      data: isTreeQuery ? regionTree(records) : records.map((record) => mapRegion(record)),
    };
  }

  async listCategories(query: ListCategoriesQuery): Promise<CategoryCollectionResponse> {
    const records = await this.store.listCategories({
      activeOnly: query.activeOnly ?? true,
      ...(query.vertical ? { vertical: query.vertical } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.q ? { query: query.q } : {}),
    });
    const isTreeQuery = !query.parentId && !query.q;
    return {
      data: isTreeQuery ? categoryTree(records) : records.map((record) => mapCategory(record)),
    };
  }
}
