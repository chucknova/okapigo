-- Stage 13b: messages the WhatsApp assistant sends on its own, not as a reply: the ticket when
-- the money settles, and "your 30 minutes are up". ONE per booking each (the unique
-- bookingId + key index), however often the dispatcher runs.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over'));
