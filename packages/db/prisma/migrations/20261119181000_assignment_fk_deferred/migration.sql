-- Stage 15a: the departure → guide and departure → van/boat links are checked at the END of
-- the transaction (DEFERRABLE INITIALLY DEFERRED), not row by row. Deleting a whole business
-- removes its staff and its departures together, and a row-by-row check refused the staff
-- while a departure (about to go too) still pointed at them. Deleting ONE guide who still has
-- departures is still refused: at the end of that transaction, the link is still there.
ALTER TABLE "departures" DROP CONSTRAINT "departures_guide_id_operator_id_fkey";
ALTER TABLE "departures" ADD CONSTRAINT "departures_guide_id_operator_id_fkey"
  FOREIGN KEY ("guide_id", "operator_id") REFERENCES "users"("id", "operator_id")
  ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "departures" DROP CONSTRAINT "departures_resource_id_operator_id_fkey";
ALTER TABLE "departures" ADD CONSTRAINT "departures_resource_id_operator_id_fkey"
  FOREIGN KEY ("resource_id", "operator_id") REFERENCES "resources"("id", "operator_id")
  ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
