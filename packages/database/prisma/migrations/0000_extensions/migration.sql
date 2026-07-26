-- Bootstrap extensions only. This migration is safe to run before application tables exist.
-- PostgreSQL roles used by migrations must be allowed to create these extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
