-- Stage 16c-2: money the office handles itself.
--
-- 1. Cash a guide took on tour day, once the office confirms it was handed in, is a real
--    payment: provider "cash", method "cash" (never sent to Paystack, never refunded through
--    it).
ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_valid";
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_valid"
  CHECK ("provider" IN ('simulator', 'paystack', 'cash'));
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_valid";
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_valid"
  CHECK ("method" IN ('card', 'bank_transfer', 'any', 'cash'));

-- 2. Two more ledger accounts (packages/shared/src/ledger.js ACCOUNTS must match):
--      1000 Cash   the cash guides handed in
--      1200 Bank   the business's own bank account (refunds sent by bank transfer)
--    New operators get them in code; existing ones here.
INSERT INTO "ledger_accounts" ("id", "operator_id", "code", "key", "name", "type", "normal")
SELECT gen_random_uuid(), o."id", a.code, a.key, a.name, a.type, a.normal
  FROM "operators" o
 CROSS JOIN (VALUES
   ('1000', 'CASH', 'Cash', 'asset', 'debit'),
   ('1200', 'BANK', 'Bank', 'asset', 'debit')
 ) AS a(code, key, name, type, normal)
ON CONFLICT DO NOTHING;
