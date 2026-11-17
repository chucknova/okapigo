-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deposit_basis_points" INTEGER;


-- A deposit is a share between 0% and 100%, exclusive (added by hand: Prisma can't express CHECKs).
ALTER TABLE "products" ADD CONSTRAINT "products_deposit_basis_points_check"
  CHECK ("deposit_basis_points" IS NULL OR "deposit_basis_points" BETWEEN 1 AND 9999);
