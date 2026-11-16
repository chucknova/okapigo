-- DropForeignKey
ALTER TABLE "hold_add_ons" DROP CONSTRAINT "hold_add_ons_add_on_id_fkey";

-- AddForeignKey
ALTER TABLE "hold_add_ons" ADD CONSTRAINT "hold_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
