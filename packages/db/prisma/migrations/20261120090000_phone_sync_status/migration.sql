-- Stage 16a: when each person's phone last synced, and how many changes it said were waiting
-- (the manager's Today, "Guides’ phones").
ALTER TABLE "users" ADD COLUMN "last_synced_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN "outbox_waiting" INTEGER;
ALTER TABLE "users" ADD CONSTRAINT "users_outbox_waiting_valid" CHECK ("outbox_waiting" IS NULL OR "outbox_waiting" >= 0);
