-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "allocated_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_link_id" UUID,
ADD COLUMN     "suggested_booking_id" UUID,
ALTER COLUMN "booking_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_hash_key" ON "payment_links"("token_hash");

-- CreateIndex
CREATE INDEX "payment_links_booking_id_idx" ON "payment_links"("booking_id");

-- CreateIndex
CREATE INDEX "payments_operator_id_allocated_at_idx" ON "payments"("operator_id", "allocated_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
-- "any" = the guest chooses card or transfer on the provider's page (payment links).
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_valid"
  CHECK ("method" IN ('card', 'bank_transfer', 'any'));

-- An unmatched receipt (no booking) can only be money that actually ARRIVED, and it stays
-- unallocated until it gets a booking: the two facts must agree.
ALTER TABLE "payments" ADD CONSTRAINT "payments_unmatched_is_succeeded"
  CHECK ("booking_id" IS NOT NULL OR "status" = 'succeeded');
ALTER TABLE "payments" ADD CONSTRAINT "payments_allocated_has_booking"
  CHECK ("allocated_at" IS NULL OR "booking_id" IS NOT NULL);

ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_status_valid"
  CHECK ("status" IN ('active', 'paid', 'cancelled', 'expired'));
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_purpose_valid"
  CHECK ("purpose" IN ('deposit', 'balance', 'custom'));
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_amount_positive"
  CHECK ("amount_kobo" > 0);
