-- Session 17b: an OTA reserves seats before it says who's coming (OCTO "reserve", then
-- "confirm" with the contact). So the lead's email or phone may be missing ONLY on an OTA
-- booking that's still held, or was cancelled (or ran out) before being confirmed. Every
-- booking that's sold still has one: confirming through OCTO requires the email.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_lead_contact_required";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_contact_required"
  CHECK ("lead_email" IS NOT NULL OR "lead_phone" IS NOT NULL
         OR ("channel" = 'ota' AND "status" IN ('held', 'cancelled')));
