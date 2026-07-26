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
      verticals: seed.categories.verticals.length,
      sampleListings: seed.listings.listings.length,
      homepageSlots: seed.homepage.slots.length,
    },
  }),
);
