-- Reference form of ListingGeoRepository's geo + recency query.
-- Parameters: $1 longitude, $2 latitude, $3 radius_miles, $4 listing_type, $5 limit.
-- The TypeScript repository validates bounds before executing this bound-parameter SQL.
WITH query_origin AS (
  SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point
)
SELECT
  listing.id,
  listing.type,
  listing.title,
  listing.slug,
  listing.price_amount,
  listing.price_unit,
  listing.published_at,
  listing.is_featured,
  ST_Distance(listing.geo_point, query_origin.point) / 1609.344 AS distance_miles
FROM listings AS listing
CROSS JOIN query_origin
INNER JOIN categories AS category ON category.id = listing.category_id
  AND category.is_active = true
INNER JOIN regions AS region ON region.id = listing.region_id
  AND region.is_active = true
WHERE listing.status = 'PUBLISHED'::"ContentStatus"
  AND listing.moderation_status IN (
    'AUTO_APPROVED'::"ModerationStatus",
    'APPROVED'::"ModerationStatus"
  )
  AND listing.published_at IS NOT NULL
  AND listing.deleted_at IS NULL
  AND (listing.expires_at IS NULL OR listing.expires_at > CURRENT_TIMESTAMP)
  AND listing.type = $4::"ListingType"
  AND listing.geo_point IS NOT NULL
  AND ST_DWithin(
    listing.geo_point,
    query_origin.point,
    $3 * 1609.344
  )
ORDER BY
  listing.is_featured DESC,
  ST_Distance(listing.geo_point, query_origin.point) ASC,
  listing.published_at DESC,
  listing.id ASC
LIMIT $5;
