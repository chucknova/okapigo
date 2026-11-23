-- Stage 19a-2: a DEMO business (the public demo, reset every night). Its messages never leave:
-- WhatsApp goes to the simulator, email is kept but not sent, so a made-up guest number can
-- never reach a real person (decided 2026-11-23). Your own businesses are never demo ones.
ALTER TABLE "operators" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
