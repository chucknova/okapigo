-- Stage 15c-1: a conflict's reason in the parts screen O5 shows (title, you did, they had, so now).
ALTER TABLE "sync_changes" ADD COLUMN "explanation" JSONB;
