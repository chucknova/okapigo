-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refunded_kobo" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID,
    "payment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "failure_reason" TEXT,
    "created_by_id" UUID,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_provider_refund_id_key" ON "refunds"("provider", "provider_refund_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_valid"
  CHECK ("status" IN ('requested', 'pending', 'processed', 'failed'));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_at_when_processed"
  CHECK ("status" <> 'processed' OR "processed_at" IS NOT NULL);
-- A payment can never be refunded more than it brought in, whatever code runs.
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_within_amount"
  CHECK ("refunded_kobo" >= 0 AND "refunded_kobo" <= "amount_kobo");
