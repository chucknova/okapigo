-- Stage 15b (OPS-09): the changes staff phones send from their offline outbox, each kept
-- once (the phone's id for it is unique per person), with what happened to it.

CREATE TABLE "sync_changes" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "departure_id" UUID,
    "payload" JSONB NOT NULL,
    "happened_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "data" JSONB,
    "dismissed_at" TIMESTAMPTZ(3),
    "dismissed_by_id" UUID,
    CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sync_changes_user_id_client_id_key" ON "sync_changes"("user_id", "client_id");
CREATE INDEX "sync_changes_operator_id_outcome_dismissed_at_idx"
  ON "sync_changes"("operator_id", "outcome", "dismissed_at");
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_valid"
  CHECK ("kind" IN ('check_in', 'no_show', 'name')
         AND "outcome" IN ('applied', 'conflict', 'rejected')
         AND "happened_at" <= "received_at");
