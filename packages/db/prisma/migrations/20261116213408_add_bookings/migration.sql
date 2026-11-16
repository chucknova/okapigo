-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "departure_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "quote" JSONB NOT NULL,
    "total_kobo" INTEGER NOT NULL,
    "amount_paid_kobo" INTEGER NOT NULL DEFAULT 0,
    "lead_name" TEXT NOT NULL,
    "lead_email" TEXT,
    "lead_phone" TEXT,
    "terms_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travellers" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "category_key" TEXT NOT NULL,
    "dietary_needs" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "check_in_status" TEXT NOT NULL DEFAULT 'pending',
    "checked_in_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_add_ons" (
    "booking_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_kobo" INTEGER NOT NULL,

    CONSTRAINT "booking_add_ons_pkey" PRIMARY KEY ("booking_id","add_on_id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_hold_id_key" ON "bookings"("hold_id");

-- CreateIndex
CREATE INDEX "bookings_operator_id_status_idx" ON "bookings"("operator_id", "status");

-- CreateIndex
CREATE INDEX "bookings_departure_id_idx" ON "bookings"("departure_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_operator_id_reference_key" ON "bookings"("operator_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "travellers_booking_id_position_key" ON "travellers"("booking_id", "position");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "departures_id_operator_id_key" ON "departures"("id", "operator_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_id_operator_id_fkey" FOREIGN KEY ("departure_id", "operator_id") REFERENCES "departures"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_add_ons" ADD CONSTRAINT "booking_add_ons_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_add_ons" ADD CONSTRAINT "booking_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_status_valid" CHECK ("status" IN
  ('held', 'confirmed', 'part_paid', 'paid', 'amended', 'cancelled', 'no_show', 'completed', 'refunded'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_valid"
  CHECK ("channel" IN ('staff', 'web', 'whatsapp', 'ota'));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_money_non_negative"
  CHECK ("total_kobo" >= 0 AND "amount_paid_kobo" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reference_format"
  CHECK ("reference" ~ '^[A-Z]{1,3}-[0-9A-HJKMNP-TV-Z]{6}$');
-- The lead booker must be reachable, in canonical form (same rules as staff, session 3).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_contact_required"
  CHECK ("lead_email" IS NOT NULL OR "lead_phone" IS NOT NULL);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_email_lowercase"
  CHECK ("lead_email" = lower("lead_email"));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_phone_e164"
  CHECK ("lead_phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "travellers" ADD CONSTRAINT "travellers_age_valid" CHECK ("age" BETWEEN 0 AND 120);
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_name_present" CHECK (length(trim("name")) > 0);
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_check_in_status_valid"
  CHECK ("check_in_status" IN ('pending', 'present', 'late', 'no_show'));

ALTER TABLE "booking_add_ons" ADD CONSTRAINT "booking_add_ons_positive"
  CHECK ("quantity" > 0 AND "unit_kobo" >= 0);

ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_valid"
  CHECK ("actor_type" IN ('user', 'guest', 'system'));
