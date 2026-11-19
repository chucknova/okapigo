-- Stage 13b: the order chat messages were written in. created_at can't tell: Postgres' now()
-- is the TRANSACTION's start, and a guest's message and the bot's replies share one.
-- Existing rows (demo chats only) get numbers in storage order; every new message counts up.
ALTER TABLE "chat_messages" ADD COLUMN "seq" BIGSERIAL NOT NULL;

DROP INDEX "chat_messages_conversation_id_created_at_idx";
CREATE INDEX "chat_messages_conversation_id_seq_idx" ON "chat_messages"("conversation_id", "seq");
