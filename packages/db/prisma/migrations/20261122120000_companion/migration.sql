-- Stage 18a: the AI trip companion (GST-16). Each question a guest asks on their trip page,
-- what it answered (or that it handed the question to the team), and what it cost; and the
-- answers kept for common questions, so the same question on the same tour is answered free.

-- CreateTable
CREATE TABLE "companion_messages" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "outcome" TEXT NOT NULL,
    "source" TEXT,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "guest_request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companion_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companion_answers" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "question_key" TEXT NOT NULL,
    "facts_key" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "source" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companion_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companion_messages_booking_id_created_at_idx" ON "companion_messages"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "companion_messages_created_at_idx" ON "companion_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "companion_answers_product_id_question_key_facts_key_key" ON "companion_answers"("product_id", "question_key", "facts_key");

-- AddForeignKey
ALTER TABLE "companion_messages" ADD CONSTRAINT "companion_messages_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_messages" ADD CONSTRAINT "companion_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_messages" ADD CONSTRAINT "companion_messages_guest_request_id_fkey" FOREIGN KEY ("guest_request_id") REFERENCES "guest_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companion_answers" ADD CONSTRAINT "companion_answers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database keeps even if a bug slips past the API's checks.
ALTER TABLE "companion_messages"
  ADD CONSTRAINT "companion_messages_outcome_valid"
    CHECK ("outcome" IN ('answered', 'handed_over', 'unsure')),
  -- An answer exactly when it answered.
  ADD CONSTRAINT "companion_messages_answer_when" CHECK (("outcome" = 'answered') = ("answer" IS NOT NULL)),
  ADD CONSTRAINT "companion_messages_question_length" CHECK (char_length("question") BETWEEN 1 AND 500),
  ADD CONSTRAINT "companion_messages_counts" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_micro_usd" >= 0);

-- A question the companion wasn't sure about becomes a request for the team (decided
-- 2026-11-22), the fourth kind beside change the date, cancel and something else.
ALTER TABLE "guest_requests" DROP CONSTRAINT "guest_requests_kind_valid";
ALTER TABLE "guest_requests"
  ADD CONSTRAINT "guest_requests_kind_valid" CHECK ("kind" IN ('change_date', 'cancel', 'other', 'question'));
