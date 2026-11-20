-- Stage 16c-2: cash the office marked "not received" (the guide didn't hand it in).
ALTER TABLE "cash_reports" DROP CONSTRAINT "cash_reports_valid";
ALTER TABLE "cash_reports" ADD CONSTRAINT "cash_reports_valid"
  CHECK ("amount_kobo" > 0
     AND "status" IN ('reported', 'confirmed', 'possible_double', 'returned', 'not_received'));
