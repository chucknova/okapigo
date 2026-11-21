-- Session 17c-2: Settings › Channels as designed.
--   1. a key's dates ("made Sat 14 Nov · last used 10:42")
--   2. OCTO notifications in place of our own webhook: the OTA subscribes its own address
--      through OCTO (POST /octo/notifications/subscriptions), as the standard says
--   3. payments from an OTA ("Record a payment from Sojourna"), paying off its oldest
--      bookings first
-- 17c's webhook columns and its sync table are dropped (never shown anywhere; nothing to keep).

-- 1. The key's dates.
ALTER TABLE "channels"
  ADD COLUMN "api_key_created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "api_key_last_used_at" TIMESTAMPTZ(3);

-- 2. Notifications.
ALTER TABLE "channels" DROP CONSTRAINT "channels_webhook_url_http";
ALTER TABLE "channels" DROP COLUMN "webhook_url",
  DROP COLUMN "last_push_at",
  DROP COLUMN "last_push_error";
DROP TABLE "channel_sync_states";

-- An OTA's subscription: where to tell it, what about, and headers it wants sent (its own
-- way of knowing it's us, e.g. "Api-Key").
CREATE TABLE "channel_subscriptions" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "notification_types" TEXT[] NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "last_push_at" TIMESTAMPTZ(3),
    "last_push_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_subscriptions_url_http" CHECK ("url" ~ '^https?://'),
    CONSTRAINT "channel_subscriptions_types_valid" CHECK (
      cardinality("notification_types") > 0 AND
      "notification_types" <@ ARRAY['PRODUCT_UPDATE', 'AVAILABILITY_UPDATE', 'BOOKING_UPDATE'])
);
CREATE INDEX "channel_subscriptions_channel_id_idx" ON "channel_subscriptions"("channel_id");
ALTER TABLE "channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_channel_id_operator_id_fkey"
  FOREIGN KEY ("channel_id", "operator_id") REFERENCES "channels"("id", "operator_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- What a subscription was last told about one thing, as a fingerprint.
CREATE TABLE "notification_states" (
    "subscription_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "pushed_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_states_pkey" PRIMARY KEY ("subscription_id","subject"),
    CONSTRAINT "notification_states_subject_valid" CHECK ("subject" ~ '^(departure|product|booking):')
);
ALTER TABLE "notification_states" ADD CONSTRAINT "notification_states_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "channel_subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Payments from an OTA.
CREATE TABLE "channel_payments" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_payments_amount_positive" CHECK ("amount_kobo" > 0),
    CONSTRAINT "channel_payments_reference_length" CHECK (char_length("reference") <= 80)
);
CREATE INDEX "channel_payments_channel_id_received_on_idx" ON "channel_payments"("channel_id", "received_on");
ALTER TABLE "channel_payments" ADD CONSTRAINT "channel_payments_channel_id_operator_id_fkey"
  FOREIGN KEY ("channel_id", "operator_id") REFERENCES "channels"("id", "operator_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_payments" ADD CONSTRAINT "channel_payments_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which bookings a payment paid off, and how much of each.
CREATE TABLE "channel_payment_allocations" (
    "payment_id" UUID NOT NULL,
    "channel_booking_id" UUID NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    CONSTRAINT "channel_payment_allocations_pkey" PRIMARY KEY ("payment_id","channel_booking_id"),
    CONSTRAINT "channel_payment_allocations_amount_positive" CHECK ("amount_kobo" > 0)
);
CREATE INDEX "channel_payment_allocations_channel_booking_id_idx" ON "channel_payment_allocations"("channel_booking_id");
ALTER TABLE "channel_payment_allocations" ADD CONSTRAINT "channel_payment_allocations_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "channel_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_payment_allocations" ADD CONSTRAINT "channel_payment_allocations_channel_booking_id_fkey"
  FOREIGN KEY ("channel_booking_id") REFERENCES "channel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ledger: an OTA paying what it owes is a transaction of its own kind.
--   Dr Bank / Cr Owed by OTAs
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_type_valid";
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_valid"
  CHECK ("type" IN ('payment_received', 'payment_fee', 'refund_owed', 'refund_paid',
                    'unallocated_receipt', 'receipt_allocated', 'adjustment', 'reversal',
                    'cash_received', 'ota_sale', 'ota_payment'));
