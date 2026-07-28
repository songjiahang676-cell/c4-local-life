import type {
  CategoryTaxonomyRecord,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  RegionTaxonomyRecord,
} from "@socal/database/taxonomy";

export const TAXONOMY_STORE = Symbol("TAXONOMY_STORE");

export type TaxonomyStore = {
  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]>;
  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]>;
};

export type {
  CategoryTaxonomyRecord,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  RegionTaxonomyRecord,
};
