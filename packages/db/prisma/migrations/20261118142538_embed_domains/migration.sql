-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "embed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[];
