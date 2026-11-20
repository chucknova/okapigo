-- Stage 16c-2: a guide's cash, handed in to the office, is a ledger transaction of its own
-- kind ("cash_received": Dr Cash / Cr Tour sales). A refund sent by bank transfer is still a
-- "refund_paid" (from the Bank instead of Paystack).
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_type_valid";
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_valid"
  CHECK ("type" IN ('payment_received', 'payment_fee', 'refund_owed', 'refund_paid',
                    'unallocated_receipt', 'receipt_allocated', 'adjustment', 'reversal',
                    'cash_received'));
