-- AlterTable
ALTER TABLE "WhatsappMessage" ADD COLUMN     "templateParams" TEXT[] DEFAULT ARRAY[]::TEXT[];
