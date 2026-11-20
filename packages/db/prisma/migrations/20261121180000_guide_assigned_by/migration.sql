-- Stage 16d-3: who assigned a departure's guide, and when ("Guide assigned to Tarkwa Bay by
-- Kunle, Thu 3 Dec 15:02" under the inbox's "Done this week").
ALTER TABLE "departures" ADD COLUMN "guide_assigned_by_id" UUID;
ALTER TABLE "departures" ADD COLUMN "guide_assigned_at" TIMESTAMPTZ(3);
