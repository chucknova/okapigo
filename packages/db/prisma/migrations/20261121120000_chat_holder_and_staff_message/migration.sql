-- Stage 16d-1: the inbox's chats.
--
-- 1. WHO has a chat taken over, and since when ("Kunle is replying · bot paused"; "Only Ngozi
--    can reply while she has this chat, since 10:52"). Cleared when it's handed back.
ALTER TABLE "conversations" ADD COLUMN "handled_by_id" UUID;
ALTER TABLE "conversations" ADD COLUMN "handled_since" TIMESTAMPTZ(3);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_handled_by_id_fkey"
  FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. A staff member's message by email ("Send by email" when WhatsApp couldn't deliver it).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined',
                    'booking_confirmed', 'deposit_received', 'payment_link',
                    'booking_cancelled', 'refund_sent', 'cash_not_received',
                    'staff_message'));
