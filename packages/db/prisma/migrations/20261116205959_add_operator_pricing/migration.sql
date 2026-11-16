-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "pricing" JSONB NOT NULL DEFAULT '{"tax": {"name": "VAT", "basisPoints": 750, "inclusive": true}, "fees": []}';
