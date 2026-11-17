-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "review_reason" TEXT;

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "outcome" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_dedup_key_key" ON "webhook_events"("provider", "dedup_key");


-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_status_valid"
  CHECK ("status" IN ('received', 'processed', 'ignored', 'needs_review', 'failed'));
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_provider_valid"
  CHECK ("provider" IN ('simulator', 'paystack'));
