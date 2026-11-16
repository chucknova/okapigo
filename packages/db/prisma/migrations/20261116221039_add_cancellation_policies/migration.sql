-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "policy_version_id" UUID,
ADD COLUMN     "refund_due_kobo" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cancellation_policy_id" UUID;

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policy_versions" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "no_show_refund_basis_points" INTEGER NOT NULL,
    "deposit_refundable" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policies_operator_id_name_key" ON "cancellation_policies"("operator_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policies_id_operator_id_key" ON "cancellation_policies"("id", "operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "cancellation_policy_versions_policy_id_version_key" ON "cancellation_policy_versions"("policy_id", "version");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_cancellation_policy_id_operator_id_fkey" FOREIGN KEY ("cancellation_policy_id", "operator_id") REFERENCES "cancellation_policies"("id", "operator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "cancellation_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policies" ADD CONSTRAINT "cancellation_policies_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_policy_versions" ADD CONSTRAINT "cancellation_policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "cancellation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: CHECKs and the immutability trigger
-- ---------------------------------------------------------------------------
ALTER TABLE "cancellation_policy_versions" ADD CONSTRAINT "policy_versions_values_valid"
  CHECK ("version" >= 1 AND "no_show_refund_basis_points" BETWEEN 0 AND 10000);

-- A refund can't be negative or more than was paid.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_refund_due_valid"
  CHECK ("refund_due_kobo" >= 0 AND "refund_due_kobo" <= "amount_paid_kobo");

-- IMMUTABLE VERSIONS. A trigger runs BEFORE every UPDATE on this table and raises an error,
-- so no code (ours, a migration, someone in psql) can quietly rewrite the terms a guest
-- booked under. To change a policy, INSERT a new version instead. (Deleting is still
-- allowed, only for the cascade when a whole operator is removed.)
CREATE FUNCTION forbid_policy_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cancellation policy versions are immutable; add a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cancellation_policy_versions_immutable
  BEFORE UPDATE ON "cancellation_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_policy_version_update();
