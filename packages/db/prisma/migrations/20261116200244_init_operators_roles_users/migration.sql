-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "time_zone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "website_style" TEXT NOT NULL DEFAULT 'classic',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_preset" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operators_slug_key" ON "operators"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "roles_operator_id_key_key" ON "roles"("operator_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_operator_id_key" ON "roles"("id", "operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_operator_id_idx" ON "users"("operator_id");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_operator_id_fkey" FOREIGN KEY ("role_id", "operator_id") REFERENCES "roles"("id", "operator_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written CHECK constraints (added after Prisma generated the SQL above).
-- Prisma's schema language can't express these rules, so they live here. The database
-- refuses any row that breaks them, whatever code tries to write it.
-- ---------------------------------------------------------------------------

-- Staff sign in with a one-time code sent to email OR phone (ACC-01): they need at least one.
ALTER TABLE "users" ADD CONSTRAINT "users_email_or_phone_required"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Emails are stored lowercase, so "Adaeze@x.com" and "adaeze@x.com" can't become two
-- accounts. The API lowercases input before saving; this guarantees it.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase"
  CHECK ("email" = lower("email"));

-- Phones are stored in E.164 format: "+", country code, number, no spaces (+2348031234567).
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164"
  CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Slugs appear in URLs: lowercase letters, digits and single hyphens only (irin-lagos-tours).
ALTER TABLE "operators" ADD CONSTRAINT "operators_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ISO 4217 currency codes are three capital letters (NGN, USD, GBP).
ALTER TABLE "operators" ADD CONSTRAINT "operators_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');
