-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "duration_minutes" INTEGER NOT NULL,
    "default_capacity" INTEGER NOT NULL,
    "meeting_point" JSONB NOT NULL,
    "stops" JSONB NOT NULL DEFAULT '[]',
    "photos" JSONB NOT NULL DEFAULT '[]',
    "pickup_points" JSONB NOT NULL DEFAULT '[]',
    "faqs" JSONB NOT NULL DEFAULT '[]',
    "inclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "what_to_bring" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_categories" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_age" INTEGER NOT NULL,
    "max_age" INTEGER,
    "amount_kobo" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_ons" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_kobo" INTEGER NOT NULL,
    "stock_per_departure" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_operator_id_slug_key" ON "products"("operator_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_operator_id_key" ON "products"("id", "operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_categories_product_id_key_key" ON "price_categories"("product_id", "key");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_categories" ADD CONSTRAINT "price_categories_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints: the database refuses impossible catalogue data.
-- ---------------------------------------------------------------------------
ALTER TABLE "products" ADD CONSTRAINT "products_status_valid"
  CHECK ("status" IN ('draft', 'published', 'archived'));
ALTER TABLE "products" ADD CONSTRAINT "products_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "products" ADD CONSTRAINT "products_duration_positive"
  CHECK ("duration_minutes" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_capacity_positive"
  CHECK ("default_capacity" > 0);

-- Money is never negative. (A free infant ticket is 0, which is allowed.)
ALTER TABLE "price_categories" ADD CONSTRAINT "price_categories_amount_non_negative"
  CHECK ("amount_kobo" >= 0);
-- Ages make sense: 0 or more, and the upper bound (if any) isn't below the lower one.
ALTER TABLE "price_categories" ADD CONSTRAINT "price_categories_age_range_valid"
  CHECK ("min_age" >= 0 AND ("max_age" IS NULL OR "max_age" >= "min_age"));

ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_price_non_negative"
  CHECK ("price_kobo" >= 0);
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_stock_non_negative"
  CHECK ("stock_per_departure" IS NULL OR "stock_per_departure" >= 0);
