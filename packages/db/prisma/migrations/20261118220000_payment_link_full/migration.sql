-- Stage 13b: a link for the WHOLE price of a booking not yet paid ("full"), sent by the
-- WhatsApp assistant. Until now that was called "balance", so the guest's page said "Pay your
-- balance" before they had paid anything.
ALTER TABLE "payment_links" DROP CONSTRAINT "payment_links_purpose_valid";
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_purpose_valid"
  CHECK ("purpose" IN ('full', 'deposit', 'balance', 'custom'));
