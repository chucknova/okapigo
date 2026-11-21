-- Session 17b: bookings OTAs make through OCTO, and the money they owe.
--
-- 1. channel_bookings: the OCTO side of one of our bookings (the OTA's uuid, its reference,
--    the unit items, the commission frozen at the sale).
CREATE TABLE "channel_bookings" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "uuid" TEXT NOT NULL,
    "reseller_reference" TEXT,
    "unit_items" JSONB NOT NULL,
    "commission_basis_points" INTEGER NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_bookings_commission_valid" CHECK ("commission_basis_points" BETWEEN 0 AND 10000),
    CONSTRAINT "channel_bookings_uuid_not_blank" CHECK (btrim("uuid") <> '')
);
CREATE UNIQUE INDEX "channel_bookings_booking_id_key" ON "channel_bookings"("booking_id");
CREATE INDEX "channel_bookings_operator_id_channel_id_idx" ON "channel_bookings"("operator_id", "channel_id");
CREATE UNIQUE INDEX "channel_bookings_channel_id_uuid_key" ON "channel_bookings"("channel_id", "uuid");
-- The channel and the booking belong to the same business (the channel's composite key).
ALTER TABLE "channel_bookings" ADD CONSTRAINT "channel_bookings_channel_id_operator_id_fkey" FOREIGN KEY ("channel_id", "operator_id") REFERENCES "channels"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_bookings" ADD CONSTRAINT "channel_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. The OTA's payment: provider and method "ota" (the OTA took the guest's money).
ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_valid";
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_valid"
  CHECK ("provider" IN ('simulator', 'paystack', 'cash', 'ota'));
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_valid";
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_valid"
  CHECK ("method" IN ('card', 'bank_transfer', 'any', 'cash', 'ota'));

-- 3. Two ledger accounts (packages/shared/src/ledger.js ACCOUNTS must match):
--      1300 Owed by OTAs     what OTAs collected for us and owe (the sale less commission)
--      5200 OTA commission   what they keep
--    New operators get them in code; existing ones here.
INSERT INTO "ledger_accounts" ("id", "operator_id", "code", "key", "name", "type", "normal")
SELECT gen_random_uuid(), o."id", a.code, a.key, a.name, a.type, a.normal
  FROM "operators" o
 CROSS JOIN (VALUES
   ('1300', 'OTA_RECEIVABLE', 'Owed by OTAs', 'asset', 'debit'),
   ('5200', 'OTA_COMMISSION', 'OTA commission', 'expense', 'debit')
 ) AS a(code, key, name, type, normal)
ON CONFLICT DO NOTHING;

-- 4. An OTA's sale is a ledger transaction of its own kind:
--    Dr Owed by OTAs (net) + Dr OTA commission / Cr Tour sales.
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_type_valid";
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_valid"
  CHECK ("type" IN ('payment_received', 'payment_fee', 'refund_owed', 'refund_paid',
                    'unallocated_receipt', 'receipt_allocated', 'adjustment', 'reversal',
                    'cash_received', 'ota_sale'));
