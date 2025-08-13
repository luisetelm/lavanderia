/*
  Warnings:

  - You are about to drop the column `taskId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the `Task` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_workerId_fkey";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "taskId",
ADD COLUMN     "orderid" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "status" TEXT DEFAULT 'PENDING';

-- DropTable
DROP TABLE "Task";

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderid_fkey" FOREIGN KEY ("orderid") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
