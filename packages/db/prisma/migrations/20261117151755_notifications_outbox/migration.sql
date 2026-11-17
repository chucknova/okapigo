-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_operator_id_audience_status_idx" ON "notifications"("operator_id", "audience", "status");

-- CreateIndex
CREATE INDEX "notifications_status_audience_idx" ON "notifications"("status", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_booking_id_key_key" ON "notifications"("booking_id", "key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Only known values (added by hand: Prisma can't express CHECKs).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_audience_check"
  CHECK ("audience" IN ('guest', 'staff'));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue'));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check"
  CHECK ("status" IN ('pending', 'sent', 'cancelled', 'dismissed'));
-- A sent notification records when; nothing else may claim it was sent.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sent_at_check"
  CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL));
