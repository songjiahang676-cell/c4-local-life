import { normalizeTaxonomyAlias } from "@socal/database/taxonomy";
import type {
  CategoryTaxonomyRecord,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  RegionTaxonomyRecord,
  TaxonomyStore,
} from "../../src/modules/taxonomy/taxonomy.store";

function matchesQuery(
  query: string,
  values: readonly string[],
  aliases: RegionTaxonomyRecord["aliases"],
): boolean {
  const normalizedQuery = normalizeTaxonomyAlias(query);
  const loweredQuery = query.toLocaleLowerCase("en-US");
  return (
    values.some((value) => value.toLocaleLowerCase("en-US").includes(loweredQuery)) ||
    aliases.some((alias) => normalizeTaxonomyAlias(alias.value).startsWith(normalizedQuery))
  );
}

export class MemoryTaxonomyStore implements TaxonomyStore {
  constructor(
    readonly regions: readonly RegionTaxonomyRecord[] = [],
    readonly categories: readonly CategoryTaxonomyRecord[] = [],
  ) {}

  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]> {
    const parentId = input.parentCode
      ? this.regions.find((region) => region.code === input.parentCode)?.id
      : undefined;
    return Promise.resolve(
      this.regions
        .filter((region) => !input.activeOnly || region.isActive)
        .filter((region) => !input.type || region.type === input.type)
        .filter((region) => !input.parentCode || region.parentId === parentId)
        .filter(
          (region) =>
            !input.query ||
            matchesQuery(
              input.query,
              [region.code, region.slug, region.nameZhHans, region.nameEn],
              region.aliases,
            ),
        )
        .map((region) => ({ ...region, aliases: [...region.aliases] })),
    );
  }

  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]> {
    return Promise.resolve(
      this.categories
        .filter((category) => !input.activeOnly || category.isActive)
        .filter((category) => !input.vertical || category.vertical === input.vertical)
        .filter((category) => !input.parentId || category.parentId === input.parentId)
        .filter(
          (category) =>
            !input.query ||
            matchesQuery(
              input.query,
              [category.slug, category.nameZhHans, category.nameEn],
              category.aliases,
            ),
        )
        .map((category) => ({ ...category, aliases: [...category.aliases] })),
    );
  }
}
