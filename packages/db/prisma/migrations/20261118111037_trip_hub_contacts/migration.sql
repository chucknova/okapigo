-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "arrive_minutes_early" INTEGER;

-- Guards the database keeps even if a bug slips past the API's checks.
ALTER TABLE "operators"
  ADD CONSTRAINT "operators_phone_e164" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "operators_whatsapp_e164" CHECK ("whatsapp" IS NULL OR "whatsapp" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "products"
  ADD CONSTRAINT "products_arrive_minutes_early_range"
  CHECK ("arrive_minutes_early" IS NULL OR "arrive_minutes_early" BETWEEN 0 AND 120);
