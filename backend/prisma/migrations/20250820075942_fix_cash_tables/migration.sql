-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('sale_cash_in', 'withdrawal', 'deposit', 'refund_cash_out', 'opening', 'correction');

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "codigopostal" VARCHAR,
ADD COLUMN     "denominacionsocial" VARCHAR,
ADD COLUMN     "direccion" VARCHAR,
ADD COLUMN     "localidad" VARCHAR,
ADD COLUMN     "nif" VARCHAR,
ADD COLUMN     "pais" VARCHAR,
ADD COLUMN     "provincia" VARCHAR,
ADD COLUMN     "tipopersona" VARCHAR;

-- CreateTable
CREATE TABLE "CashClosure" (
    "id" SERIAL NOT NULL,
    "openedat" TIMESTAMPTZ(6),
    "closedat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingamount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedamount" DECIMAL(12,2) NOT NULL,
    "countedamount" DECIMAL(12,2) NOT NULL,
    "diff" DECIMAL(12,2) NOT NULL,
    "userId" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CashClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" SERIAL NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "movementat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderid" INTEGER,
    "userid" INTEGER NOT NULL,
    "note" TEXT,
    "closureId" INTEGER,
    "personUserId" INTEGER,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userid_fkey" FOREIGN KEY ("userid") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_personUserId_fkey" FOREIGN KEY ("personUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_orderid_fkey" FOREIGN KEY ("orderid") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_closureId_fkey" FOREIGN KEY ("closureId") REFERENCES "CashClosure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
