-- Session 17a: OTAs connected to a business, selling its tours through the OCTO API.
-- channels: one per OTA per business; it signs in with its own API key (only the key's SHA-256
-- is kept). channel_products: which of the business's tours each OTA may sell.

CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'octo',
    "api_key_hash" TEXT NOT NULL,
    "api_key_hint" TEXT NOT NULL,
    "commission_basis_points" INTEGER NOT NULL DEFAULT 2000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channels_pkey" PRIMARY KEY ("id"),
    -- Only OCTO for now; a commission is a share of the sale, 0% to 100%.
    CONSTRAINT "channels_kind_valid" CHECK ("kind" IN ('octo')),
    CONSTRAINT "channels_commission_valid" CHECK ("commission_basis_points" BETWEEN 0 AND 10000),
    CONSTRAINT "channels_name_not_blank" CHECK (btrim("name") <> '')
);

CREATE TABLE "channel_products" (
    "channel_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_products_pkey" PRIMARY KEY ("channel_id","product_id")
);

CREATE UNIQUE INDEX "channels_api_key_hash_key" ON "channels"("api_key_hash");
CREATE UNIQUE INDEX "channels_operator_id_name_key" ON "channels"("operator_id", "name");
CREATE UNIQUE INDEX "channels_id_operator_id_key" ON "channels"("id", "operator_id");
CREATE INDEX "channel_products_product_id_idx" ON "channel_products"("product_id");

ALTER TABLE "channels" ADD CONSTRAINT "channels_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite keys: a channel and a tour of the SAME business, or the database refuses.
ALTER TABLE "channel_products" ADD CONSTRAINT "channel_products_channel_id_operator_id_fkey" FOREIGN KEY ("channel_id", "operator_id") REFERENCES "channels"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_products" ADD CONSTRAINT "channel_products_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;
