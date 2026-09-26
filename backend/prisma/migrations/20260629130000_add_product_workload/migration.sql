-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "counts_for_load" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "workload_weight" DOUBLE PRECISION NOT NULL DEFAULT 1;

