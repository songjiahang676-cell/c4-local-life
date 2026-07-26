import { ListingType } from "../generated/prisma/enums";
import {
  InvalidGeoQueryError,
  ListingGeoRepository,
} from "../src/repositories/listing-geo.repository";
import { describe, expect, it, vi } from "vitest";

type RepositoryClient = ConstructorParameters<typeof ListingGeoRepository>[0];

function repositoryWithMock() {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const client = { $queryRaw: queryRaw } as unknown as RepositoryClient;
  return { repository: new ListingGeoRepository(client), queryRaw };
}

describe("ListingGeoRepository query validation", () => {
  it.each([
    { longitude: -181, latitude: 33.68, radiusMiles: 5 },
    { longitude: -117.82, latitude: 91, radiusMiles: 5 },
    { longitude: -117.82, latitude: 33.68, radiusMiles: 0 },
    { longitude: -117.82, latitude: 33.68, radiusMiles: 251 },
    { longitude: -117.82, latitude: 33.68, radiusMiles: 5, limit: 101 },
    {
      longitude: -117.82,
      latitude: 33.68,
      radiusMiles: 5,
      listingType: "UNTRUSTED" as ListingType,
    },
  ])("rejects unsafe or unbounded input %#", (input) => {
    const { repository, queryRaw } = repositoryWithMock();

    expect(() => repository.findPublishedWithinRadius(input)).toThrow(InvalidGeoQueryError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("executes one parameterized query for valid bounded input", async () => {
    const { repository, queryRaw } = repositoryWithMock();

    await expect(
      repository.findPublishedWithinRadius({
        longitude: -117.8265,
        latitude: 33.6846,
        radiusMiles: 10,
        listingType: ListingType.RENTAL,
        limit: 20,
      }),
    ).resolves.toEqual([]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
