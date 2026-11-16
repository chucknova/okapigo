-- DropForeignKey
ALTER TABLE "hold_add_ons" DROP CONSTRAINT "hold_add_ons_add_on_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_role_id_operator_id_fkey";

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_operator_id_fkey" FOREIGN KEY ("role_id", "operator_id") REFERENCES "roles"("id", "operator_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_add_ons" ADD CONSTRAINT "hold_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "add_ons"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
