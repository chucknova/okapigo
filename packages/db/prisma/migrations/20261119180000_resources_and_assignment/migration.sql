-- Stage 15a (OPS-01): vans and the boat; a guide and a resource per departure; who checked
-- a traveller in.

CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "resources_operator_id_name_key" ON "resources"("operator_id", "name");
CREATE UNIQUE INDEX "resources_id_operator_id_key" ON "resources"("id", "operator_id");
ALTER TABLE "resources" ADD CONSTRAINT "resources_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resources" ADD CONSTRAINT "resources_valid"
  CHECK ("kind" IN ('van', 'boat') AND "seats" BETWEEN 1 AND 200
         AND "name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60);

-- A departure's guide must be one of the business's own staff (users.id + operator_id).
CREATE UNIQUE INDEX "users_id_operator_id_key" ON "users"("id", "operator_id");

ALTER TABLE "departures" ADD COLUMN "guide_id" UUID;
ALTER TABLE "departures" ADD COLUMN "resource_id" UUID;
ALTER TABLE "departures" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "departures" ADD CONSTRAINT "departures_guide_id_operator_id_fkey"
  FOREIGN KEY ("guide_id", "operator_id") REFERENCES "users"("id", "operator_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "departures" ADD CONSTRAINT "departures_resource_id_operator_id_fkey"
  FOREIGN KEY ("resource_id", "operator_id") REFERENCES "resources"("id", "operator_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "departures" ADD CONSTRAINT "departures_notes_length" CHECK (char_length("notes") <= 500);

-- THE RULE (OPS-01: "double assignment blocked"): a guide, or a van/boat, can't be on two
-- running departures whose times overlap. An EXCLUSION constraint: Postgres itself refuses
-- the second one, however the two assignments race. tstzrange(start, end) is the time the
-- departure takes; && means "overlaps"; btree_gist lets "=" and "&&" share one index.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "departures" ADD CONSTRAINT "departures_guide_not_double_booked"
  EXCLUDE USING gist ("guide_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("guide_id" IS NOT NULL AND "status" = 'scheduled');
ALTER TABLE "departures" ADD CONSTRAINT "departures_resource_not_double_booked"
  EXCLUDE USING gist ("resource_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("resource_id" IS NOT NULL AND "status" = 'scheduled');

ALTER TABLE "travellers" ADD COLUMN "checked_in_by_id" UUID;
