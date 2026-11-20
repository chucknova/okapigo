-- Stage 16d-2: guest requests and moving a booking's date.
--
-- 1. The office's reply to a request ("Done! You're now booked for Sun 6 Dec…"): sent to the
--    guest by WhatsApp and email, and shown on their trip page instead of "Your request was
--    sent".
ALTER TABLE "guest_requests" ADD COLUMN "reply" TEXT;
ALTER TABLE "guest_requests" ADD COLUMN "replied_at" TIMESTAMPTZ(3);
ALTER TABLE "guest_requests" ADD COLUMN "replied_by_id" UUID;

-- 2. A guest message when the office moves a booking to another date.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined',
                    'booking_confirmed', 'deposit_received', 'payment_link',
                    'booking_cancelled', 'refund_sent', 'cash_not_received',
                    'staff_message', 'booking_moved'));
