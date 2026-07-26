import { randomUUID } from "node:crypto";
import {
  ContentStatus,
  ListingType,
  ModerationStatus,
  type Prisma,
} from "../../generated/prisma/client";

export function buildTestUser(
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
): Prisma.UserUncheckedCreateInput {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    email: `fictional-${id}@example.invalid`,
    ...overrides,
  };
}

export function buildTestListing(
  relations: { ownerId: string; categoryId: string; regionId: string },
  overrides: Partial<Prisma.ListingUncheckedCreateInput> = {},
): Prisma.ListingUncheckedCreateInput {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    type: ListingType.RENTAL,
    ownerId: relations.ownerId,
    categoryId: relations.categoryId,
    regionId: relations.regionId,
    status: ContentStatus.DRAFT,
    moderationStatus: ModerationStatus.NOT_REVIEWED,
    title: "Fictional repository test listing",
    slug: `fictional-${id}`,
    body: "Synthetic test data only; this is not a real advertisement.",
    attributes: {},
    ...overrides,
  };
}
