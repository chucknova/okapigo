-- Stage 13c: a short name for WhatsApp's 24-character list rows ("Heritage Walk").
ALTER TABLE "products" ADD COLUMN "short_title" TEXT;
-- Added by hand (Prisma can't express CHECKs): trimmed, 1 to 24 characters, or none.
ALTER TABLE "products" ADD CONSTRAINT "products_short_title_valid"
  CHECK ("short_title" IS NULL OR ("short_title" = btrim("short_title") AND char_length("short_title") BETWEEN 1 AND 24));
