-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LIMITED', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('MERCHANT', 'SERVICE_PROVIDER', 'SUPPLIER', 'MEDIA', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'BILLING', 'ANALYST');

-- CreateEnum
CREATE TYPE "RegionType" AS ENUM ('COUNTRY', 'STATE', 'COUNTY', 'CITY', 'NEIGHBORHOOD', 'ZIP_CODE');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('JOB', 'RENTAL', 'TRANSFER', 'SECONDHAND', 'SERVICE');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'EXPIRED', 'ARCHIVED', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('NOT_REVIEWED', 'AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('FIXED', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'SQFT', 'NEGOTIABLE', 'FREE');

-- CreateEnum
CREATE TYPE "ContactMode" AS ENUM ('IN_APP', 'PHONE_REVEAL', 'EMAIL_REVEAL');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'SCANNING', 'READY', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'DELETED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'TRIAGED', 'ACTIONED', 'DISMISSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'APPEALED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'REQUIRES_PAYMENT', 'PAID', 'FULFILLED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "phone_e164" VARCHAR(32),
    "password_hash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "trust_score" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "avatar_url" VARCHAR(1024),
    "preferred_locale" VARCHAR(16) NOT NULL DEFAULT 'zh-Hans',
    "bio" VARCHAR(500),
    "home_region_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email_at_provider" VARCHAR(320),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_hash" VARCHAR(128),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "legal_name" VARCHAR(200),
    "display_name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "RegionType" NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name_zh_hans" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "vertical" "ListingType",
    "slug" VARCHAR(120) NOT NULL,
    "name_zh_hans" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "icon_key" VARCHAR(80),
    "form_schema_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_fields" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label_zh_hans" VARCHAR(120) NOT NULL,
    "label_en" VARCHAR(120) NOT NULL,
    "field_type" VARCHAR(40) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_filterable" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "validation" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "type" "ListingType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "organization_id" UUID,
    "category_id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "moderation_status" "ModerationStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-Hans',
    "title" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(240),
    "body" TEXT NOT NULL,
    "price_amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "price_unit" "PriceUnit",
    "contact_mode" "ContactMode" NOT NULL DEFAULT 'IN_APP',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location_precision" VARCHAR(24) NOT NULL DEFAULT 'CITY',
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "featured_until" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_details" (
    "listing_id" UUID NOT NULL,
    "employer_name" VARCHAR(160),
    "employment_type" VARCHAR(40),
    "wage_min" DECIMAL(12,2),
    "wage_max" DECIMAL(12,2),
    "wage_unit" "PriceUnit",
    "experience_level" VARCHAR(40),
    "remote_type" VARCHAR(40),
    "visa_support" BOOLEAN,

    CONSTRAINT "job_details_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "rental_details" (
    "listing_id" UUID NOT NULL,
    "property_type" VARCHAR(40),
    "bedrooms" DECIMAL(4,1),
    "bathrooms" DECIMAL(4,1),
    "sqft" INTEGER,
    "deposit_amount" DECIMAL(12,2),
    "available_on" DATE,
    "lease_term" VARCHAR(80),
    "furnished" BOOLEAN,
    "pets_allowed" BOOLEAN,
    "parking" VARCHAR(80),

    CONSTRAINT "rental_details_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "transfer_details" (
    "listing_id" UUID NOT NULL,
    "business_type" VARCHAR(80),
    "asking_price" DECIMAL(14,2),
    "monthly_rent" DECIMAL(12,2),
    "lease_remaining_months" INTEGER,
    "reason_for_transfer" VARCHAR(300),
    "includes_inventory" BOOLEAN,

    CONSTRAINT "transfer_details_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "secondhand_details" (
    "listing_id" UUID NOT NULL,
    "condition" VARCHAR(40),
    "brand" VARCHAR(80),
    "model" VARCHAR(100),
    "delivery_options" JSONB,

    CONSTRAINT "secondhand_details_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "service_details" (
    "listing_id" UUID NOT NULL,
    "service_radius_miles" INTEGER,
    "license_number" VARCHAR(100),
    "insured" BOOLEAN,
    "emergency_service" BOOLEAN,
    "availability" JSONB,

    CONSTRAINT "service_details_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "listing_media" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "object_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt_text" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "moderation" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "listing_id" UUID,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6),
    "blocked_at" TIMESTAMPTZ(6),
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "attachments" JSONB,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "region_id" UUID,
    "description" TEXT,
    "address_line_1" VARCHAR(200),
    "address_line_2" VARCHAR(200),
    "postal_code" VARCHAR(20),
    "public_phone" VARCHAR(32),
    "public_email" VARCHAR(320),
    "website_url" VARCHAR(1024),
    "opening_hours" JSONB,
    "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "provider_profiles" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "service_category_id" UUID NOT NULL,
    "primary_region_id" UUID NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "service_radius_miles" INTEGER NOT NULL DEFAULT 25,
    "years_experience" INTEGER,
    "license_number" VARCHAR(100),
    "insured" BOOLEAN,
    "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "profile_data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" VARCHAR(120),
    "body" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "verified_interaction" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "reason_code" VARCHAR(80) NOT NULL,
    "details" VARCHAR(2000),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL,
    "report_id" UUID,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" UUID NOT NULL,
    "queue" VARCHAR(80) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_id" UUID,
    "decision_code" VARCHAR(80),
    "resolution_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "reason_code" VARCHAR(80),
    "note" VARCHAR(2000),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_placements" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "name_zh_hans" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "dimensions" JSONB NOT NULL,
    "allowed_formats" JSONB NOT NULL,
    "max_active" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "budget_amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "status" "CreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" VARCHAR(120),
    "body" VARCHAR(500),
    "media_object_key" VARCHAR(512),
    "destination_url" VARCHAR(2048) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "order_type" VARCHAR(80) NOT NULL,
    "items" JSONB NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_payment_id" VARCHAR(255) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "provider_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" UUID NOT NULL,
    "owner_type" VARCHAR(40) NOT NULL,
    "owner_id" UUID NOT NULL,
    "currency" VARCHAR(16) NOT NULL DEFAULT 'POINT',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reference_type" VARCHAR(80),
    "reference_id" UUID,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "description" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(40) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" UUID,
    "request_id" VARCHAR(128),
    "ip_hash" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

-- CreateIndex
CREATE INDEX "identities_user_id_idx" ON "identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_provider_subject_key" ON "identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_expires_at_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_type_status_idx" ON "organizations"("type", "status");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE INDEX "regions_type_is_active_sort_order_idx" ON "regions"("type", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "regions_parent_id_slug_key" ON "regions"("parent_id", "slug");

-- CreateIndex
CREATE INDEX "categories_vertical_is_active_sort_order_idx" ON "categories"("vertical", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "categories_parent_id_slug_key" ON "categories"("parent_id", "slug");

-- CreateIndex
CREATE INDEX "category_fields_category_id_sort_order_idx" ON "category_fields"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "category_fields_category_id_key_key" ON "category_fields"("category_id", "key");

-- CreateIndex
CREATE INDEX "listings_type_status_published_at_idx" ON "listings"("type", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "listings_category_id_status_published_at_idx" ON "listings"("category_id", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "listings_region_id_status_published_at_idx" ON "listings"("region_id", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "listings_owner_id_status_created_at_idx" ON "listings"("owner_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "listings_organization_id_status_created_at_idx" ON "listings"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "listings_type_slug_key" ON "listings"("type", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "listing_media_object_key_key" ON "listing_media"("object_key");

-- CreateIndex
CREATE INDEX "listing_media_listing_id_sort_order_idx" ON "listing_media"("listing_id", "sort_order");

-- CreateIndex
CREATE INDEX "favorites_listing_id_idx" ON "favorites"("listing_id");

-- CreateIndex
CREATE INDEX "conversations_listing_id_updated_at_idx" ON "conversations"("listing_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_joined_at_idx" ON "conversation_participants"("user_id", "joined_at" DESC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "business_profiles_category_id_region_id_idx" ON "business_profiles"("category_id", "region_id");

-- CreateIndex
CREATE INDEX "provider_profiles_service_category_id_primary_region_id_ver_idx" ON "provider_profiles"("service_category_id", "primary_region_id", "verification_status");

-- CreateIndex
CREATE INDEX "reviews_target_type_target_id_status_created_at_idx" ON "reviews"("target_type", "target_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_author_id_target_type_target_id_key" ON "reviews"("author_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_status_idx" ON "reports"("target_type", "target_id", "status");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "moderation_cases_report_id_key" ON "moderation_cases"("report_id");

-- CreateIndex
CREATE INDEX "moderation_cases_queue_status_priority_created_at_idx" ON "moderation_cases"("queue", "status", "priority" DESC, "created_at");

-- CreateIndex
CREATE INDEX "moderation_cases_target_type_target_id_idx" ON "moderation_cases"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "moderation_actions_case_id_created_at_idx" ON "moderation_actions"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_created_at_idx" ON "notifications"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_at_idx" ON "notifications"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "ad_placements_key_key" ON "ad_placements"("key");

-- CreateIndex
CREATE INDEX "ad_campaigns_placement_id_status_starts_at_ends_at_idx" ON "ad_campaigns"("placement_id", "status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_organization_id_status_idx" ON "ad_campaigns"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ad_creatives_campaign_id_status_idx" ON "ad_creatives"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_organization_id_created_at_idx" ON "orders"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_order_id_status_idx" ON "payments"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_owner_type_owner_id_currency_key" ON "wallet_accounts"("owner_type", "owner_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_idempotency_key_key" ON "wallet_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_entries_account_id_created_at_idx" ON "wallet_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_home_region_id_fkey" FOREIGN KEY ("home_region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_fields" ADD CONSTRAINT "category_fields_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_details" ADD CONSTRAINT "job_details_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_details" ADD CONSTRAINT "rental_details_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_details" ADD CONSTRAINT "transfer_details_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secondhand_details" ADD CONSTRAINT "secondhand_details_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_details" ADD CONSTRAINT "service_details_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_primary_region_id_fkey" FOREIGN KEY ("primary_region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "ad_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom PostgreSQL/PostGIS constraints from prisma/sql/post_schema_constraints.sql.
-- Keep these statements after their owning tables and enum types have been created.
ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "geo_point" geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN "longitude" IS NULL OR "latitude" IS NULL THEN NULL
      ELSE ST_SetSRID(
        ST_MakePoint("longitude"::double precision, "latitude"::double precision),
        4326
      )::geography
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS "listings_geo_point_gist"
  ON "listings" USING GIST ("geo_point");

CREATE INDEX IF NOT EXISTS "listings_title_trgm"
  ON "listings" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "listings_published_partial"
  ON "listings" ("type", "region_id", "published_at" DESC)
  WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subject_check"
  CHECK ("user_id" IS NOT NULL OR "organization_id" IS NOT NULL);
