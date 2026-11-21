-- Stage 17c-3: a travel website's guest gets the trip page link from the business (decided
-- 2026-11-21: the website sends its own confirmation; the business runs the trip).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined',
                    'booking_confirmed', 'deposit_received', 'payment_link',
                    'booking_cancelled', 'refund_sent', 'cash_not_received',
                    'staff_message', 'booking_moved', 'trip_link'));

-- A business may write its own, like the other seven.
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_kind_check";
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_check"
  CHECK ("kind" IN ('booking_confirmed', 'deposit_received', 'balance_reminder',
                    'payment_link', 'booking_cancelled', 'refund_sent', 'booking_moved',
                    'trip_link'));
