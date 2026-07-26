import { config } from "dotenv";
import { assertSyntheticSeedAllowed } from "../src/seed/seed-policy";

config({ path: "../../.env" });

const applicationEnvironment = process.env.APP_ENV ?? "local";
assertSyntheticSeedAllowed(applicationEnvironment);

const [{ prisma }, { loadSeedData }, { seedDatabase }] = await Promise.all([
  import("../src/client"),
  import("../src/seed/seed-data"),
  import("../src/seed/seed-database"),
]);

try {
  const summary = await seedDatabase(prisma, await loadSeedData());
  console.log(JSON.stringify({ event: "database.seed.completed", ...summary }));
} finally {
  await prisma.$disconnect();
}
