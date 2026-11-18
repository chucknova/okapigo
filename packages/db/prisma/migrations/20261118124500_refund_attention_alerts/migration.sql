-- Stage 12f-2: staff alerts for refunds the provider can't finish without the guest's help
-- (Paystack "needs-attention", e.g. bank details for a payment made by transfer).
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
  CHECK ("kind" IN ('balance_reminder', 'balance_overdue', 'refund_needs_attention'));
