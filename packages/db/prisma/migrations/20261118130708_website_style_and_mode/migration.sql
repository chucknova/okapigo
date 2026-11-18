-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "website_mode" TEXT NOT NULL DEFAULT 'auto',
ALTER COLUMN "website_style" SET DEFAULT 'lagoon';

-- Until stage 12g nobody chose a style: everyone had the old default, "classic". Lagoon is
-- the designs' default, so those operators move to it (classic stays available to choose).
UPDATE "operators" SET "website_style" = 'lagoon' WHERE "website_style" = 'classic';

ALTER TABLE "operators"
  ADD CONSTRAINT "operators_website_style_valid" CHECK ("website_style" IN ('lagoon', 'classic', 'earth')),
  ADD CONSTRAINT "operators_website_mode_valid" CHECK ("website_mode" IN ('auto', 'light', 'dark'));
