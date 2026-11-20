-- Stage 16c-2: a staff alert for cash the office marked "not received" (the owner hears of
-- it on Today, and in the inbox).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined',
                    'booking_confirmed', 'deposit_received', 'payment_link',
                    'booking_cancelled', 'refund_sent', 'cash_not_received'));
