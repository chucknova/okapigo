-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "days_of_week" INTEGER[],
    "times" TEXT[],
    "capacity" INTEGER,
    "skip_dates" DATE[] DEFAULT ARRAY[]::DATE[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departures" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "schedule_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "seats_sold" INTEGER NOT NULL DEFAULT 0,
    "seats_held" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departures_operator_id_starts_at_idx" ON "departures"("operator_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "departures_product_id_starts_at_key" ON "departures"("product_id", "starts_at");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departures" ADD CONSTRAINT "departures_product_id_operator_id_fkey" FOREIGN KEY ("product_id", "operator_id") REFERENCES "products"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departures" ADD CONSTRAINT "departures_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints
-- ---------------------------------------------------------------------------

-- THE overselling guard. Whatever code runs, the database never allows more people
-- (sold + held) on a departure than it has seats, and never a negative count.
ALTER TABLE "departures" ADD CONSTRAINT "departures_seats_within_capacity"
  CHECK ("seats_sold" >= 0 AND "seats_held" >= 0 AND "seats_sold" + "seats_held" <= "capacity");
ALTER TABLE "departures" ADD CONSTRAINT "departures_capacity_positive"
  CHECK ("capacity" > 0);
ALTER TABLE "departures" ADD CONSTRAINT "departures_ends_after_start"
  CHECK ("ends_at" > "starts_at");
ALTER TABLE "departures" ADD CONSTRAINT "departures_status_valid"
  CHECK ("status" IN ('scheduled', 'cancelled'));

-- Schedules: at least one weekday (0–6) and one time, each "HH:MM"; sensible dates.
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_days_valid"
  CHECK (cardinality("days_of_week") > 0 AND "days_of_week" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_times_valid"
  CHECK (cardinality("times") > 0 AND array_to_string("times", ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$');
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_dates_valid"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_capacity_positive"
  CHECK ("capacity" IS NULL OR "capacity" > 0);
