-- Stage 13c-3: the real WhatsApp Cloud API.

-- Which business a message is for: Meta's "phone number ID" of the business's number.
ALTER TABLE "operators" ADD COLUMN "whatsapp_phone_number_id" TEXT;
CREATE UNIQUE INDEX "operators_whatsapp_phone_number_id_key" ON "operators"("whatsapp_phone_number_id");
ALTER TABLE "operators" ADD CONSTRAINT "operators_whatsapp_phone_number_id_digits"
  CHECK ("whatsapp_phone_number_id" IS NULL OR "whatsapp_phone_number_id" ~ '^[0-9]{5,30}$');

-- Did a message reach the guest (Meta's delivery receipts), and if not, why.
ALTER TABLE "chat_messages" ADD COLUMN "delivery" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "delivery_error" TEXT;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_delivery_valid"
  CHECK ("delivery" IS NULL OR "delivery" IN ('sent', 'delivered', 'read', 'failed'));
CREATE INDEX "chat_messages_provider_message_id_idx" ON "chat_messages"("provider_message_id");

-- Meta may deliver the same guest message more than once: it's handled once. (A partial
-- unique index, by hand: Prisma can't express "unique where direction = 'in'".)
CREATE UNIQUE INDEX "chat_messages_inbound_once"
  ON "chat_messages"("provider_message_id") WHERE "direction" = 'in' AND "provider_message_id" IS NOT NULL;
