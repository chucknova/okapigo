-- At most ONE unmatched receipt per provider transaction (stage 10d).
--
-- A PARTIAL unique index: it only covers rows matching the WHERE clause. The original
-- payment of a wrong-amount transfer shares its provider transaction id with the receipt
-- created for it, but has a booking, so it's outside this index and doesn't clash.
-- If the webhook job and the sweeper ever process the same event at once, the second
-- receipt insert fails here instead of recording the money twice.
CREATE UNIQUE INDEX "payments_one_receipt_per_provider_transaction"
  ON "payments" ("provider", "provider_transaction_id")
  WHERE "booking_id" IS NULL AND "provider_transaction_id" IS NOT NULL;
