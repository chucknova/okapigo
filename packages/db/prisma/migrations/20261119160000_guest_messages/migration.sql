-- Stage 14a: guest messages (OPS-11): confirmation, deposit received, balance reminder,
-- payment link, cancellation, refund sent; one row per channel, and editable templates.

ALTER TABLE "notifications" ADD COLUMN "channel" TEXT;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_check"
  CHECK ("channel" IS NULL OR "channel" IN ('whatsapp', 'email'));

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention',
                    'chat_ticket', 'chat_hold_over', 'chat_declined',
                    'booking_confirmed', 'deposit_received', 'payment_link',
                    'booking_cancelled', 'refund_sent'));

-- "failed": the channel refused it (the reason is in data.error), for staff to see.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_status_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check"
  CHECK ("status" IN ('pending', 'sent', 'cancelled', 'dismissed', 'failed'));
-- (sent_at stays "set exactly when sent": a failed message has none.)

CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_templates_operator_id_kind_key" ON "message_templates"("operator_id", "kind");
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_check"
  CHECK ("kind" IN ('booking_confirmed', 'deposit_received', 'balance_reminder',
                    'payment_link', 'booking_cancelled', 'refund_sent'));
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_lengths"
  CHECK (char_length("subject") BETWEEN 1 AND 150 AND char_length("body") BETWEEN 1 AND 1500);
