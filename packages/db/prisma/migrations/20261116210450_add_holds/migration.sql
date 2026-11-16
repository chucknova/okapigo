-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "hold_minutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "departure_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "channel" TEXT NOT NULL,
    "travellers" JSONB NOT NULL,
    "quote" JSONB NOT NULL,
    "total_kobo" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold_add_ons" (
    "hold_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "hold_add_ons_pkey" PRIMARY KEY ("hold_id","add_on_id")
);

-- CreateIndex
CREATE INDEX "holds_status_expires_at_idx" ON "holds"("status", "expires_at");

-- CreateIndex
CREATE INDEX "holds_departure_id_status_idx" ON "holds"("departure_id", "status");

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "departures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_add_ons" ADD CONSTRAINT "hold_add_ons_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_add_ons" ADD CONSTRAINT "hold_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "holds" ADD CONSTRAINT "holds_seats_positive" CHECK ("seats" > 0);
ALTER TABLE "holds" ADD CONSTRAINT "holds_status_valid"
  CHECK ("status" IN ('active', 'released', 'expired', 'converted'));
ALTER TABLE "holds" ADD CONSTRAINT "holds_channel_valid"
  CHECK ("channel" IN ('staff', 'web', 'whatsapp', 'ota'));
ALTER TABLE "holds" ADD CONSTRAINT "holds_total_non_negative" CHECK ("total_kobo" >= 0);
-- An active hold has no end time; an ended one must have one.
ALTER TABLE "holds" ADD CONSTRAINT "holds_ended_at_matches_status"
  CHECK (("status" = 'active') = ("ended_at" IS NULL));

ALTER TABLE "hold_add_ons" ADD CONSTRAINT "hold_add_ons_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "operators" ADD CONSTRAINT "operators_hold_minutes_range"
  CHECK ("hold_minutes" BETWEEN 1 AND 120);
