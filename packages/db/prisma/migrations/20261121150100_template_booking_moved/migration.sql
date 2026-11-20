-- Stage 16d-2: a business may write its own "Date changed" message, like the other six.
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_kind_check";
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_check"
  CHECK ("kind" IN ('booking_confirmed', 'deposit_received', 'balance_reminder',
                    'payment_link', 'booking_cancelled', 'refund_sent', 'booking_moved'));
