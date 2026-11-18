-- Session 13 (decided 2026-11-18): a WhatsApp booking asks only the LEAD's name; the other
-- travellers are named by staff at check-in. Their name is stored empty until then: the
-- honest record ("not given yet"), rather than a made-up "Guest 2" that looks like a name.
-- The rule changes from "must have a name" to "no stray spaces" (so "   " is still refused).
-- The website's form still requires every name (PublicCreateBookingSchema).
ALTER TABLE "travellers" DROP CONSTRAINT "travellers_name_present";
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_name_trimmed" CHECK ("name" = btrim("name"));
