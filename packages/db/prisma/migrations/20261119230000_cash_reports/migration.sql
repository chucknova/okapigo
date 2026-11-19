-- Stage 15c-4: cash a guide says a guest paid them on tour day. Not a payment until the
-- office confirms it was handed in.

CREATE TABLE "cash_reports" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "reported_by_id" UUID NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cash_reports_booking_id_idx" ON "cash_reports"("booking_id");
CREATE INDEX "cash_reports_reported_by_id_status_idx" ON "cash_reports"("reported_by_id", "status");
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_reported_by_id_fkey"
  FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_valid"
  CHECK ("amount_kobo" > 0 AND "status" IN ('reported', 'confirmed', 'possible_double', 'returned'));

-- The outbox takes a new kind of change: cash.
ALTER TABLE "sync_changes" DROP CONSTRAINT "sync_changes_valid";
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_valid"
  CHECK ("kind" IN ('check_in', 'no_show', 'name', 'cash')
         AND "outcome" IN ('applied', 'conflict', 'rejected')
         AND "happened_at" <= "received_at");
