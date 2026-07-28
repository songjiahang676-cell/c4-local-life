-- CreateTable
CREATE TABLE "region_aliases" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "value" VARCHAR(120) NOT NULL,
    "normalized_value" VARCHAR(120) NOT NULL,

    CONSTRAINT "region_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_aliases" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "value" VARCHAR(120) NOT NULL,
    "normalized_value" VARCHAR(120) NOT NULL,

    CONSTRAINT "category_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "region_aliases_normalized_value_idx" ON "region_aliases"("normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "region_aliases_region_id_locale_normalized_value_key" ON "region_aliases"("region_id", "locale", "normalized_value");

-- CreateIndex
CREATE INDEX "category_aliases_normalized_value_idx" ON "category_aliases"("normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "category_aliases_category_id_locale_normalized_value_key" ON "category_aliases"("category_id", "locale", "normalized_value");

-- AddForeignKey
ALTER TABLE "region_aliases" ADD CONSTRAINT "region_aliases_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_aliases" ADD CONSTRAINT "category_aliases_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
