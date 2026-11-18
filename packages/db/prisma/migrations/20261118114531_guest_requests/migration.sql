-- CreateTable
CREATE TABLE "guest_requests" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "staff_note" TEXT,
    "answered_at" TIMESTAMPTZ(3),
    "answered_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guest_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_requests_operator_id_status_created_at_idx" ON "guest_requests"("operator_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "guest_requests_booking_id_idx" ON "guest_requests"("booking_id");

-- AddForeignKey
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database keeps even if a bug slips past the API's checks.
ALTER TABLE "guest_requests"
  ADD CONSTRAINT "guest_requests_kind_valid" CHECK ("kind" IN ('change_date', 'cancel', 'other')),
  ADD CONSTRAINT "guest_requests_status_valid" CHECK ("status" IN ('open', 'answered')),
  ADD CONSTRAINT "guest_requests_message_length" CHECK (char_length("message") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "guest_requests_answered_when" CHECK (("status" = 'answered') = ("answered_at" IS NOT NULL));
