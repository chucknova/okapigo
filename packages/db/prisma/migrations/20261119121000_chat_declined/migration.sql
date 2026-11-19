-- Stage 13c: "Your payment didn't go through" in the WhatsApp chat, once per failed payment
-- (key "chat_declined:<payment id>").
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined'));
