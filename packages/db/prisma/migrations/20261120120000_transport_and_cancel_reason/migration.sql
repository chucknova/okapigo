-- Stage 16b: how each tour travels (only that kind of vehicle can be assigned), and why a
-- departure was called off.
ALTER TABLE "products" ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'on_foot';
ALTER TABLE "products" ADD CONSTRAINT "products_transport_valid"
  CHECK ("transport" IN ('on_foot', 'van', 'boat'));
ALTER TABLE "departures" ADD COLUMN "cancel_reason" TEXT;

-- The demo tours as seeded (any business seeded from the demo, e.g. Ìrìn): the Badagry day
-- trip and the Lekki half-day go by van, Tarkwa Bay by boat; the walk and food crawl on foot.
UPDATE "products" SET "transport" = 'van'
 WHERE "slug" IN ('badagry-heritage-day-trip', 'lekki-nature-and-craft');
UPDATE "products" SET "transport" = 'boat' WHERE "slug" = 'tarkwa-bay-beach-and-lagoon';
