import { loadSeedData } from "./seed-data";

const seed = await loadSeedData();
console.log(
  JSON.stringify({
    event: "database.seed.validated",
    versions: {
      regions: seed.regions.version,
      categories: seed.categories.version,
      listings: seed.listings.version,
      homepage: seed.homepage.version,
    },
    counts: {
      metros: seed.regions.metros.length,
      regionAliases:
        seed.regions.country.aliases.length +
        seed.regions.state.aliases.length +
        seed.regions.metros.reduce(
          (total, metro) =>
            total +
            metro.aliases.length +
            metro.children.reduce((childTotal, child) => childTotal + child.aliases.length, 0),
          0,
        ),
      verticals: seed.categories.verticals.length,
      categoryFormTemplates: seed.categories.verticals.reduce(
        (total, vertical) => total + vertical.formFields.length,
        0,
      ),
      categoryAliases:
        seed.categories.verticals.reduce(
          (total, vertical) =>
            total +
            vertical.aliases.length +
            vertical.children.reduce((childTotal, child) => childTotal + child.aliases.length, 0),
          0,
        ) +
        seed.categories.communityCategories.reduce(
          (total, category) => total + category.aliases.length,
          0,
        ),
      sampleListings: seed.listings.listings.length,
      homepageSlots: seed.homepage.slots.length,
    },
  }),
);
