-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "payment_id" UUID;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "reference" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "authorization_url" TEXT,
    "fee_kobo" INTEGER,
    "paid_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_operator_id_created_at_idx" ON "payments"("operator_id", "created_at");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_valid"
  CHECK ("status" IN ('initiated', 'succeeded', 'failed', 'abandoned'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_valid"
  CHECK ("provider" IN ('simulator', 'paystack'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_valid"
  CHECK ("purpose" IN ('full', 'deposit', 'balance', 'custom'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_valid"
  CHECK ("amount_kobo" > 0 AND ("fee_kobo" IS NULL OR "fee_kobo" >= 0));
ALTER TABLE "payments" ADD CONSTRAINT "payments_reference_format"
  CHECK ("reference" ~ '^OKG-[0-9A-HJKMNP-TV-Z]{20}$');
-- A succeeded payment must say when it was paid.
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_at_when_succeeded"
  CHECK ("status" <> 'succeeded' OR "paid_at" IS NOT NULL);
