-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normal" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "reverses_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "booking_id" UUID,
    "debit_kobo" INTEGER NOT NULL DEFAULT 0,
    "credit_kobo" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_operator_id_code_key" ON "ledger_accounts"("operator_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_operator_id_key_key" ON "ledger_accounts"("operator_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reverses_id_key" ON "ledger_transactions"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_operator_id_occurred_at_idx" ON "ledger_transactions"("operator_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_operator_id_idempotency_key_key" ON "ledger_transactions"("operator_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: the ledger's guarantees
-- ===========================================================================

-- Each entry is EITHER a debit OR a credit, in whole kobo above zero.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_one_sided"
  CHECK (("debit_kobo" > 0 AND "credit_kobo" = 0) OR ("credit_kobo" > 0 AND "debit_kobo" = 0));

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_type_valid"
  CHECK ("type" IN ('asset', 'liability', 'equity', 'revenue', 'expense') AND "normal" IN ('debit', 'credit'));

ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_valid"
  CHECK ("type" IN ('payment_received', 'payment_fee', 'refund_owed', 'refund_paid',
                    'unallocated_receipt', 'receipt_allocated', 'adjustment', 'reversal'));

-- ---------------------------------------------------------------------------
-- 1. BALANCED OR NOTHING: a DEFERRED constraint trigger.
-- ---------------------------------------------------------------------------
-- A normal trigger would check after EACH entry is inserted, and the first entry of every
-- transaction is unbalanced on its own. "DEFERRABLE INITIALLY DEFERRED" postpones the check
-- to COMMIT, when all the entries are in. If any transaction is then unbalanced, or has
-- fewer than two entries, the whole commit fails and nothing is saved.
CREATE FUNCTION ledger_check_transaction_balanced() RETURNS trigger AS $$
DECLARE
  tx_id uuid := COALESCE(NEW.transaction_id, NEW.id);
  debits bigint;
  credits bigint;
  lines integer;
BEGIN
  SELECT COALESCE(SUM(debit_kobo), 0), COALESCE(SUM(credit_kobo), 0), COUNT(*)
    INTO debits, credits, lines
    FROM ledger_entries WHERE transaction_id = tx_id;
  IF lines < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has % entries; at least 2 are required', tx_id, lines;
  END IF;
  IF debits <> credits THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: debits % <> credits %', tx_id, debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Checked for every inserted entry…
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction_balanced();

-- …and for every transaction, so one with NO entries at all is caught too.
CREATE FUNCTION ledger_check_transaction_has_entries() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM ledger_entries WHERE transaction_id = NEW.id) < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has fewer than 2 entries', NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_transactions_have_entries
  AFTER INSERT ON "ledger_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction_has_entries();

-- ---------------------------------------------------------------------------
-- 2. APPEND-ONLY: no edits, no deletes.
-- ---------------------------------------------------------------------------
-- The only DELETE allowed is the cascade when a whole operator is deleted (a demo sandbox
-- being cleaned up). We recognise it because the operator row is already gone by the time
-- the cascade reaches these tables.
CREATE FUNCTION ledger_forbid_changes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'the ledger is append-only: % rows cannot be updated; post a reversal instead', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM operators WHERE id = OLD.operator_id) THEN
    RAISE EXCEPTION 'the ledger is append-only: % rows cannot be deleted; post a reversal instead', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_changes();

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_changes();

-- ---------------------------------------------------------------------------
-- 3. DATA MIGRATION: give every EXISTING operator its accounts.
-- ---------------------------------------------------------------------------
-- New operators get them in code (createOperatorWithPresetRoles). Operators that already
-- exist (your seeded Ìrìn Lagos Tours) get them here. Must match ACCOUNTS in
-- packages/shared/src/ledger.js; a test checks they agree.
INSERT INTO "ledger_accounts" ("id", "operator_id", "code", "key", "name", "type", "normal")
SELECT gen_random_uuid(), o."id", a.code, a.key, a.name, a.type, a.normal
  FROM "operators" o
 CROSS JOIN (VALUES
   ('1100', 'PROVIDER_CLEARING',    'Paystack clearing',    'asset',     'debit'),
   ('2100', 'REFUNDS_PAYABLE',      'Refunds payable',      'liability', 'credit'),
   ('2200', 'UNALLOCATED_RECEIPTS', 'Unallocated receipts', 'liability', 'credit'),
   ('4000', 'TOUR_SALES',           'Tour sales',           'revenue',   'credit'),
   ('4100', 'SALES_REFUNDS',        'Sales refunds',        'revenue',   'debit'),
   ('5100', 'PAYMENT_FEES',         'Payment fees',         'expense',   'debit'),
   ('5900', 'ADJUSTMENTS',          'Adjustments',          'expense',   'debit')
 ) AS a(code, key, name, type, normal);
