-- Additive taxonomy support for the Southern California region-group seed.
-- PostgreSQL enum values are forward-only in normal operations.
ALTER TYPE "RegionType" ADD VALUE IF NOT EXISTS 'REGION_GROUP';
