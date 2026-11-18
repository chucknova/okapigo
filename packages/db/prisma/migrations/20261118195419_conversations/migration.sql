-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "guest_phone" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL DEFAULT '',
    "handled_by" TEXT NOT NULL DEFAULT 'bot',
    "state" JSONB NOT NULL DEFAULT '{}',
    "booking_id" UUID,
    "needs_person_since" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_user_id" UUID,
    "body" JSONB NOT NULL,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_operator_id_last_message_at_idx" ON "conversations"("operator_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_operator_id_channel_guest_phone_key" ON "conversations"("operator_id", "channel", "guest_phone");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guards the database keeps even if a bug slips past the API's checks.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_valid" CHECK ("channel" IN ('simulator', 'whatsapp')),
  ADD CONSTRAINT "conversations_handled_by_valid" CHECK ("handled_by" IN ('bot', 'staff')),
  ADD CONSTRAINT "conversations_phone_e164" CHECK ("guest_phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_direction_valid" CHECK ("direction" IN ('in', 'out')),
  ADD CONSTRAINT "chat_messages_author_valid" CHECK ("author" IN ('guest', 'bot', 'staff')),
  -- A guest's message comes in; the bot's and staff's go out.
  ADD CONSTRAINT "chat_messages_author_direction" CHECK (("author" = 'guest') = ("direction" = 'in'));
