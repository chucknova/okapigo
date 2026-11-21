-- Session 17c: telling connected OTAs when seats or prices change (DST-02: within 60 seconds).
-- 1. Where to tell each channel, and how the last attempt went.
ALTER TABLE "channels" ADD COLUMN "webhook_url" TEXT,
ADD COLUMN "last_push_at" TIMESTAMPTZ(3),
ADD COLUMN "last_push_error" TEXT;
ALTER TABLE "channels" ADD CONSTRAINT "channels_webhook_url_http"
  CHECK ("webhook_url" IS NULL OR "webhook_url" ~ '^https?://');

-- 2. What we last told each channel about a departure or a tour (a fingerprint per subject),
--    so the sync job tells only what changed since.
CREATE TABLE "channel_sync_states" (
    "channel_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "pushed_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_sync_states_pkey" PRIMARY KEY ("channel_id","subject"),
    CONSTRAINT "channel_sync_states_subject_valid" CHECK ("subject" ~ '^(departure|product):')
);
ALTER TABLE "channel_sync_states" ADD CONSTRAINT "channel_sync_states_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
